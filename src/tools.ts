import { randomUUID } from "node:crypto";

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { resolveAndLoadConfig } from "./config.js";
import type { AppConfig } from "./config.js";
import { packDir, READER_SYSTEM_PROMPT } from "./files.js";
import type { PackResult } from "./files.js";
import { AllProvidersFailedError, buildPool, call } from "./providers.js";
import type { CallRequest, CallResult, ProviderPool } from "./providers.js";
import { loadSession, saveSession } from "./sessions.js";
import type { Session, SessionMessage } from "./sessions.js";
import { appendMetric } from "./metrics.js";
import type { Metric } from "./metrics.js";

/**
 * The three delegate tools + server wiring (leaf 06, seam S-TOOLS — the integration node).
 *
 * `analyze` / `query` / `resume` orchestrate the frozen modules end to end:
 *   files (03) → providers (04) → sessions (05) → metrics (05), over config (02).
 * Each tool returns an MCP {@link CallToolResult} whose FIRST line is the fixed header
 *   `[delegate <tool>] provider=… model=… in=… out=… session=…`
 * followed by the reader's answer. A metric line is appended on EVERY call — success and
 * error alike. Any failure (all providers down / no session / unreadable work_dir) is
 * caught and returned as `isError: true` rather than thrown across the MCP boundary, so a
 * bad call never takes the server down.
 *
 * The seam takes a SINGLE prompt string (S-PROVIDERS, frozen): `analyze` folds the reader
 * system prompt (§4.4) + packed files + the user's question into one string, and `resume`
 * folds the session's prior turns + the new prompt into one string — neither changes the
 * provider seam.
 *
 * Server wiring (`resolveContext` / `createServer` / `registerDelegateTools`) lives here,
 * not in `index.ts`, so tests can build a server over a mock pool WITHOUT the stdio entry
 * running its fail-loud config load on import.
 */

const SERVER_NAME = "delegate-mcp";
const SERVER_VERSION = "0.1.0";

// ---- Context ----------------------------------------------------------------

/**
 * Everything the tools need to run, plus injectable clocks / id / rng so tests are
 * deterministic and network-free. Defaults resolve to the real wall clock + crypto.
 */
export interface ToolContext {
  config: AppConfig;
  pool: ProviderPool;
  /** RNG for the providers' weighted order (default `Math.random`). */
  rng?: () => number;
  /** Millisecond clock for `duration_ms` (default `Date.now`). */
  nowMs?: () => number;
  /** ISO-8601 timestamp source for the metric `ts` (default `new Date().toISOString()`). */
  nowIso?: () => string;
  /** Unique-id source for session ids + metric uuids (default `crypto.randomUUID`). */
  uuid?: () => string;
  /** Sink for non-fatal warnings (default `console.warn` → stderr). */
  warn?: (message: string) => void;
}

// ---- Public argument shapes (mirrored by the zod inputSchemas below) ---------

export interface AnalyzeArgs {
  work_dir: string;
  prompt: string;
  max_output_tokens?: number;
}

export interface QueryArgs {
  prompt: string;
  max_output_tokens?: number;
}

export interface ResumeArgs {
  session_id: string;
  prompt: string;
  max_output_tokens?: number;
}

// ---- Tools ------------------------------------------------------------------

/**
 * `query`: a fileless one-shot. Assemble → call the pool → persist a fresh session →
 * record a metric → return the header + answer (with `session_id` for a later `resume`).
 */
export async function query(ctx: ToolContext, args: QueryArgs): Promise<CallToolResult> {
  const start = nowMs(ctx);
  const sessionId = newId(ctx);
  const prompt = args.prompt;
  const inputBytes = Buffer.byteLength(prompt, "utf8");
  const req: CallRequest = { prompt, max_output_tokens: resolveMaxOut(ctx, args.max_output_tokens) };

  try {
    const r = await call(ctx.pool, req, ctx.rng);
    saveSession(ctx.config.session_dir, sessionFrom(sessionId, r, prompt, r.answer));
    record(ctx, okMetric("query", r, inputBytes, elapsed(ctx, start), { session_id: sessionId, files_attached: 0 }));
    return okResult(header("query", r, sessionId), r.answer);
  } catch (e) {
    return failure(ctx, "query", e, inputBytes, start);
  }
}

/**
 * `analyze`: pack `work_dir` (03) into the prompt, then run it like `query`. An unreadable
 * work_dir is an `isError`, not a crash. The number of files packed / skipped is reflected
 * in the metric (`files_attached`) and, when anything was skipped or truncated, in a body
 * footer.
 */
export async function analyze(ctx: ToolContext, args: AnalyzeArgs): Promise<CallToolResult> {
  const start = nowMs(ctx);
  const sessionId = newId(ctx);

  let packed: PackResult;
  try {
    packed = packDir(args.work_dir, ctx.config.file_walker);
  } catch (e) {
    // No prompt was assembled yet → input_bytes 0, files_attached 0.
    return failure(ctx, "analyze", e, 0, start, { files_attached: 0 });
  }

  const prompt = assembleAnalyzePrompt(packed.prompt, args.prompt);
  const inputBytes = Buffer.byteLength(prompt, "utf8");
  const req: CallRequest = { prompt, max_output_tokens: resolveMaxOut(ctx, args.max_output_tokens) };

  try {
    const r = await call(ctx.pool, req, ctx.rng);
    saveSession(ctx.config.session_dir, sessionFrom(sessionId, r, args.prompt, r.answer));
    record(ctx, okMetric("analyze", r, inputBytes, elapsed(ctx, start), {
      session_id: sessionId,
      files_attached: packed.files,
    }));
    return okResult(header("analyze", r, sessionId), r.answer + packSummary(packed));
  } catch (e) {
    return failure(ctx, "analyze", e, inputBytes, start, { files_attached: packed.files });
  }
}

/**
 * `resume`: load a prior session (05), PIN its provider + model, and continue. The
 * provider is pinned by calling a single-provider view of the pool; the model is pinned via
 * the pool's `modelOverride` (04). Continuity is reconstructed by folding the session's
 * prior turns into the single prompt string (the seam threads no conversation itself). A
 * missing session — or a session whose provider is no longer configured — is an `isError`.
 */
export async function resume(ctx: ToolContext, args: ResumeArgs): Promise<CallToolResult> {
  const start = nowMs(ctx);

  let session: Session;
  try {
    session = loadSession(ctx.config.session_dir, args.session_id);
  } catch (e) {
    return failure(ctx, "resume", e, 0, start, { session_id: args.session_id });
  }

  const pinned = ctx.pool.providers.find((p) => p.name === session.provider);
  if (!pinned) {
    const e = new Error(`session provider "${session.provider}" is no longer configured`);
    return failure(ctx, "resume", e, 0, start, { session_id: session.session_id });
  }

  const prompt = renderResumePrompt(session.history, args.prompt);
  const inputBytes = Buffer.byteLength(prompt, "utf8");
  // Single-provider view → the weighted order can only pick the pinned provider; the model
  // is pinned via modelOverride. Reuses the already-built client (no new construction).
  const pinnedPool: ProviderPool = { providers: [pinned], client: (n) => ctx.pool.client(n) };
  const req: CallRequest = {
    prompt,
    max_output_tokens: resolveMaxOut(ctx, args.max_output_tokens),
    modelOverride: session.model,
  };

  try {
    const r = await call(pinnedPool, req, ctx.rng);
    const updated: Session = {
      session_id: session.session_id,
      provider: r.provider,
      model: r.model,
      history: [
        ...session.history,
        { role: "user", content: args.prompt },
        { role: "assistant", content: r.answer },
      ],
    };
    saveSession(ctx.config.session_dir, updated);
    record(ctx, okMetric("resume", r, inputBytes, elapsed(ctx, start), {
      session_id: session.session_id,
      files_attached: 0,
    }));
    return okResult(header("resume", r, session.session_id), r.answer);
  } catch (e) {
    return failure(ctx, "resume", e, inputBytes, start, { session_id: session.session_id });
  }
}

// ---- Prompt assembly --------------------------------------------------------

/**
 * Fold the reader system prompt (§4.4), the packed file corpus, and the user's question
 * into ONE prompt string. The S-PROVIDERS seam takes a single prompt (no separate system
 * message), so the reader role is prepended here rather than sent as its own message.
 */
function assembleAnalyzePrompt(packedPrompt: string, userPrompt: string): string {
  return `${READER_SYSTEM_PROMPT}\n\n${packedPrompt}\n\n--- task ---\n${userPrompt}`;
}

/**
 * Replay a session's prior turns followed by the new user prompt, as one string. The seam
 * threads no conversation state, so continuity for `resume` is reconstructed from `history[]`.
 */
function renderResumePrompt(history: SessionMessage[], nextPrompt: string): string {
  if (history.length === 0) return nextPrompt;
  const turns = history.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  return `${turns}\n\n[user] ${nextPrompt}`;
}

/** A short body footer reflecting packed / skipped / truncated when anything was left out. */
function packSummary(packed: PackResult): string {
  if (packed.skipped.length === 0 && !packed.truncated) return "";
  return (
    `\n\n[delegate analyze] packed ${packed.files} file(s), ${packed.skipped.length} skipped` +
    `${packed.truncated ? ", truncated at cap" : ""}`
  );
}

// ---- Result + metric helpers ------------------------------------------------

function header(tool: string, r: CallResult, sessionId: string): string {
  return (
    `[delegate ${tool}] provider=${r.provider} model=${r.model} ` +
    `in=${r.input_tokens} out=${r.output_tokens} session=${sessionId}`
  );
}

function okResult(headerLine: string, body: string): CallToolResult {
  return { content: [{ type: "text", text: `${headerLine}\n${body}` }] };
}

function errorResult(tool: string, message: string): CallToolResult {
  return { content: [{ type: "text", text: `[delegate ${tool}] error: ${message}` }], isError: true };
}

function sessionFrom(id: string, r: CallResult, userPrompt: string, answer: string): Session {
  return {
    session_id: id,
    provider: r.provider,
    model: r.model,
    history: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: answer },
    ],
  };
}

function okMetric(
  tool: string,
  r: CallResult,
  inputBytes: number,
  durationMs: number,
  extra: Partial<Metric>,
): Metric {
  return {
    tool,
    provider: r.provider,
    model: r.model,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    input_bytes: inputBytes,
    duration_ms: durationMs,
    status: "ok",
    failovers: r.failovers,
    ...extra,
  };
}

/**
 * Record an error metric (status `error`, provider/model unknown → `-`) and return the
 * `isError` tool result. `failovers` is carried through when the failure was an
 * all-providers-failed. Metric recording never throws (S-METRICS).
 */
function failure(
  ctx: ToolContext,
  tool: string,
  e: unknown,
  inputBytes: number,
  start: number,
  extra: Partial<Metric> = {},
): CallToolResult {
  const message = errMsg(e);
  const metric: Metric = {
    tool,
    provider: "-",
    model: "-",
    input_tokens: 0,
    output_tokens: 0,
    input_bytes: inputBytes,
    duration_ms: elapsed(ctx, start),
    status: "error",
    error: message,
    ...(e instanceof AllProvidersFailedError ? { failovers: e.attempts.length } : {}),
    ...extra,
  };
  record(ctx, metric);
  return errorResult(tool, message);
}

function record(ctx: ToolContext, metric: Metric): void {
  appendMetric(ctx.config.metrics_file, metric, {
    now: ctx.nowIso,
    uuid: ctx.uuid,
    warn: ctx.warn,
  });
}

function resolveMaxOut(ctx: ToolContext, requested?: number): number | undefined {
  return requested ?? ctx.config.default_max_output_tokens;
}

function nowMs(ctx: ToolContext): number {
  return (ctx.nowMs ?? Date.now)();
}

function elapsed(ctx: ToolContext, start: number): number {
  return nowMs(ctx) - start;
}

function newId(ctx: ToolContext): string {
  return (ctx.uuid ?? randomUUID)();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- Server wiring ----------------------------------------------------------

const TOKEN_ARG = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Optional output-token cap for the reader model (floored to the model minimum).");

/**
 * Register `analyze`, `query`, `resume` on an McpServer. Each tool's zod inputSchema drives
 * both `tools/list` argument metadata and the parse of incoming args; the callback delegates
 * to the orchestration functions above, which already fold every failure into `isError`.
 */
export function registerDelegateTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "analyze",
    {
      description:
        "Read a directory or file (work_dir) and answer a prompt about it via a cheap " +
        "delegate model, returning a tight answer instead of the raw files. Returns a session_id.",
      inputSchema: {
        work_dir: z.string().describe("Absolute path to a directory (or single file) to pack and read."),
        prompt: z.string().describe("What to extract / answer from the packed files."),
        max_output_tokens: TOKEN_ARG,
      },
    },
    (args) => analyze(ctx, args),
  );

  server.registerTool(
    "query",
    {
      description:
        "Ask the delegate model a fileless question and get a tight answer. Returns a session_id " +
        "for follow-ups via resume.",
      inputSchema: {
        prompt: z.string().describe("The question / instruction for the delegate model."),
        max_output_tokens: TOKEN_ARG,
      },
    },
    (args) => query(ctx, args),
  );

  server.registerTool(
    "resume",
    {
      description:
        "Continue a prior delegate session (from analyze/query) with a new prompt, pinned to the " +
        "same provider and model.",
      inputSchema: {
        session_id: z.string().describe("The session_id returned by a prior analyze/query/resume call."),
        prompt: z.string().describe("The follow-up prompt to continue the session with."),
        max_output_tokens: TOKEN_ARG,
      },
    },
    (args) => resume(ctx, args),
  );
}

/**
 * Resolve config (fail-loud on a bad/missing file, S-CONFIG) and build the provider pool.
 * This is the startup step `index.ts` runs before serving; kept here (not in the stdio
 * entry) so it is directly testable.
 */
export function resolveContext(
  argv?: string[],
  env: NodeJS.ProcessEnv = process.env,
  warn?: (message: string) => void,
): ToolContext {
  const config = resolveAndLoadConfig(argv, env, warn);
  const pool = buildPool(config.providers);
  return { config, pool, warn };
}

/** Build an McpServer with the three delegate tools registered over `ctx`. */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerDelegateTools(server, ctx);
  return server;
}
