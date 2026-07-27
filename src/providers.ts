import OpenAI from "openai";

import type { ProviderConfig } from "./config.js";

/**
 * Provider pool — the delegate reader's outbound side (leaf 04, seam S-PROVIDERS).
 *
 * A provider-agnostic pool over the OpenAI SDK:
 *  - buildPool:  one OpenAI client per provider, constructed once at startup.
 *  - weightedOrder:  a weighted-random *permutation* of the pool (by `weight`, default 1),
 *    recomputed per call.
 *  - call:  walk that order, trying each provider in turn; ANY error → the next provider
 *    (no error-type discrimination, no circuit-breaker, no rate state). The number of
 *    attempts before success becomes the `failovers` metric.
 *
 * `resume` pins a session's model via `modelOverride`, which calls that exact model instead
 * of the provider's `default_model`.
 *
 * Scope (S-PROVIDERS, frozen): depends only on the config schema (`ProviderConfig`).
 * Message assembly (reader system prompt, file blocks) and metric recording live in leaf 06.
 */

/** Floor for `max_output_tokens` — thinking models need headroom (spec §5.4). */
export const MIN_OUTPUT_TOKENS = 200;

/** Default per-request timeout when a provider config omits `timeout_ms`. */
export const DEFAULT_TIMEOUT_MS = 120_000;

// ---- Minimal client shape ---------------------------------------------------
// The only surface of the OpenAI SDK the pool depends on. Declaring it structurally
// lets tests inject fakes with zero network — the real `OpenAI` instance satisfies it.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCreateParams {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  stream: false;
}

export interface ChatCompletion {
  choices: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface ChatClient {
  chat: { completions: { create(params: ChatCreateParams): Promise<ChatCompletion> } };
}

/** Builds a client for a provider. Overridable so tests supply fakes. */
export type ClientFactory = (provider: ProviderConfig) => ChatClient;

// ---- Pool -------------------------------------------------------------------

export interface ProviderPool {
  /** Active providers, in config order (the source list weightedOrder permutes). */
  readonly providers: ProviderConfig[];
  /** The client for a provider name (throws if unknown — a wiring bug, not a call error). */
  client(name: string): ChatClient;
}

/** The default factory: one real OpenAI SDK client per provider. */
const defaultFactory: ClientFactory = (p) => {
  const client = new OpenAI({
    apiKey: p.api_key,
    baseURL: p.base_url,
    timeout: p.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    defaultHeaders: p.headers,
  });
  // The real client structurally supports our narrow ChatCreateParams call.
  return client as unknown as ChatClient;
};

/**
 * Construct one client per provider up front (not lazily). N providers → N clients.
 */
export function buildPool(
  providers: ProviderConfig[],
  factory: ClientFactory = defaultFactory,
): ProviderPool {
  if (providers.length === 0) {
    throw new Error("buildPool requires at least one provider");
  }
  const clients = new Map<string, ChatClient>();
  for (const p of providers) {
    clients.set(p.name, factory(p));
  }
  return {
    providers,
    client(name) {
      const c = clients.get(name);
      if (!c) throw new Error(`no client for provider "${name}"`);
      return c;
    },
  };
}

// ---- Weighted-random ordering ----------------------------------------------

/**
 * A weighted-random permutation of the pool. Roulette-select without replacement:
 * each step draws `rng() * remainingTotalWeight`, picks the provider that segment
 * lands on, removes it, and repeats. Heavier `weight` ⇒ more likely to land earlier
 * in the order. The first entry is tried first by `call`.
 */
export function weightedOrder(
  providers: ProviderConfig[],
  rng: () => number = Math.random,
): ProviderConfig[] {
  const remaining = [...providers];
  const order: ProviderConfig[] = [];
  while (remaining.length > 0) {
    const total = remaining.reduce((sum, p) => sum + weightOf(p), 0);
    let roll = rng() * total;
    // Default to the last item so an rng() at/near 1 (rounding) still selects validly.
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weightOf(remaining[i]);
      if (roll < 0) {
        idx = i;
        break;
      }
    }
    order.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return order;
}

/** A provider's selection weight; any non-positive / non-finite value defaults to 1. */
function weightOf(p: ProviderConfig): number {
  const w = p.weight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

// ---- Call with sequential failover -----------------------------------------

export interface CallRequest {
  /** The fully-assembled user prompt (leaf 06 folds any reader system prompt into this). */
  prompt: string;
  /** Output-token cap; floored to MIN_OUTPUT_TOKENS. Defaults to the floor when absent. */
  max_output_tokens?: number;
  /** Pin a specific model (resume path) instead of each provider's default_model. */
  modelOverride?: string;
}

export interface CallResult {
  answer: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Failed attempts before the served one (0 = primary pick succeeded). */
  failovers: number;
}

/** One failed provider attempt, kept for the aggregate error / diagnostics. */
export interface ProviderAttempt {
  provider: string;
  error: string;
}

/** Thrown when every provider in the order fails. Carries each attempt for leaf 06. */
export class AllProvidersFailedError extends Error {
  readonly attempts: ProviderAttempt[];
  constructor(attempts: ProviderAttempt[]) {
    const last = attempts.at(-1)?.error ?? "unknown error";
    super(`all ${attempts.length} provider(s) failed; last error: ${last}`);
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

/**
 * Run one reader call against the pool: compute a weighted-random order, then try each
 * provider sequentially until one answers. Any thrown error falls through to the next
 * provider. If all fail, throws AllProvidersFailedError (→ isError at the tool layer, leaf 06).
 */
export async function call(
  pool: ProviderPool,
  req: CallRequest,
  rng: () => number = Math.random,
): Promise<CallResult> {
  const maxTokens = Math.max(MIN_OUTPUT_TOKENS, req.max_output_tokens ?? MIN_OUTPUT_TOKENS);
  const messages: ChatMessage[] = [{ role: "user", content: req.prompt }];
  const attempts: ProviderAttempt[] = [];

  for (const p of weightedOrder(pool.providers, rng)) {
    const model = req.modelOverride ?? p.default_model;
    try {
      const resp = await pool.client(p.name).chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      });
      const message = resp.choices?.[0]?.message;
      if (!message) {
        // Malformed response is treated like any other failure — try the next provider.
        throw new Error("response contained no choices");
      }
      return {
        answer: message.content ?? "",
        provider: p.name,
        model,
        input_tokens: resp.usage?.prompt_tokens ?? 0,
        output_tokens: resp.usage?.completion_tokens ?? 0,
        failovers: attempts.length,
      };
    } catch (err) {
      attempts.push({ provider: p.name, error: errMsg(err) });
    }
  }

  throw new AllProvidersFailedError(attempts);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
