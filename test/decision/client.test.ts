import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDecisionClient, type DecisionTransportResult } from "../../src/decision/client.js";
import type { DecisionConfig } from "../../src/decision/config.js";
import { prepareDecision, type PreparedDecision } from "../../src/decision/request.js";
import type { DecisionExecution } from "../../src/decision/schemas.js";

const keyCanary = ["SYNTHETIC", "D04", "AUTH", "CANARY"].join("_");
const contextCanary = ["SYNTHETIC", "D04", "CONTEXT", "CANARY"].join("_");
const config = (overrides: Partial<DecisionConfig> = {}): DecisionConfig => ({
  api_key: keyCanary, default_model: "~typesafe/jev-latest",
  allowed_models: ["~typesafe/jev-latest"], provider_defaults: {}, required_provider: {},
  timeout_ms: 30000, max_retries: 0, max_request_bytes: 262144,
  max_response_bytes: 1048576, max_concurrency: 1, max_queue: 2, ...overrides,
});
const execution = (overrides: Partial<Required<DecisionExecution>> = {}): Required<DecisionExecution> => ({
  timeout_ms: 30000, max_retries: 0, dry_run: false, ...overrides,
});
function prepared(cfg = config()): PreparedDecision {
  const result = prepareDecision({
    state: { text: contextCanary, utf8: "Привет 🌍" },
    questions: { q: { type: "noul", instructions: "synthetic?" } },
    session_id: "synthetic-session", provider: null,
    policy: { q: { type: "noul", false_max: 0.1, true_min: 0.9 } },
  }, cfg);
  if (!result.success) throw new Error("Synthetic preparation failed");
  return result.data;
}
const responseBody = { model: "typesafe/jev-1.13", answers: { q: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 1 } };
const ok = () => new Response(JSON.stringify(responseBody), { status: 200 });
function failure(result: DecisionTransportResult) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected safe failure");
  return result.error;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function stream() {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { source = c; }, cancel });
  return { response: new Response(body), source, cancel };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
function client(fetch: typeof globalThis.fetch, cfg = config(), random = () => 0) {
  return createDecisionClient(cfg, { fetch, now: () => Date.now(), wallNow: () => Date.now(), random });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z")); });
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AC-WIRE exact S3 bytes and isolated endpoint", () => {
  it("sends only fixed POST/body and ready-config headers", async () => {
    const cfg = config({ http_referer: "https://example.org", app_title: "Synthetic app", required_provider: { zdr: true, allow_fallbacks: false } });
    const p = prepared(cfg);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok());
    const c = client(fetch, cfg);
    expect(await c.request(p, p.effectiveExecution)).toMatchObject({ success: true, body: responseBody, attempts: 1, elapsed_ms: 0, billing_uncertain: false });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.method).toBe("POST");
    expect(init?.body === p.bodyJson).toBe(true);
    expect(Buffer.byteLength(init!.body as string, "utf8")).toBe(p.requestBytes);
    expect(init?.redirect).toBe("manual");
    const h = new Headers(init?.headers);
    expect(h.get("Authorization") === `Bearer ${keyCanary}`).toBe(true);
    expect([...h.keys()].sort()).toEqual(["authorization", "content-type", "http-referer", "x-title"]);
    expect(h.get("HTTP-Referer")).toBe(cfg.http_referer);
    expect(h.get("X-Title")).toBe(cfg.app_title);
    expect(h.has("session_id")).toBe(false);
    expect(p.body.provider).toMatchObject({ zdr: true, allow_fallbacks: false });
    expect(p.bodyJson.includes(keyCanary)).toBe(false);
    expect(init?.signal?.aborted).toBe(true); // lifecycle released after result
  });
  it("omits optional headers; passes decoded JSON to S4 without semantic work", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("null"));
    const result = await client(fetch).request(prepared(), execution());
    expect(result).toMatchObject({ success: true, body: null });
    expect([...new Headers(fetch.mock.calls[0][1]?.headers).keys()].sort()).toEqual(["authorization", "content-type"]);
  });
});

describe("AC-STATUS safe HTTP classification and no implicit retry", () => {
  const matrix = [
    [400, "UPSTREAM_REQUEST", false, false], [401, "UPSTREAM_AUTH", false, false],
    [402, "UPSTREAM_PAYMENT", false, false], [403, "UPSTREAM_FORBIDDEN", false, false],
    [404, "UPSTREAM_NOT_FOUND", false, false], [413, "INPUT_TOO_LARGE", false, false],
    [429, "UPSTREAM_RATE_LIMIT", true, false], [500, "UPSTREAM_UNAVAILABLE", true, true],
    [502, "UPSTREAM_UNAVAILABLE", true, true], [503, "UPSTREAM_UNAVAILABLE", true, true],
    [524, "UPSTREAM_TIMEOUT", true, true], [529, "UPSTREAM_UNAVAILABLE", true, true],
    [501, "UPSTREAM_UNAVAILABLE", true, true], [599, "UPSTREAM_UNAVAILABLE", true, true],
    [418, "UPSTREAM_REQUEST", false, false], [408, "UPSTREAM_REQUEST", false, false],
    [300, "UPSTREAM_PROTOCOL", false, true], [302, "UPSTREAM_PROTOCOL", false, true],
    [304, "UPSTREAM_PROTOCOL", false, true],
  ] as const;
  it.each(matrix)("status %i -> %s", async (status, code, retryable, uncertain) => {
    const reflected = status === 304 ? null : `${keyCanary} ${contextCanary}`;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(reflected, { status }));
    const result = await client(fetch).request(prepared(), execution());
    expect(failure(result)).toMatchObject({ code, http_status: status, retryable, billing_uncertain: uncertain });
    expect(result.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result).includes(keyCanary)).toBe(false);
    expect(JSON.stringify(result).includes(contextCanary)).toBe(false);
  });
  it.each([400, 401, 402, 403, 404, 413, 408, 418, 501, 599, 302])("explicit retries do not repeat status %i", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response("rejected", { status }));
    await client(fetch).request(prepared(), execution({ max_retries: 2 }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC-ATTEMPTS and AC-RETRY-AFTER", () => {
  it.each([0, 1, 2])("network failures with retries=%i have exact attempt bound", async (retries) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(keyCanary));
    const pending = client(fetch).request(prepared(), execution({ max_retries: retries }));
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.attempts).toBe(retries + 1);
    expect(fetch).toHaveBeenCalledTimes(retries + 1);
    expect(failure(result)).toMatchObject({ code: "NETWORK_ERROR", retryable: true, billing_uncertain: true });
  });
  it.each([429, 500, 502, 503, 524, 529])("explicit retries repeat only allowed HTTP %i", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response("fail", { status }));
    const pending = client(fetch).request(prepared(), execution({ max_retries: 2 }));
    await vi.advanceTimersByTimeAsync(750);
    const result = await pending;
    expect(result.attempts).toBe(3);
    expect(result.elapsed_ms).toBe(750);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(failure(result).http_status).toBe(status);
  });
  it("exponential delays include bounded deterministic jitter", async () => {
    const calls: number[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => { calls.push(Date.now()); throw new Error(contextCanary); });
    const pending = client(fetch, config(), () => 1).request(prepared(), execution({ max_retries: 2 }));
    await vi.advanceTimersByTimeAsync(1250);
    expect((await pending).attempts).toBe(3);
    expect(calls.map((t) => t - calls[0])).toEqual([0, 500, 1250]);
  });
  it.each(["1", "Thu, 01 Jan 2026 00:00:01 GMT"])("Retry-After %s inside budget", async (retryAfter) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "Retry-After": retryAfter } })).mockResolvedValueOnce(ok());
    const pending = client(fetch).request(prepared(), execution({ max_retries: 1, timeout_ms: 2000 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ success: true, attempts: 2, elapsed_ms: 1000, billing_uncertain: false });
  });
  it.each(["2", "1", "999999999999999999999999999999999999"])("Retry-After %s reaches deadline without retry", async (retryAfter) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("rate", { status: 429, headers: { "Retry-After": retryAfter } }));
    const pending = client(fetch).request(prepared(), execution({ max_retries: 2, timeout_ms: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(failure(result)).toMatchObject({ code: "UPSTREAM_TIMEOUT", retryable: true, billing_uncertain: false });
    expect(result).toMatchObject({ attempts: 1, elapsed_ms: 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid", "-1", "Thu, 01 Jan 2020 00:00:00 GMT"])("invalid/past Retry-After uses backoff: %s", async (value) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "Retry-After": value } })).mockResolvedValueOnce(ok());
    const pending = client(fetch).request(prepared(), execution({ max_retries: 1 }));
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ success: true, attempts: 2, elapsed_ms: 250 });
  });
  it("uncertain billing survives a later success or known rejection", async () => {
    for (const last of [ok(), new Response("auth", { status: 401 })]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValueOnce(new Error(contextCanary)).mockResolvedValueOnce(last);
      const pending = client(fetch).request(prepared(), execution({ max_retries: 1 }));
      await vi.advanceTimersByTimeAsync(250);
      expect(await pending).toMatchObject({ attempts: 2, billing_uncertain: true });
    }
  });
  it("cancel in rate-limit backoff retains a known billing result", async () => {
    const abort = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("rate", { status: 429 }));
    const pending = client(fetch).request(prepared(), execution({ max_retries: 2 }), abort.signal);
    await flush(); abort.abort(contextCanary);
    const result = await pending;
    expect(result).toMatchObject({ attempts: 1, billing_uncertain: false });
    expect(failure(result)).toMatchObject({ code: "CANCELLED", retryable: false, billing_uncertain: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC-QUEUE persistent bounded FIFO across calls", () => {
  it("shares concurrency, rejects overflow before send and transfers slots FIFO", async () => {
    const holds = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const order: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => { order.push(init!.body as string); return holds[order.length - 1].promise; });
    const c = client(fetch);
    const first = c.request({ bodyJson: "first" }, execution());
    const second = c.request({ bodyJson: "second" }, execution());
    const third = c.request({ bodyJson: "third" }, execution());
    const overflow = await c.request(prepared(), execution());
    expect(overflow).toMatchObject({ attempts: 0, billing_uncertain: false });
    expect(failure(overflow)).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect(order).toEqual(["first"]);
    holds[0].resolve(ok()); await first; await flush();
    expect(order).toEqual(["first", "second"]);
    holds[1].resolve(ok()); await second; await flush();
    expect(order).toEqual(["first", "second", "third"]);
    holds[2].resolve(ok()); await third;
  });
  it("queue deadline has attempts=0 and removes waiter", async () => {
    const hold = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(hold.promise).mockResolvedValue(ok());
    const c = client(fetch, config({ max_queue: 1 }));
    const first = c.request(prepared(), execution());
    const queued = c.request(prepared(), execution({ timeout_ms: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    const result = await queued;
    expect(result).toMatchObject({ attempts: 0, elapsed_ms: 1000, billing_uncertain: false });
    expect(failure(result)).toMatchObject({ code: "UPSTREAM_TIMEOUT", retryable: true });
    const later = c.request(prepared(), execution());
    hold.resolve(ok()); await first;
    expect(await later).toMatchObject({ success: true, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("zero queue permits active concurrency but rejects waiting requests", async () => {
    const holds = [deferred<Response>(), deferred<Response>()];
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(holds[0].promise).mockReturnValueOnce(holds[1].promise);
    const c = client(fetch, config({ max_concurrency: 2, max_queue: 0 }));
    const first = c.request(prepared(), execution());
    const second = c.request(prepared(), execution());
    const third = await c.request(prepared(), execution());
    expect(third.attempts).toBe(0); expect(failure(third).code).toBe("UPSTREAM_UNAVAILABLE");
    await flush(); expect(fetch).toHaveBeenCalledTimes(2);
    // Each fetch must own its own response stream.
    for (const hold of holds) hold.resolve(new Response("null"));
    expect((await Promise.all([first, second])).every((result) => result.success)).toBe(true);
  });
});

describe("AC-DEADLINE total queue/backoff/headers/body budget", () => {
  it("successful delayed headers and body report total monotonic elapsed", async () => {
    const headers = deferred<Response>(); const body = stream();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(headers.promise);
    const pending = client(fetch).request(prepared(), execution({ timeout_ms: 1000 }));
    await vi.advanceTimersByTimeAsync(300); headers.resolve(body.response); await flush();
    await vi.advanceTimersByTimeAsync(400); body.source.enqueue(Buffer.from(JSON.stringify(responseBody))); body.source.close();
    expect(await pending).toMatchObject({ success: true, attempts: 1, elapsed_ms: 700 });
  });
  it("monotonic clock enforces expiry before send without resetting phase budget", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    let tick = 0;
    const c = createDecisionClient(config(), { fetch, now: () => { const t = tick; tick += 500; return t; } });
    const result = await c.request(prepared(), execution({ timeout_ms: 1000 }));
    expect(result.attempts).toBe(0);
    expect(failure(result)).toMatchObject({ code: "UPSTREAM_TIMEOUT", billing_uncertain: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("wall-clock jumps do not change monotonic elapsed or deadline", async () => {
    let tick = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      vi.setSystemTime(new Date("2099-01-01T00:00:00Z")); tick = 500; return ok();
    });
    const c = createDecisionClient(config(), { fetch, now: () => tick });
    expect(await c.request(prepared(), execution({ timeout_ms: 1000 }))).toMatchObject({ success: true, elapsed_ms: 500 });
  });
  it("queue time is not reset on acquiring a slot", async () => {
    const firstHeaders = deferred<Response>();
    const secondHeaders = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(firstHeaders.promise).mockReturnValueOnce(secondHeaders.promise).mockResolvedValue(ok());
    const c = client(fetch);
    const first = c.request(prepared(), execution());
    const queued = c.request(prepared(), execution({ timeout_ms: 1000 }));
    await vi.advanceTimersByTimeAsync(800); firstHeaders.resolve(ok()); await first; await flush();
    await vi.advanceTimersByTimeAsync(200);
    const result = await queued;
    expect(result).toMatchObject({ attempts: 1, elapsed_ms: 1000 });
    expect(failure(result).code).toBe("UPSTREAM_TIMEOUT");
    secondHeaders.resolve(ok()); await flush();
    expect(await c.request(prepared(), execution())).toMatchObject({ success: true });
  });
  it("retry consumes the original budget including delayed body", async () => {
    const body = stream();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => { await new Promise((r) => setTimeout(r, 600)); throw new Error(contextCanary); }).mockResolvedValueOnce(body.response).mockResolvedValue(ok());
    const c = client(fetch);
    const pending = c.request(prepared(), execution({ timeout_ms: 1000, max_retries: 2 }));
    await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toMatchObject({ attempts: 2, elapsed_ms: 1000, billing_uncertain: true });
    expect(failure(result).code).toBe("UPSTREAM_TIMEOUT");
    expect(body.cancel).toHaveBeenCalledTimes(1);
    expect(await c.request(prepared(), execution())).toMatchObject({ success: true });
  });
  it("header timeout aborts fetch and cancels a late response", async () => {
    const headers = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(headers.promise);
    const pending = client(fetch).request(prepared(), execution({ timeout_ms: 1000, max_retries: 2 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(failure(await pending)).toMatchObject({ code: "UPSTREAM_TIMEOUT", billing_uncertain: true });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const late = stream(); headers.resolve(late.response); await flush();
    expect(late.cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC-CANCEL and AC-CLEANUP", () => {
  it("abort after slot grant but before fetch keeps attempts=0 and releases slot", async () => {
    const abort = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok());
    const c = client(fetch);
    const pending = c.request(prepared(), execution(), abort.signal);
    abort.abort(contextCanary);
    const result = await pending;
    expect(result).toMatchObject({ attempts: 0, billing_uncertain: false });
    expect(failure(result).code).toBe("CANCELLED");
    expect(fetch).not.toHaveBeenCalled();
    expect(await c.request(prepared(), execution())).toMatchObject({ success: true });
  });
  it("preabort sends nothing and never leaks caller reason", async () => {
    const signal = new AbortController(); signal.abort(new Error(keyCanary));
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await client(fetch).request(prepared(), execution(), signal.signal);
    expect(result).toMatchObject({ attempts: 0, billing_uncertain: false });
    expect(failure(result)).toMatchObject({ code: "CANCELLED", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result).includes(keyCanary)).toBe(false);
    expect(getEventListeners(signal.signal, "abort")).toHaveLength(0);
  });
  it("queued abort removes waiter and frees queue capacity", async () => {
    const hold = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(hold.promise).mockResolvedValue(ok());
    const c = client(fetch, config({ max_queue: 1 }));
    const first = c.request(prepared(), execution());
    const abort = new AbortController();
    const queued = c.request(prepared(), execution(), abort.signal);
    abort.abort(keyCanary);
    const cancelled = await queued;
    expect(cancelled).toMatchObject({ attempts: 0, billing_uncertain: false });
    expect(failure(cancelled).code).toBe("CANCELLED");
    const later = c.request(prepared(), execution());
    hold.resolve(ok()); await first;
    expect(await later).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
  it.each(["headers", "body", "backoff"])("cancel during %s stops retry and recovers slot", async (phase) => {
    const abort = new AbortController();
    const hold = deferred<Response>();
    const body = stream();
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (phase === "headers") fetch.mockReturnValueOnce(hold.promise);
    else if (phase === "body") fetch.mockResolvedValueOnce(body.response);
    else fetch.mockRejectedValueOnce(new Error(contextCanary));
    fetch.mockResolvedValue(ok());
    const c = client(fetch);
    const pending = c.request(prepared(), execution({ max_retries: 2 }), abort.signal);
    await flush(); abort.abort(new Error(keyCanary));
    const result = await pending;
    expect(result).toMatchObject({ attempts: 1, billing_uncertain: true });
    expect(failure(result)).toMatchObject({ code: "CANCELLED", retryable: false });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (phase === "body") expect(body.cancel).toHaveBeenCalledTimes(1);
    if (phase === "headers") hold.resolve(ok());
    expect(await c.request(prepared(), execution())).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  });
  it.each(["success", "http", "protocol", "network"])("releases timers, listeners and slot after %s", async (outcome) => {
    const abort = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (outcome === "network") fetch.mockRejectedValueOnce(new Error(contextCanary));
    else fetch.mockResolvedValueOnce(outcome === "success" ? ok() : new Response(outcome === "protocol" ? "bad" : "reject", { status: outcome === "http" ? 401 : 200 }));
    fetch.mockResolvedValue(ok());
    const c = client(fetch);
    await c.request(prepared(), execution(), abort.signal);
    expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(fetch.mock.calls[0][1]!.signal!, "abort")).toHaveLength(0);
    expect(await c.request(prepared(), execution())).toMatchObject({ success: true });
  });
});

describe("AC-BYTES actual bounded response and AC-REDACTION", () => {
  it.each(["html", "broken-json", "empty", "invalid-utf8"])("non-JSON %s is safe protocol error without retry", async (kind) => {
    const text = kind === "html" ? `<html>${keyCanary} ${contextCanary}</html>` : kind === "broken-json" ? `{${contextCanary}` : "";
    const body = kind === "invalid-utf8" ? new Uint8Array([0xff]) : text;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
    const result = await client(fetch).request(prepared(), execution({ max_retries: 2 }));
    expect(failure(result)).toMatchObject({ code: "UPSTREAM_PROTOCOL", retryable: false, billing_uncertain: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result).includes(keyCanary)).toBe(false);
    expect(JSON.stringify(result).includes(contextCanary)).toBe(false);
  });
  it.each([undefined, "1", "999999"])("chunk bytes enforce limit regardless of Content-Length=%s", async (length) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(Buffer.from('"😀')); c.enqueue(Buffer.from('😀"')); }, cancel,
    });
    const headers: Record<string, string> = length === undefined ? {} : { "Content-Length": length };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { headers }));
    const result = await client(fetch, config({ max_response_bytes: 8 })).request(prepared(), execution({ max_retries: 2 }));
    expect(failure(result).code).toBe("UPSTREAM_PROTOCOL");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts exact byte limit and split multibyte UTF-8", async () => {
    const bytes = Buffer.from('"😀"');
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.subarray(0, 3)); c.enqueue(bytes.subarray(3)); c.close(); } });
    const result = await client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body)), config({ max_response_bytes: bytes.length })).request(prepared(), execution());
    expect(result).toMatchObject({ success: true, body: "😀" });
  });
  it("body network failure is classified safely and may retry explicitly", async () => {
    const body = stream();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(body.response).mockResolvedValueOnce(ok());
    const pending = client(fetch).request(prepared(), execution({ max_retries: 1 }));
    await flush(); body.source.error(new Error(`${keyCanary} ${contextCanary}`));
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ success: true, attempts: 2, billing_uncertain: true });
  });
  it("reflected transport/body errors never log or expose raw material", async () => {
    const log = vi.spyOn(console, "log"); const error = vi.spyOn(console, "error"); const warn = vi.spyOn(console, "warn");
    for (const phase of ["fetch", "body"]) {
      const body = stream();
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (phase === "fetch") fetch.mockRejectedValue(new Error(`${keyCanary} ${contextCanary}`));
      else fetch.mockResolvedValue(body.response);
      const pending = client(fetch).request(prepared(), execution());
      await flush(); if (phase === "body") body.source.error(new Error(`${keyCanary} ${contextCanary}`));
      const result = await pending;
      expect(failure(result).code).toBe("NETWORK_ERROR");
      expect(JSON.stringify(result).includes(keyCanary)).toBe(false);
      expect(JSON.stringify(result).includes(contextCanary)).toBe(false);
    }
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it("AC-REDIRECT denies Location without a second fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(contextCanary, { status: 307, headers: { Location: "https://example.org/forbidden" } }));
    const result = await client(fetch).request(prepared(), execution({ max_retries: 2 }));
    expect(failure(result)).toMatchObject({ code: "UPSTREAM_PROTOCOL", http_status: 307, retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("rejects already-redirected injected response", async () => {
    const response = ok(); Object.defineProperty(response, "redirected", { value: true });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(failure(await client(fetch).request(prepared(), execution({ max_retries: 2 }))).code).toBe("UPSTREAM_PROTOCOL");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("successful JSON bypasses HTTP Content-Type and preserves unknowns for S4", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ opaque: "S4 owns schema filtering" }), { status: 201, headers: { "Content-Type": "text/plain" } }));
    expect(await client(fetch).request(prepared(), execution())).toMatchObject({ success: true, body: { opaque: "S4 owns schema filtering" } });
  });
});

describe("AC-OVERRIDES effective execution", () => {
  it("config defaults do not cap valid explicit execution", async () => {
    const cfg = config({ timeout_ms: 1000, max_retries: 0 });
    const p = prepareDecision({ state: "", questions: { q: { type: "noul", instructions: "" } }, execution: { timeout_ms: 2000, max_retries: 1 } }, cfg);
    if (!p.success) throw new Error("Synthetic preparation failed");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "Retry-After": "1" } })).mockResolvedValueOnce(ok());
    const pending = client(fetch, cfg).request(p.data, p.data.effectiveExecution);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ success: true, attempts: 2 });
  });
  it.each([
    { timeout_ms: 999 }, { timeout_ms: 120001 }, { timeout_ms: NaN }, { timeout_ms: 1000.5 },
    { max_retries: -1 }, { max_retries: 3 }, { max_retries: 0.5 }, { dry_run: true },
  ])("invalid/direct dry-run execution never sends: %j", async (override) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await client(fetch).request(prepared(), execution(override));
    expect(failure(result)).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false, billing_uncertain: false });
    expect(result.attempts).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("AC-DIST compiled S5", () => {
  it("runs built transport with S3/S4 in a standalone dist copy", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "decision-d04-"));
    try {
      cpSync(resolve("dist"), resolve(dir, "dist"), { recursive: true });
      mkdirSync(resolve(dir, "node_modules"));
      cpSync(resolve("node_modules/zod"), resolve(dir, "node_modules/zod"), { recursive: true });
      const script = `
        import assert from "node:assert/strict";
        import { createDecisionClient } from "./dist/decision/client.js";
        import { prepareDecision } from "./dist/decision/request.js";
        import { validateResponse } from "./dist/decision/response.js";
        const key = ["SYNTHETIC", "ONLY"].join("_");
        const config = { api_key:key, default_model:"m", allowed_models:["m"],
          provider_defaults:{}, required_provider:{zdr:true}, timeout_ms:1000,max_retries:0,
          max_request_bytes:2000,max_response_bytes:2000,max_concurrency:1,max_queue:0 };
        const p = prepareDecision({state:"synthetic",questions:{q:{type:"noul",instructions:"check"}}},config);
        assert.equal(p.success,true);
        let calls = 0;
        const client = createDecisionClient(config, { fetch: async (url, init) => {
          calls++;
          assert.equal(url,"https://openrouter.ai/api/alpha/decisions");
          assert.equal(init.method,"POST"); assert.equal(init.redirect,"manual");
          assert.ok(init.body === p.data.bodyJson);
          assert.ok(new Headers(init.headers).get("Authorization") === "Bearer " + key);
          assert.equal(JSON.parse(init.body).provider.zdr,true);
          return new Response(JSON.stringify({model:"actual",answers:{q:{type:"noul",noul:0.9}},usage:{input_tokens:1,output_tokens:0}}));
        } });
        const r = await client.request(p.data,p.data.effectiveExecution);
        assert.equal(r.success,true); assert.equal(r.attempts,1); assert.equal(calls,1);
        assert.equal(validateResponse(r.body,p.data).success,true);
        console.log("D04_DIST_PASS");
      `;
      expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }).trim()).toBe("D04_DIST_PASS");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
