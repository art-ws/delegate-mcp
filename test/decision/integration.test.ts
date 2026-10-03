import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as httpServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ToolContext } from "../../src/tools.js";
import { createDecisionHandler, registerDecisionTool } from "../../src/decision/tool.js";
import { loadDecisionSetup } from "../../src/decision/config.js";
import { prepareDecision } from "../../src/decision/request.js";
import { decisionInputJsonSchema, decisionOutputJsonSchema, validateDecisionEnvelope, type DecisionArgs, type DecisionEnvelope } from "../../src/decision/schemas.js";

const root = resolve(".");
const key = ["SYNTHETIC", "D06", "KEY", "CANARY"].join("_");
const canary = ["SYNTHETIC", "D06", "CONTEXT", "CANARY"].join("_");
const preload = join(root, "test/decision/fixtures/d06-preload.cjs");
const full = JSON.parse(readFileSync(join(root, "test/decision/fixtures/input-full.json"), "utf8")) as DecisionArgs;
const basic = (scenario = "ok"): DecisionArgs => ({ state: { scenario, context: canary }, questions: { q: { type: "noul", instructions: "Synthetic?" } } });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

function valid(body: DecisionArgs) {
  const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
    if (question.type === "choice") return [id, { type: "choice", choice: Object.keys(question.criteria)[0] }];
    if (question.type === "score") return [id, { type: "score", score: 0 }];
    return [id, { type: "noul", noul: 0.5 }];
  }));
  return { model: "typesafe/jev-1.13", answers, usage: { input_tokens: 7, output_tokens: 2 }, extra: canary };
}

async function fixture(block: unknown = { api_key: "env:D06_SYNTHETIC_KEY" }, options: { metrics?: boolean; brokenMetrics?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "delegate-d06-"));
  const wire: Array<{ text: string; body: DecisionArgs; headers: Record<string, string | string[] | undefined> }> = [];
  const legacy: Array<Record<string, unknown>> = [];
  const hanging: ServerResponse[] = [];
  const counts = new Map<string, number>();
  const server = httpServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    if (req.url === "/decision") {
      wire.push({ text, body, headers: req.headers });
      const scenario = body.state?.scenario ?? "ok";
      const n = (counts.get(scenario) ?? 0) + 1;
      counts.set(scenario, n);
      if (scenario === "hold") { hanging.push(res); return; }
      if (scenario === "body") { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); hanging.push(res); return; }
      if (scenario === "retry") { res.writeHead(503, { "Retry-After": "2" }); res.end(canary + key); return; }
      if (scenario.startsWith("http-")) { res.writeHead(Number(scenario.slice(5))); res.end(canary + key); return; }
      if (scenario === "bill-error") {
        if (n === 1) res.destroy();
        else { res.writeHead(401); res.end(canary + key); }
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (scenario === "html") { res.end("<html>" + canary + key); return; }
      const result = valid(body);
      if (scenario === "bad") result.answers = { q: { type: "noul", noul: 2, reflected: canary + key } };
      if (scenario === "missing") delete (result as Partial<typeof result>).usage;
      if (scenario === "bill" && n === 1) { res.destroy(); return; }
      res.end(JSON.stringify(result));
    } else {
      legacy.push(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "synthetic-chat", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "synthetic legacy answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 3 } }));
    }
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected owned free port");
  const origin = `http://127.0.0.1:${address.port}`;
  const metrics = join(dir, "decision.jsonl");
  const legacyMetrics = join(dir, "legacy.jsonl");
  const sessions = join(dir, "sessions");
  const enabled = block === null ? undefined : { ...(block as object),
    ...(options.metrics ? { metrics_file: options.brokenMetrics ? join(dir, "missing-parent", "decision.jsonl") : metrics } : {}) };
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ providers: [{ name: "synthetic-reader", base_url: `${origin}/v1`, api_key: "env:D06_LEGACY_KEY", default_model: "synthetic-reader-model" }], session_dir: sessions, metrics_file: legacyMetrics, decision: enabled }));
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--require", preload, join(root, "dist/index.js"), "--config", configPath],
    cwd: dir,
    env: { HOME: dir, PATH: process.env.PATH ?? "", D06_SYNTHETIC_ORIGIN: origin, D06_SYNTHETIC_KEY: key, D06_LEGACY_KEY: "synthetic-reader-key", OPENROUTER_API_KEY: key },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (data) => { stderr += data.toString(); });
  const client = new Client({ name: "d06-stdio-fixture", version: "1" });
  const protocolErrors: unknown[] = [];
  client.onerror = (error) => { protocolErrors.push(error); };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await client.close();
    expect(protocolErrors).toEqual([]);
    for (const response of hanging) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
    rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(close);
  await client.connect(transport);
  const call = async (args: unknown = basic(), signal?: AbortSignal): Promise<DecisionEnvelope> => {
    const result = await client.callTool({ name: "decision", arguments: args as Record<string, unknown> }, CallToolResultSchema, { signal }) as CallToolResult;
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    if (result.content[0].type !== "text") throw new Error("Expected JSON text");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(validateDecisionEnvelope(result.structuredContent).success).toBe(true);
    const envelope = result.structuredContent as DecisionEnvelope;
    expect(result.isError).toBe(envelope.kind === "error");
    expect(envelope.meta.api_version).toBe("alpha-decisions");
    expect(JSON.stringify(envelope).includes(key)).toBe(false);
    return envelope;
  };
  return { client, call, wire, legacy, dir, sessions, metrics, legacyMetrics, configPath, transport, close, stderr: () => stderr };
}

function error(envelope: DecisionEnvelope, code: string, attempts = 0) {
  expect(envelope.kind).toBe("error");
  if (envelope.kind !== "error") throw new Error("Expected error");
  expect(envelope.error.code).toBe(code);
  expect(envelope.meta.attempts).toBe(attempts);
  expect(JSON.stringify(envelope).includes(canary)).toBe(false);
  return envelope.error;
}
function rows(path: string): Array<Record<string, unknown>> {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s)) : [];
}

describe("D06 real stdio inventory, schemas and configuration", () => {
  it.each(["absent", "disabled", "ready"])("D06-INVENTORY/D06-SCHEMAS %s", async (mode) => {
    const f = await fixture(mode === "absent" ? null : mode === "disabled" ? { enabled: false, api_key: "env:MISSING_SYNTHETIC_KEY", unknown: canary } : { api_key: "env:D06_SYNTHETIC_KEY" });
    const listed = await f.client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(mode === "disabled" ? ["analyze", "query", "resume"] : ["analyze", "decision", "query", "resume"]);
    if (mode !== "disabled") {
      const tool = listed.tools.find((t) => t.name === "decision")!;
      expect(tool.inputSchema).toEqual(decisionInputJsonSchema);
      expect(tool.outputSchema).toEqual(decisionOutputJsonSchema);
      expect(tool.inputSchema).toEqual(JSON.parse(readFileSync("/opt/art/p/delegate-mcp/docs/decision/input.schema.json", "utf8")));
      expect(tool.outputSchema).toEqual(JSON.parse(readFileSync("/opt/art/p/delegate-mcp/docs/decision/output.schema.json", "utf8")));
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      expect(tool.execution).toEqual({ taskSupport: "forbidden" });
      expect(tool.description).toMatch(/external API/);
    }
    if (mode === "absent") for (const execution of [{ dry_run: true }, { dry_run: false }]) {
      expect(error(await f.call({ ...basic(), execution }), "CONFIG_ERROR").billing_uncertain).toBe(false);
      expect(f.wire).toHaveLength(0);
    }
    if (mode === "disabled") {
      const result = await f.client.callTool({ name: "decision", arguments: basic() });
      expect(result.isError).toBe(true); // unchanged SDK unknown-tool behavior
      expect(f.wire).toHaveLength(0);
    }
  });

  it.each([{ api_key: "env:MISSING_SYNTHETIC_KEY" }, { api_key: "env:D06_SYNTHETIC_KEY", unknown: canary }])("D06-STARTUP invalid enabled config fails loud", async (decision) => {
    const dir = mkdtempSync(join(tmpdir(), "d06-startup-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ providers: [{ name: "p", base_url: "https://synthetic.invalid/v1", api_key: "env:D06_LEGACY_KEY", default_model: "m" }], decision }));
    const child = spawn(process.execPath, [join(root, "dist/index.js"), "--config", path], { env: { HOME: dir, D06_LEGACY_KEY: "synthetic-key", D06_SYNTHETIC_KEY: key }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (s) => { stdout += s; }); child.stderr.on("data", (s) => { stderr += s; });
    const rc = await new Promise<number | null>((yes) => child.on("exit", yes));
    expect(rc).toBe(1); expect(stdout).toBe(""); expect(stderr).toContain("fatal");
    expect(stderr.includes(key) || stderr.includes(canary)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("D06 stdio pipeline and isolation", () => {
  it("D06-PIPELINE/D06-DRY all primitives/full provider body, exact bytes and local fields", async () => {
    const raw = { api_key: "env:D06_SYNTHETIC_KEY", default_model: "typesafe/jev-1.13", allowed_models: ["~typesafe/jev-latest", "typesafe/jev-1.13"], required_provider: { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe"] }, http_referer: "https://example.org", app_title: "Synthetic decision" };
    const f = await fixture(raw, { metrics: true });
    await f.client.listTools();
    const setup = loadDecisionSetup(raw, { env: { D06_SYNTHETIC_KEY: key }, home: f.dir, legacyMetricsFile: f.legacyMetrics });
    if (setup.status !== "ready") throw new Error("Expected ready");
    const prepared = prepareDecision(full, setup.config);
    if (!prepared.success) throw new Error("Expected prepared");
    const dry = await f.call(full);
    expect(dry).toMatchObject({ kind: "dry_run", request: prepared.data.body, meta: { attempts: 0 } });
    expect(f.wire).toHaveLength(0);
    const args = { ...full, execution: { dry_run: false } };
    const actualPrepared = prepareDecision(args, setup.config);
    if (!actualPrepared.success) throw new Error("Expected prepared");
    const decision = await f.call(args);
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision") throw new Error("Expected decision");
    expect(decision.meta.attempts).toBe(1);
    expect(f.wire[0].text).toBe(actualPrepared.data.bodyJson);
    expect(f.wire[0].body).toEqual(actualPrepared.data.body);
    expect(Object.keys(f.wire[0].body.provider ?? {})).toHaveLength(14);
    expect(f.wire[0].headers.authorization === `Bearer ${key}`).toBe(true);
    expect(f.wire[0].headers["http-referer"]).toBe("https://example.org");
    expect(f.wire[0].headers["x-title"]).toBe("Synthetic decision");
    expect(f.wire[0].headers.session_id).toBeUndefined();
    expect(f.wire[0].text.includes("policy") || f.wire[0].text.includes("execution") || f.wire[0].text.includes(key)).toBe(false);
    expect(decision.assessments.pick).toMatchObject({ status: "uncertain", reasons: ["missing_metric"] });
    expect(decision.result.usage).toEqual({ input_tokens: 7, output_tokens: 2 });
    expect(decision.meta.warnings).toContain("missing_optional_metrics");
    expect(decision.result).not.toHaveProperty("extra");
    await vi.waitFor(() => expect(rows(f.metrics)).toHaveLength(2));
    expect(rows(f.metrics).map((r) => r.status)).toEqual(["dry_run", "success"]);
    expect(f.legacy).toHaveLength(0); expect(existsSync(f.legacyMetrics)).toBe(false); expect(existsSync(f.sessions)).toBe(false);
    expect(f.stderr().includes(canary) || f.stderr().includes(key)).toBe(false);
  });

  it.each([{}, { ...basic(), messages: [canary + key] }, { ...basic(), policy: { q: { type: "noul", false_max: 0.9, true_min: 0.1 } } }])("D06-ERROR semantic safe INVALID_ARGUMENT and recovery", async (args) => {
    const f = await fixture(); await f.client.listTools();
    expect(error(await f.call(args), "INVALID_ARGUMENT")).not.toHaveProperty("http_status");
    expect(f.wire).toHaveLength(0);
    expect((await f.call()).kind).toBe("decision"); expect(f.wire).toHaveLength(1);
  });
  it("D06-ERROR JSON prototype keys are not lost by SDK preprocessing", async () => {
    const f = await fixture();
    const args = JSON.parse(JSON.stringify(basic()).slice(0, -1) + ',"__proto__":{"reflected":"synthetic"}}');
    error(await f.call(args), "INVALID_ARGUMENT");
    expect(f.wire).toHaveLength(0);
    expect((await f.call()).kind).toBe("decision");
  });
  it.each(["bad", "missing", "html"])("D06-ERROR invalid upstream %s preserves billing and recovers", async (scenario) => {
    const f = await fixture(); await f.client.listTools();
    const failed = error(await f.call(basic(scenario)), "UPSTREAM_PROTOCOL", 1);
    expect(failed.billing_uncertain).toBe(true); expect(failed.retryable).toBe(false);
    if (scenario !== "html") expect(failed).not.toHaveProperty("http_status");
    expect((await f.call()).kind).toBe("decision");
    expect(f.stderr().includes(canary) || f.stderr().includes(key)).toBe(false);
  });
  it.each([[400, "UPSTREAM_REQUEST"], [401, "UPSTREAM_AUTH"], [402, "UPSTREAM_PAYMENT"], [403, "UPSTREAM_FORBIDDEN"], [404, "UPSTREAM_NOT_FOUND"], [413, "INPUT_TOO_LARGE"], [429, "UPSTREAM_RATE_LIMIT"], [503, "UPSTREAM_UNAVAILABLE"], [524, "UPSTREAM_TIMEOUT"]])("D06-ERROR HTTP %s safe classification", async (status, code) => {
    const f = await fixture(); await f.client.listTools();
    const failed = error(await f.call(basic(`http-${status}`)), String(code), 1);
    expect(failed.http_status).toBe(status); expect(f.wire).toHaveLength(1);
    expect((await f.call()).kind).toBe("decision");
  });
  it("D06-METRICS best effort IO and optional sink, uncertain/unassessed normal", async () => {
    const f = await fixture(null, { metrics: true, brokenMetrics: true });
    // Explicit ready fixture because null is the absent fixture sentinel.
    expect(error(await f.call(), "CONFIG_ERROR").billing_uncertain).toBe(false);
    const ready = await fixture({ api_key: "env:D06_SYNTHETIC_KEY" }, { metrics: true, brokenMetrics: true });
    const value = await ready.call();
    expect(value).toMatchObject({ kind: "decision", assessments: { q: { status: "unassessed", value: 0.5, reasons: [] } } });
    await vi.waitFor(() => expect(ready.stderr()).toContain("[decision] Metrics file write failed."));
    expect(ready.stderr().includes(key) || ready.stderr().includes(canary)).toBe(false);
    expect(existsSync(ready.legacyMetrics)).toBe(false);
  });
  it("D06-META combines S3/S4 warnings without inventing optional metrics", async () => {
    const f = await fixture();
    const result = await f.call({ state: "synthetic", questions: {
      choice: { type: "choice", instructions: "one", criteria: { a: null } },
      score: { type: "score", instructions: "one", criteria: ["one"] },
    } });
    expect(result).toMatchObject({ kind: "decision", meta: { requested_model: "~typesafe/jev-latest", attempts: 1 } });
    expect(result.meta.warnings.sort()).toEqual(["single_option", "degenerate_scale", "missing_optional_metrics"].sort());
    if (result.kind !== "decision") throw new Error("Expected decision");
    expect(result.result.answers.choice).not.toHaveProperty("confidence");
    expect(result.result.answers.score).not.toHaveProperty("probabilities");
    expect(result.result.usage).not.toHaveProperty("cost");
    expect(existsSync(f.metrics)).toBe(false);
  });
  it("D06-ERROR preserves attempts and uncertain billing across network retry", async () => {
    const f = await fixture();
    const result = await f.call({ ...basic("bill"), execution: { max_retries: 1 } });
    expect(result).toMatchObject({ kind: "decision", meta: { attempts: 2 } });
    expect(f.wire).toHaveLength(2);
  });
  it("D06-ERROR final transport error retains prior uncertain billing", async () => {
    const f = await fixture();
    const failed = error(await f.call({ ...basic("bill-error"), execution: { max_retries: 1 } }), "UPSTREAM_AUTH", 2);
    expect(failed.billing_uncertain).toBe(true); expect(failed.http_status).toBe(401);
    expect(f.wire).toHaveLength(2);
  });
  it("D06-SCHEMAS forbidden task request and malformed RPC do not reach transport", async () => {
    const f = await fixture(); await f.client.listTools();
    await expect(f.client.request({ method: "tools/call", params: { name: "decision", arguments: basic(), task: { ttl: 1000 } } }, CallToolResultSchema)).rejects.toThrow();
    await expect(f.client.request({ method: "tools/call", params: { name: "decision", arguments: "synthetic-malformed" } } as never, CallToolResultSchema)).rejects.toThrow();
    expect(f.wire).toHaveLength(0);
    expect((await f.call()).kind).toBe("decision");
  });
  it("D06-DRY mandatory provider/defaults and policy conflict stay local", async () => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", provider_defaults: { order: ["typesafe"] }, required_provider: { zdr: true, only: ["typesafe"] } });
    const dry = await f.call({ ...basic(), provider: null, execution: { dry_run: true } });
    expect(dry).toMatchObject({ kind: "dry_run", request: { provider: { zdr: true, only: ["typesafe"], order: ["typesafe"] } }, meta: { attempts: 0 } });
    error(await f.call({ ...basic(), provider: { zdr: false } }), "POLICY_CONFLICT");
    expect(f.wire).toHaveLength(0);
  });
});

describe("D06 actual SDK cancellation and legacy stdio", () => {
  it("D06-CANCEL persistent queue/overflow/queued cancellation and recovery", async () => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", max_concurrency: 1, max_queue: 1 });
    const firstAbort = new AbortController(), queuedAbort = new AbortController();
    const first = f.call({ ...basic("hold"), execution: { max_retries: 2 } }, firstAbort.signal).catch(() => "cancelled");
    await vi.waitFor(() => expect(f.wire).toHaveLength(1));
    const queued = f.call(basic(), queuedAbort.signal).catch(() => "cancelled");
    await f.client.ping();
    expect(error(await f.call(), "UPSTREAM_UNAVAILABLE").billing_uncertain).toBe(false);
    queuedAbort.abort(new Error(canary + key)); expect(await queued).toBe("cancelled");
    await f.client.ping();
    firstAbort.abort(new Error(canary + key)); expect(await first).toBe("cancelled");
    await f.client.ping();
    expect((await f.call()).meta.attempts).toBe(1);
    expect(f.wire).toHaveLength(2);
    await vi.waitFor(() => expect(rowsFromStderr(f.stderr()).filter((r) => r.error_code === "CANCELLED")).toHaveLength(2));
    expect(f.stderr().includes(key) || f.stderr().includes(canary)).toBe(false);
  });
  it.each(["body", "retry"])("D06-CANCEL during %s forbids retry and releases slot", async (scenario) => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", max_concurrency: 1 });
    const abort = new AbortController();
    const pending = f.call({ ...basic(scenario), execution: { max_retries: 2 } }, abort.signal).catch(() => "cancelled");
    await vi.waitFor(() => expect(f.wire).toHaveLength(1));
    await new Promise((yes) => setTimeout(yes, 50));
    abort.abort(new Error(canary + key)); expect(await pending).toBe("cancelled");
    await f.client.ping();
    expect((await f.call()).kind).toBe("decision");
    expect(f.wire).toHaveLength(2);
    await vi.waitFor(() => expect(rowsFromStderr(f.stderr()).some((r) => r.error_code === "CANCELLED" && r.attempts === 1)).toBe(true));
    expect(f.stderr().includes(key) || f.stderr().includes(canary)).toBe(false);
  });
  it("D06-CLOSE EOF cancels shared queued/in-flight work before process termination", async () => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", max_concurrency: 1, max_queue: 1 });
    const inFlight = f.call({ ...basic("hold"), execution: { max_retries: 2 } }).catch(() => "closed");
    await vi.waitFor(() => expect(f.wire).toHaveLength(1));
    const queued = f.call(basic()).catch(() => "closed");
    await f.client.ping();
    const start = performance.now();
    await f.client.close();
    expect(performance.now() - start).toBeLessThan(1800); // no client's 2s SIGTERM fallback
    expect(await inFlight).toBe("closed"); expect(await queued).toBe("closed");
    const cancelled = rowsFromStderr(f.stderr()).filter((r) => r.error_code === "CANCELLED");
    expect(cancelled.map((r) => r.attempts).sort()).toEqual([0, 1]);
    expect(f.wire).toHaveLength(1);
    expect(f.stderr().includes(canary) || f.stderr().includes(key)).toBe(false);
  });
  it("D06-CANCEL deadline includes queued time and slots recover", async () => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", max_concurrency: 1, max_queue: 1 });
    const cancel = new AbortController();
    const first = f.call(basic("hold"), cancel.signal).catch(() => "cancelled");
    await vi.waitFor(() => expect(f.wire).toHaveLength(1));
    const queued = await f.call({ ...basic(), execution: { timeout_ms: 1000, max_retries: 2 } });
    const failed = error(queued, "UPSTREAM_TIMEOUT");
    expect(failed.billing_uncertain).toBe(false); expect(failed).not.toHaveProperty("http_status");
    expect(queued.meta.elapsed_ms).toBeGreaterThanOrEqual(1000);
    cancel.abort(); await first; await f.client.ping();
    expect((await f.call()).kind).toBe("decision"); expect(f.wire).toHaveLength(2);
  });
  it.each(["ready", "absent", "disabled"])("D06-LEGACY %s headers/session/pool/metrics preserved", async (mode) => {
    const f = await fixture(mode === "absent" ? null : mode === "disabled" ? { enabled: false } : { api_key: "env:D06_SYNTHETIC_KEY" }, { metrics: mode === "ready" });
    await f.client.listTools();
    if (mode !== "disabled") await f.call({ ...basic(), session_id: "synthetic-upstream-only" });
    expect(existsSync(f.sessions)).toBe(false); expect(f.legacy).toHaveLength(0);
    const query = await f.client.callTool({ name: "query", arguments: { prompt: "synthetic query" } });
    expect(query.isError).toBeFalsy();
    const text = (query.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/^\[delegate query\] provider=synthetic-reader model=synthetic-reader-model in=11 out=3 session=/);
    const id = text.split("\n")[0].split("session=")[1];
    const resume = await f.client.callTool({ name: "resume", arguments: { session_id: id, prompt: "synthetic next" } });
    expect(resume.isError).toBeFalsy();
    expect((resume.content as Array<{ text: string }>)[0].text).toContain(`[delegate resume] provider=synthetic-reader model=synthetic-reader-model in=11 out=3 session=${id}`);
    const work = join(f.dir, "work"); mkdirSync(work); writeFileSync(join(work, "fixture.txt"), "synthetic file corpus");
    const analyze = await f.client.callTool({ name: "analyze", arguments: { work_dir: work, prompt: "synthetic summary" } });
    expect(analyze.isError).toBeFalsy();
    expect((analyze.content as Array<{ text: string }>)[0].text).toMatch(/^\[delegate analyze\]/);
    expect(f.legacy).toHaveLength(3);
    expect(JSON.stringify(f.legacy[1])).toContain("synthetic query"); expect(JSON.stringify(f.legacy[1])).toContain("synthetic next");
    expect(JSON.stringify(f.legacy[2])).toContain("synthetic file corpus");
    expect(f.legacy.every((r) => r.model === "synthetic-reader-model")).toBe(true);
    expect(readdirSync(f.sessions)).toHaveLength(2);
    expect(rows(f.legacyMetrics).map((r) => r.tool)).toEqual(["query", "resume", "analyze"]);
    expect(rows(f.metrics).map((r) => r.tool)).toEqual(mode === "ready" ? ["decision"] : []);
    const missing = await f.client.callTool({ name: "resume", arguments: { session_id: "synthetic-upstream-only", prompt: "no local session" } });
    expect(missing.isError).toBe(true);
    expect(f.legacy).toHaveLength(3);
  });
});

function rowsFromStderr(stderr: string): Array<Record<string, unknown>> {
  return stderr.split("\n").filter((s) => s.startsWith("{")).map((s) => JSON.parse(s));
}

describe("D06 internal injection contracts", () => {
  it("D06-SCHEMAS standalone S7 registrar publishes canonical declarations", async () => {
    const server = new McpServer({ name: "synthetic", version: "1" });
    registerDecisionTool(server, { metrics: { writeStderr: () => {} } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "synthetic", version: "1" }); await client.connect(a);
    const [tool] = (await client.listTools()).tools;
    expect(tool.inputSchema).toEqual(decisionInputJsonSchema); expect(tool.outputSchema).toEqual(decisionOutputJsonSchema);
    expect((await client.callTool({ name: "decision", arguments: basic() })).structuredContent).toMatchObject({ kind: "error", error: { code: "CONFIG_ERROR" } });
    await client.close();
  });
  it("D06-CANCEL pre-aborted signal returns a canonical safe envelope with zero attempts", async () => {
    const setup = loadDecisionSetup({ api_key: "env:D06_SYNTHETIC_KEY" }, { env: { D06_SYNTHETIC_KEY: key }, home: tmpdir(), legacyMetricsFile: "synthetic-legacy" });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const handle = createDecisionHandler({ setup, transport: { fetch }, metrics: { writeStderr: () => {} } });
    const abort = new AbortController(); abort.abort(new Error(canary + key));
    const result = await handle(basic(), abort.signal);
    const envelope = result.structuredContent as DecisionEnvelope;
    expect(validateDecisionEnvelope(envelope).success).toBe(true);
    expect(error(envelope, "CANCELLED").billing_uncertain).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("D06-META local ID/monotonic elapsed/warnings and S6 minimal projection", async () => {
    const setup = loadDecisionSetup({ api_key: "env:D06_SYNTHETIC_KEY" }, { env: { D06_SYNTHETIC_KEY: key }, home: tmpdir(), legacyMetricsFile: "synthetic-legacy" });
    const lines: string[] = [];
    let clock = 100;
    const handle = createDecisionHandler({ setup, requestId: () => "synthetic-local-id", now: () => clock,
      transport: { fetch: async () => { clock += 12.9; return new Response(JSON.stringify(valid(basic()))); } },
      metrics: { writeStderr: (s) => { lines.push(s); } },
    });
    const result = await handle(basic());
    expect(result.structuredContent).toMatchObject({ kind: "decision", meta: { request_id: "synthetic-local-id", requested_model: "~typesafe/jev-latest", elapsed_ms: 12, attempts: 1 } });
    expect(JSON.parse(lines[0])).toMatchObject({ request_id: "synthetic-local-id", requested_model: "~typesafe/jev-latest", actual_model: "typesafe/jev-1.13", elapsed_ms: 12, attempts: 1, status: "success", usage: { input_tokens: 7, output_tokens: 2 } });
    expect(Object.keys(JSON.parse(lines[0])).sort()).toEqual(["actual_model", "attempts", "elapsed_ms", "request_id", "requested_model", "status", "tool", "ts", "usage"].sort());
  });
  it("D06-META local injection failures cannot reflect raw values or break the envelope", async () => {
    const handle = createDecisionHandler({ now: () => { throw new Error(canary + key); }, requestId: () => { throw new Error(canary + key); }, metrics: { writeStderr: () => {} } });
    const result = await handle(basic());
    expect(validateDecisionEnvelope(result.structuredContent).success).toBe(true);
    expect(JSON.stringify(result).includes(canary) || JSON.stringify(result).includes(key)).toBe(false);
  });
  it("D06-META preparation errors report only allowed requested models", async () => {
    const f = await fixture({ api_key: "env:D06_SYNTHETIC_KEY", allowed_models: ["~typesafe/jev-latest", "typesafe/jev-1.13"], max_request_bytes: 1 });
    const oversized = await f.call({ ...basic(), model: "typesafe/jev-1.13" });
    error(oversized, "INPUT_TOO_LARGE"); expect(oversized.meta.requested_model).toBe("typesafe/jev-1.13");
    const rejected = await f.call({ ...basic(), model: canary + key });
    error(rejected, "INVALID_ARGUMENT"); expect(rejected.meta.requested_model).toBe("~typesafe/jev-latest");
    expect(f.wire).toHaveLength(0);
  });
  it("D06-INVENTORY undefined programmatic setup never uses legacy pool", async () => {
    const ctx = { config: {}, pool: { client: () => { throw new Error(canary); } }, decision: { metrics: { writeStderr: () => {} } } } as unknown as ToolContext;
    const server = createServer(ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "synthetic", version: "1" }); await client.connect(a);
    expect((await client.listTools()).tools).toHaveLength(4);
    expect((await client.callTool({ name: "decision", arguments: { ...basic(), execution: { dry_run: true } } })).structuredContent).toMatchObject({ kind: "error", error: { code: "CONFIG_ERROR" }, meta: { attempts: 0 } });
    await client.close();
  });
});
