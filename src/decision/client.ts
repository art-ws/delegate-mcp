import type { DecisionConfig } from "./config.js";
import type { PreparedDecision } from "./request.js";
import type { DecisionError, DecisionErrorCode, DecisionExecution } from "./schemas.js";

export interface DecisionTransportDependencies {
  fetch?: typeof globalThis.fetch;
  /** Monotonic milliseconds. */
  now?: () => number;
  /** Abort-aware delay, also used for the single deadline watchdog. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Epoch milliseconds, used only to interpret HTTP-date Retry-After. */
  wallNow?: () => number;
}

export interface DecisionTransportState {
  attempts: number;
  elapsed_ms: number;
  billing_uncertain: boolean;
}

export type DecisionTransportResult =
  | ({ success: true; body: unknown } & DecisionTransportState)
  | ({ success: false; error: DecisionError } & DecisionTransportState);

export interface DecisionClient {
  /** S3 snapshots are immutable. D06 handles dry-run before calling transport. */
  request(
    prepared: Pick<PreparedDecision, "bodyJson">,
    execution: Required<DecisionExecution>,
    signal?: AbortSignal,
  ): Promise<DecisionTransportResult>;
}

const endpoint = "https://openrouter.ai/api/alpha/decisions";
const automaticRetry = new Set([429, 500, 502, 503, 524, 529]);
const messages: Partial<Record<DecisionErrorCode, string>> = {
  INVALID_ARGUMENT: "Invalid decision execution arguments.",
  INPUT_TOO_LARGE: "Decision request exceeds the upstream size limit.",
  UPSTREAM_AUTH: "Decision upstream authentication failed.",
  UPSTREAM_PAYMENT: "Decision upstream payment is required.",
  UPSTREAM_FORBIDDEN: "Decision upstream request is forbidden.",
  UPSTREAM_NOT_FOUND: "Decision upstream endpoint was not found.",
  UPSTREAM_REQUEST: "Decision upstream rejected the request.",
  UPSTREAM_RATE_LIMIT: "Decision upstream rate limit reached.",
  UPSTREAM_UNAVAILABLE: "Decision upstream is unavailable or the local queue is full.",
  UPSTREAM_TIMEOUT: "Decision request timed out.",
  UPSTREAM_PROTOCOL: "Invalid decision upstream response.",
  NETWORK_ERROR: "Decision upstream network failure.",
  CANCELLED: "Decision request was cancelled.",
};

class SafeFailure {
  constructor(
    readonly code: DecisionErrorCode,
    readonly retryable: boolean,
    readonly uncertain = false,
    readonly httpStatus?: number,
    readonly retryDelay = 0,
    readonly autoRetry = false,
  ) {}
}

/** Instantiate once per S2 ready config, then reuse across all D06 calls. */
export function createDecisionClient(
  config: DecisionConfig,
  dependencies: DecisionTransportDependencies = {},
): DecisionClient {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => performance.now());
  const sleep = dependencies.sleep ?? delay;
  const random = dependencies.random ?? Math.random;
  const wallNow = dependencies.wallNow ?? Date.now;
  const scheduler = new Scheduler(config.max_concurrency, config.max_queue);
  const responseLimit = config.max_response_bytes;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.api_key}`, "Content-Type": "application/json",
  };
  if (config.http_referer !== undefined) headers["HTTP-Referer"] = config.http_referer;
  if (config.app_title !== undefined) headers["X-Title"] = config.app_title;

  return { async request(prepared, execution, signal) {
    const start = now();
    const bodyJson = prepared.bodyJson;
    let attempts = 0;
    let billingUncertain = false;
    let sending = false;
    const state = (): DecisionTransportState => ({
      attempts, elapsed_ms: Math.max(0, Math.floor(now() - start)),
      billing_uncertain: billingUncertain,
    });
    const failed = (failure: SafeFailure): DecisionTransportResult => {
      billingUncertain ||= failure.uncertain;
      const error: DecisionError = {
        code: failure.code, message: messages[failure.code]!,
        retryable: failure.retryable, billing_uncertain: billingUncertain,
      };
      if (failure.httpStatus !== undefined) error.http_status = failure.httpStatus;
      return { success: false, error, ...state() };
    };
    if (!Number.isInteger(execution.timeout_ms) || execution.timeout_ms < 1000 ||
        execution.timeout_ms > 120000 || !Number.isInteger(execution.max_retries) ||
        execution.max_retries < 0 || execution.max_retries > 2 || execution.dry_run !== false) {
      return failed(new SafeFailure("INVALID_ARGUMENT", false));
    }
    const deadline = start + execution.timeout_ms;
    const controller = new AbortController();
    const timerController = new AbortController();
    let stop: "CANCELLED" | "UPSTREAM_TIMEOUT" | undefined;
    const abort = (code: typeof stop) => {
      if (stop !== undefined) return;
      stop = code;
      controller.abort(); // Never propagate caller/upstream abort reasons.
    };
    const cancel = () => abort("CANCELLED");
    const check = () => {
      if (stop === undefined && now() >= deadline) abort("UPSTREAM_TIMEOUT");
      if (stop !== undefined) throw new SafeFailure(stop, stop === "UPSTREAM_TIMEOUT", sending);
    };
    let release: (() => void) | undefined;
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    try {
      check();
      // One watchdog per request. Its cancellation removes its timer/listener.
      void sleep(Math.max(0, deadline - now()), timerController.signal).then(
        () => abort("UPSTREAM_TIMEOUT"),
        () => { if (!timerController.signal.aborted) abort("UPSTREAM_TIMEOUT"); },
      );
      release = await scheduler.acquire(controller.signal);
      check();
      for (;;) {
        let response: Response | undefined;
        try {
          check();
          attempts++;
          sending = true;
          const pending = fetch(endpoint, {
            method: "POST", headers: { ...headers }, body: bodyJson,
            redirect: "manual", signal: controller.signal,
          });
          // Dispose a late response even if an injected fetch ignores cancellation.
          void pending.then((value) => {
            if (controller.signal.aborted) discard(value);
          }, () => {});
          response = await interruptible(pending, controller.signal);
          check();
          if (response.redirected) throw new SafeFailure("UPSTREAM_PROTOCOL", false, true, response.status);
          if (response.status < 200 || response.status >= 300) {
            const failure = classify(response.status, retryAfter(response.headers.get("retry-after"), wallNow()));
            sending = false;
            throw failure;
          }
          const body = await readJson(response, responseLimit, controller.signal);
          check();
          sending = false;
          return { success: true, body, ...state() };
        } catch (raw) {
          if (response !== undefined) { discard(response); response = undefined; }
          // Cancellation/deadline always wins over a reflected upstream error.
          check();
          const failure = raw instanceof SafeFailure ? raw
            : new SafeFailure("NETWORK_ERROR", true, true, undefined, 0, true);
          billingUncertain ||= failure.uncertain;
          sending = false;
          if (!failure.autoRetry || attempts > execution.max_retries) return failed(failure);
          const jitter = Math.floor(Math.min(1, Math.max(0, random())) * 250);
          const wait = Math.max(250 * 2 ** (attempts - 1) + jitter, failure.retryDelay);
          // Sleep is raced against the same watchdog; expiry never starts a retry.
          await interruptible(sleep(Math.min(wait, deadline - now()), controller.signal), controller.signal);
          check();
        } finally {
          if (response !== undefined) discard(response);
        }
      }
    } catch (raw) {
      if (stop !== undefined) return failed(new SafeFailure(stop, stop === "UPSTREAM_TIMEOUT", sending));
      return failed(raw instanceof SafeFailure ? raw : new SafeFailure("NETWORK_ERROR", true, sending));
    } finally {
      signal?.removeEventListener("abort", cancel);
      timerController.abort();
      controller.abort();
      release?.();
    }
  } };
}

function classify(status: number, retryDelay: number): SafeFailure {
  let code: DecisionErrorCode;
  switch (status) {
    case 400: code = "UPSTREAM_REQUEST"; break;
    case 401: code = "UPSTREAM_AUTH"; break;
    case 402: code = "UPSTREAM_PAYMENT"; break;
    case 403: code = "UPSTREAM_FORBIDDEN"; break;
    case 404: code = "UPSTREAM_NOT_FOUND"; break;
    case 413: code = "INPUT_TOO_LARGE"; break;
    case 429: code = "UPSTREAM_RATE_LIMIT"; break;
    case 524: code = "UPSTREAM_TIMEOUT"; break;
    default: code = status >= 500 && status <= 599 ? "UPSTREAM_UNAVAILABLE"
      : status >= 400 && status <= 499 ? "UPSTREAM_REQUEST" : "UPSTREAM_PROTOCOL";
  }
  const retryable = code === "UPSTREAM_UNAVAILABLE" || code === "UPSTREAM_RATE_LIMIT" || code === "UPSTREAM_TIMEOUT";
  // Explicit 4xx rejection provides a known result. 5xx/unexpected replies do not.
  return new SafeFailure(code, retryable, status < 400 || status >= 500, status, retryDelay, automaticRetry.has(status));
}

function retryAfter(value: string | null, epoch: number): number {
  if (value === null) return 0;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - epoch) : 0;
}

async function readJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw new SafeFailure("UPSTREAM_PROTOCOL", false, true, response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await interruptible(reader.read(), signal);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) throw new SafeFailure("UPSTREAM_PROTOCOL", false, true, response.status);
      chunks.push(item.value);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
    } catch {
      throw new SafeFailure("UPSTREAM_PROTOCOL", false, true, response.status);
    }
  } finally {
    // Cancellation must not wait for an uncooperative underlying stream source.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function discard(response: Response): void {
  if (response.body !== null && !response.body.locked) void response.body.cancel().catch(() => {});
}

/** Races uncooperative injected IO, always removing its listener. */
function interruptible<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new SafeFailure("CANCELLED", false)); };
    if (signal.aborted) { void pending.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    void pending.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new SafeFailure("CANCELLED", false)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

class Scheduler {
  private active = 0;
  private readonly queue: { grant: () => void; abort: () => void; signal: AbortSignal }[] = [];
  constructor(private readonly concurrency: number, private readonly maxQueue: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new SafeFailure("CANCELLED", false));
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve(this.slot());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new SafeFailure("UPSTREAM_UNAVAILABLE", true));
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        grant: () => { signal.removeEventListener("abort", waiter.abort); resolve(this.slot()); },
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener("abort", waiter.abort);
          reject(new SafeFailure("CANCELLED", false));
        },
      };
      this.queue.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
    });
  }

  private slot(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next !== undefined) next.grant();
      else this.active--;
    };
  }
}
