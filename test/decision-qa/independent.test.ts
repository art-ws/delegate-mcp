import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisionSetup } from "../../dist/decision/config.js";
import { prepareDecision } from "../../dist/decision/request.js";
import { assess } from "../../dist/decision/assessment.js";
import { validateResponse } from "../../dist/decision/response.js";
import { createDecisionClient } from "../../dist/decision/client.js";
import { createDecisionHandler } from "../../src/decision/tool.ts";
import {
  decisionInputJsonSchema, decisionOutputJsonSchema, providerOptionSlugs,
  validateDecisionArgs, validateDecisionEnvelope,
} from "../../dist/decision/schemas.js";

// Fixture vectors are heterogeneous JSON objects; assertions below narrow each shape by case ID.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Vector = Record<string, any>;
const read = (name: string) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8")) as Vector;
const contract = read("contract-vectors.json");
const semantic = read("semantic-vectors.json");
const providers = read("provider-matrix.json");
const optionSlugs = read("provider-option-slugs.json");
const serverNode = process.env.Q01_SERVER_NODE ?? process.execPath;
const serverBin = process.env.Q01_SERVER_BIN ?? new URL("../../dist/index.js", import.meta.url).pathname;
const stdioPreload = process.env.Q01_STDIO_PRELOAD ?? new URL("./stdio-preload.cjs", import.meta.url).pathname;
const loadOptions = { env: { Q01_SYNTHETIC_KEY: "synthetic-key-canary" }, home: "/tmp/q01-synthetic-home", legacyMetricsFile: "/tmp/q01-legacy.jsonl" };
const setup = loadDecisionSetup({ api_key: "env:Q01_SYNTHETIC_KEY" }, loadOptions);
if (setup.status !== "ready") throw new Error("synthetic setup did not become ready");
const config = setup.config;
const semanticSetup = loadDecisionSetup({ api_key: "env:Q01_SYNTHETIC_KEY", default_model: "synthetic-model", allowed_models: ["synthetic-model"] }, loadOptions);
if (semanticSetup.status !== "ready") throw new Error("synthetic semantic setup did not become ready");
const semanticConfig = semanticSetup.config;
const baseArgs = { state: { synthetic: true }, questions: { q: { type: "noul", instructions: "synthetic?" } } };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Captured = { text: string; body: Vector; authorization: string | undefined; path: string | undefined };
async function loopbackFixture() {
  const requests: Captured[] = [];
  const legacyRequests: Captured[] = [];
  const counts = new Map<string, number>();
  const server: Server = createHttpServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    let body: Vector;
    try { body = JSON.parse(text) as Vector; } catch { res.writeHead(400).end(); return; }
    if (req.url === "/v1/chat/completions") {
      legacyRequests.push({ text, body, authorization: req.headers.authorization, path: req.url });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "synthetic-chat-id", choices: [{ index: 0, message: { role: "assistant", content: "synthetic reader reply" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
      return;
    }
    const route = body.state?.route ?? "ok";
    const count = (counts.get(route) ?? 0) + 1;
    counts.set(route, count);
    requests.push({ text, body, authorization: req.headers.authorization, path: req.url });
    if (route === "hold") return;
    if (route === "network-reset") { req.socket.destroy(); return; }
    if (route === "reflect-failure") {
      res.writeHead(500).end("reflected " + String(body.state?.context ?? "") + " " + String(req.headers.authorization ?? ""));
      return;
    }
    if (route === "redirect") { res.writeHead(302, { Location: "http://127.0.0.1/elsewhere" }).end("synthetic context canary"); return; }
    if (route.startsWith("status-")) { res.writeHead(Number(route.slice(7))).end("synthetic body canary"); return; }
    if (route === "retry-zero") { res.writeHead(503).end("synthetic context canary"); return; }
    if (route === "retry" && count === 1) { res.writeHead(503, { "Retry-After": "0" }).end("synthetic context canary"); return; }
    if (route === "delay-body") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"model":"synthetic-model","answers":');
      setTimeout(() => res.end("{}"), 1400);
      return;
    }
    if (route === "bad-json") { res.writeHead(200, { "Content-Type": "text/html" }).end("<html>synthetic context canary</html>"); return; }
    if (route === "oversized") { res.writeHead(200, { "Content-Type": "application/json" }).end("x".repeat(300)); return; }
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id,
      q.type === "choice" ? { type: "choice", choice: Object.keys(q.criteria)[0] } :
      q.type === "score" ? { type: "score", score: 0 } : { type: "noul", noul: 0.5 }]));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: "synthetic-model", answers, usage: { input_tokens: 2, output_tokens: 1 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback fixture did not bind");
  const native = globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (String(input) !== "https://openrouter.ai/api/alpha/decisions") throw new Error("non-canonical destination blocked");
    return native(`http://127.0.0.1:${address.port}/decision`, init);
  };
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { requests, legacyRequests, counts, fetch, origin: `http://127.0.0.1:${address.port}` };
}

function prepared(args: unknown, current = config) {
  const result = prepareDecision(args, current);
  if (!result.success) throw new Error(`prepare failed: ${result.error.code}`);
  return result.data;
}

describe("Q01 independent contract vectors", () => {
  it("M2 absentDecisionBlockDoesNotActivateFromEnvironment", () => {
    const absent = loadDecisionSetup(undefined, {
      env: { Q01_SYNTHETIC_KEY: "synthetic-m2-key-canary" },
      home: "/tmp/q01-synthetic-home",
      legacyMetricsFile: "/tmp/q01-synthetic-legacy-metrics.jsonl",
    });
    expect(absent).toEqual({ status: "not-configured" });
  });

  it("M2 legacyQueryAnalyzeResumeRemainGreenWhenDecisionBlockIsAbsent", async () => {
    const fixture = await loopbackFixture();
    const home = mkdtempSync(join(tmpdir(), "q01-m2-legacy-"));
    try {
      const sessions = join(home, "sessions");
      const legacyMetrics = join(home, "legacy.jsonl");
      const configPath = join(home, "config.json");
      writeFileSync(configPath, JSON.stringify({
        providers: [{ name: "synthetic-reader", base_url: fixture.origin + "/v1", api_key: "env:Q01_READER_KEY", default_model: "synthetic-reader-model" }],
        session_dir: sessions, metrics_file: legacyMetrics,
      }));
      const transport = new StdioClientTransport({
        command: serverNode,
        args: ["--require", stdioPreload, serverBin, "--config", configPath],
        cwd: home,
        env: { HOME: home, PATH: join(process.execPath, "..") + ":/usr/bin:/bin", Q01_FIXTURE_ORIGIN: fixture.origin,
          Q01_READER_KEY: "synthetic-reader-key", Q01_DECISION_KEY: "synthetic-key-canary" },
        stderr: "pipe",
      });
      const client = new Client({ name: "q01-m2-legacy", version: "1" });
      try {
        await client.connect(transport);
        const query = await client.callTool({ name: "query", arguments: { prompt: "synthetic question" } });
        expect(query.isError).not.toBe(true);
        const sessionId = query.content[0].type === "text" ? query.content[0].text.match(/session=([^\s]+)/)?.[1] : undefined;
        expect(sessionId).toBeTruthy();
        const resume = await client.callTool({ name: "resume", arguments: { session_id: sessionId, prompt: "synthetic follow-up" } });
        expect(resume.isError).not.toBe(true);
        const work = join(home, "corpus"); mkdirSync(work); writeFileSync(join(work, "fixture.txt"), "synthetic file corpus");
        const analyze = await client.callTool({ name: "analyze", arguments: { work_dir: work, prompt: "read synthetic file" } });
        expect(analyze.isError).not.toBe(true);
        expect(fixture.legacyRequests).toHaveLength(3);
        expect(fixture.requests).toHaveLength(0);
        expect(readdirSync(sessions)).toHaveLength(2);
        expect(readFileSync(legacyMetrics, "utf8")).toContain('"tool":"query"');
      } finally {
        await client.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("AC-PRIM wirePrimitivesPreserveSchemaValues", () => {
    const cases = contract.cases.filter((item: Vector) => item.id.startsWith("V-PRIMITIVE-") || item.id === "V-NOUL-CRITERIA");
    for (const item of cases) {
      const checked = validateDecisionArgs(item.input);
      expect(checked.success, item.id).toBe(true);
      const result = prepared(item.input);
      expect(result.body.questions, item.id).toEqual(item.input.questions);
    }
    expect(cases.length).toBe(4);
  });

  it("AC-BOUNDS primitiveCardinalityBoundsAndWarnings", () => {
    const cases = contract.cases.filter((item: Vector) => item.id.startsWith("V-CHOICE-") || item.id.startsWith("V-SCORE-"));
    for (const item of cases) {
      const valid = !String(item.expected).includes("INVALID_ARGUMENT");
      expect(validateDecisionArgs(item.input).success, item.id).toBe(valid);
      if (valid) {
        const result = prepared(item.input);
        if (item.id === "V-CHOICE-1") expect(result.warnings, item.id).toContain("single_option");
        else expect(result.warnings, item.id).not.toContain("single_option");
        if (item.id === "V-SCORE-1") expect(result.warnings, item.id).toContain("degenerate_scale");
        else expect(result.warnings, item.id).not.toContain("degenerate_scale");
      }
    }
    expect(cases.map((item: Vector) => item.id)).toEqual(["V-CHOICE-1", "V-CHOICE-255", "V-CHOICE-256", "V-SCORE-1", "V-SCORE-10", "V-SCORE-11"]);
  });

  it("AC-STRUCT wireBodyDeepEqualExceptLocalFields", () => {
    const item = contract.cases.find((entry: Vector) => entry.id === "V-STRUCTURED-NULL-OPTIONAL");
    expect(item).toBeDefined();
    const result = prepared(item.input);
    const wire = { ...item.input };
    const inputProvider = wire.provider;
    delete wire.policy;
    delete wire.execution;
    delete wire.provider;
    expect(result.body).toEqual({ model: "~typesafe/jev-latest", provider: inputProvider ?? {}, ...wire });
    expect(result.effectiveExecution).toEqual({ timeout_ms: 30000, max_retries: 0, dry_run: false });
    expect(result.localPolicy).toEqual(item.input.policy);
  });

  it("AC-RESERVED reservedJsonKeysRoundTripAsData", () => {
    const item = contract.cases.find((entry: Vector) => entry.id === "V-JSON-RESERVED-KEYS");
    const parsed = JSON.parse(JSON.stringify(item.input));
    const checked = validateDecisionArgs(parsed);
    expect(checked.success).toBe(true);
    const result = prepared(parsed);
    const body = JSON.parse(result.bodyJson);
    expect(body.state).toEqual(parsed.state);
    expect(body.questions).toEqual(parsed.questions);
    expect(Object.hasOwn(body.questions.__proto__.criteria, "__proto__")).toBe(true);
    expect(Object.hasOwn(body.questions.__proto__.criteria, "constructor")).toBe(true);
    expect(Object.getPrototypeOf(body.questions.__proto__.criteria)).toBe(Object.prototype);
  });

  it("AC-UNKNOWN unknownContractFieldsFailSafely", () => {
    for (const item of contract.cases.filter((entry: Vector) => entry.id.startsWith("V-UNKNOWN-"))) {
      const before = JSON.stringify(item.input);
      const result = prepareDecision(item.input, config);
      expect(result.success, item.id).toBe(false);
      if (!result.success) {
        expect(result.error.code, item.id).toBe("INVALID_ARGUMENT");
        expect(JSON.stringify(result.error), item.id).not.toContain("synthetic");
      }
      expect(JSON.stringify(item.input), item.id).toBe(before);
    }
  });

  it("AC-PROVIDER allProviderFieldsAreWirePreserved", () => {
    expect(providers.fields).toHaveLength(14);
    for (const item of providers.fields as Vector[]) {
      const result = prepared({ ...baseArgs, provider: { [item.field]: item.value } });
      expect(result.body.provider?.[item.field], item.field).toEqual(item.value);
    }
    for (const item of providers.union_cases as Vector[]) {
      const result = prepareDecision({ ...baseArgs, provider: item.provider }, config);
      expect(result.success, item.id).toBe(item.expected === "accepted");
      if (result.success) expect(result.data.body.provider).toEqual(item.provider);
    }
  });

  it("AC-OPTIONS allKnownOptionSlugsRoundTrip", () => {
    expect(providerOptionSlugs).toHaveLength(146);
    expect(optionSlugs.count).toBe(146);
    for (const item of optionSlugs.cases as Vector[]) {
      const result = prepared({ ...baseArgs, provider: item.provider });
      expect(result.body.provider?.options, item.slug).toEqual(item.provider.options);
    }
    const rejected = validateDecisionArgs({ ...baseArgs, provider: { options: { "synthetic-unknown-slug": {} } } });
    expect(rejected.success).toBe(false);
  });
});

describe("Q01 independent semantic vectors", () => {
  it("AC-POLICY policyBoundaryAndAssessmentTable", () => {
    for (const item of semantic.assessment as Vector[]) {
      const prep = prepareDecision(item.prepared_args, semanticConfig);
      if (item.expected.error) {
        expect(prep.success, item.id).toBe(false);
        if (!prep.success) expect(prep.error.code, item.id).toBe(item.expected.error.code);
        continue;
      }
      expect(prep.success, item.id).toBe(true);
      if (!prep.success) continue;
      const { question_id: id, question, policy, answer } = item.assessment_input;
      const result = { model: "synthetic-model", answers: { [id]: { type: question.type, ...answer } }, usage: { input_tokens: 1, output_tokens: 1 } };
      expect(assess(result, policy == null ? undefined : { [id]: policy })[id], item.id).toEqual(item.expected);
    }
  });

  it("AC-RESPONSE responseSemanticsMatchSpec", () => {
    for (const item of semantic.responses as Vector[]) {
      if (item.response === undefined) continue; // HTML bytes are exercised at the HTTP layer.
      const request = prepared(item.prepared_request, semanticConfig);
      const actual = validateResponse(item.response, request);
      if (item.expected.error) {
        expect(actual.success, item.id).toBe(false);
        if (!actual.success) expect(actual.error.code, item.id).toBe(item.expected.error.code);
        continue;
      }
      expect(actual.success, item.id).toBe(true);
      if (!actual.success) continue;
      if (item.expected.warning) expect(actual.data.warnings, item.id).toContain(item.expected.warning);
      if (item.expected.unknown_fields_removed_from_surfaced_result) {
        expect(JSON.stringify(actual.data.result), item.id).not.toContain("extra");
      }
      if (item.local_policy) {
        const id = Object.keys(item.local_policy)[0];
        expect(assess(actual.data.result, item.local_policy)[id], item.id).toEqual(item.expected.assessments[id]);
      }
    }
  });

  it("AC-OUTPUT exact output envelope schema and finite direct-call controls", () => {
    expect(decisionInputJsonSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(decisionOutputJsonSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const baseline = semantic.responses.find((item: Vector) => item.id === "R-FULL-VALID-BASELINE");
    const result = validateResponse(baseline.response, prepared(baseline.prepared_request, semanticConfig));
    expect(result.success).toBe(true);
    const checked = result.success ? validateDecisionEnvelope({ kind: "decision", result: result.data.result, assessments: {}, meta: { request_id: "synthetic", requested_model: "~typesafe/jev-latest", elapsed_ms: 0, attempts: 1, api_version: "alpha-decisions", warnings: [] } }) : result;
    expect(checked.success).toBe(true);
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const response = structuredClone(baseline.response);
      response.answers["q-choice"].confidence = nonFinite;
      expect(validateResponse(response, prepared(baseline.prepared_request, semanticConfig)).success).toBe(false);
    }
  });
});

describe("Q01 S2 and S3 invariants", () => {
  it("AC-CONFIG absent and disabled setup do not resolve keys", () => {
    expect(loadDecisionSetup(undefined, { ...loadOptions, env: {} })).toEqual({ status: "not-configured" });
    expect(loadDecisionSetup({ enabled: false, api_key: "invalid", future: true }, { ...loadOptions, env: {} })).toEqual({ status: "disabled" });
    expect(() => loadDecisionSetup({ api_key: "env:MISSING" }, { ...loadOptions, env: {} })).toThrow(/missing or empty/);
  });

  it("AC-MANDATORY requiredProviderCannotBeWeakened", () => {
    const required = loadDecisionSetup({
      api_key: "env:Q01_SYNTHETIC_KEY",
      required_provider: { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe"] },
    }, loadOptions);
    expect(required.status).toBe("ready");
    if (required.status !== "ready") return;
    const expected = { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe"] };
    const accepted = prepareDecision(baseArgs, required.config);
    expect(accepted.success).toBe(true);
    if (accepted.success) expect(accepted.data.body.provider).toEqual(expected);
    for (const provider of [{ zdr: false }, { data_collection: "allow" }, { only: ["other"] }, { only: [] }]) {
      const result = prepareDecision({ ...baseArgs, provider }, required.config);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe("POLICY_CONFLICT");
    }
  });

  it("AC-UTF8 serializedRequestUtf8ByteLength", () => {
    const item = contract.cases.find((entry: Vector) => entry.id === "V-INPUT-UTF8");
    const measured = prepareDecision(item.input, config);
    expect(measured.success).toBe(true);
    if (measured.success) expect(measured.data.requestBytes).toBe(Buffer.byteLength(measured.data.bodyJson, "utf8"));
  });
});

describe("Q01 native loopback transport and safe result path", () => {
  it("AC-HTTP httpRoutesMapToDocumentedErrors", async () => {
    const fixture = await loopbackFixture();
    const current = { ...config, max_response_bytes: 64, max_concurrency: 1, max_queue: 1 };
    const client = createDecisionClient(current, { fetch: fixture.fetch, random: () => 0 });
    const expected: Array<[number, string, boolean, boolean]> = [
      [400, "UPSTREAM_REQUEST", false, false], [401, "UPSTREAM_AUTH", false, false],
      [402, "UPSTREAM_PAYMENT", false, false], [403, "UPSTREAM_FORBIDDEN", false, false],
      [404, "UPSTREAM_NOT_FOUND", false, false], [413, "INPUT_TOO_LARGE", false, false],
      [429, "UPSTREAM_RATE_LIMIT", true, false], [500, "UPSTREAM_UNAVAILABLE", true, true],
      [502, "UPSTREAM_UNAVAILABLE", true, true], [503, "UPSTREAM_UNAVAILABLE", true, true],
      [524, "UPSTREAM_TIMEOUT", true, true], [529, "UPSTREAM_UNAVAILABLE", true, true],
    ];
    for (const [status, code, retryable, uncertain] of expected) {
      const route = `status-${status}`;
      const result = await client.request({ bodyJson: JSON.stringify({ state: { route }, questions: baseArgs.questions }) }, { timeout_ms: 3000, max_retries: 0, dry_run: false });
      expect(result.success, route).toBe(false);
      if (!result.success) {
        expect(result.error.code, route).toBe(code);
        expect(result.error.http_status, route).toBe(status);
        expect(result.error.retryable, route).toBe(retryable);
        expect(result.error.billing_uncertain, route).toBe(uncertain);
        expect(result.error.message, route).not.toContain("synthetic");
      }
      expect(result.attempts, route).toBe(1);
    }
    expect(fixture.requests).toHaveLength(expected.length);
    expect(fixture.requests.every((request) => request.authorization === "Bearer synthetic-key-canary")).toBe(true);
    for (const route of ["bad-json", "oversized", "redirect", "network-reset"]) {
      const result = await client.request({ bodyJson: JSON.stringify({ state: { route }, questions: baseArgs.questions }) }, { timeout_ms: 3000, max_retries: 0, dry_run: false });
      expect(result.success, route).toBe(false);
      if (!result.success) {
        expect(result.error.code, route).toBe(route === "network-reset" ? "NETWORK_ERROR" : "UPSTREAM_PROTOCOL");
        expect(result.error.billing_uncertain, route).toBe(true);
      }
      expect(result.attempts, route).toBe(1);
    }
  });

  it("AC-TOOLS AC-LEGACY AC-ISOLATION stdioConfigLifecycle stdioToolContractAndEmbeddedSchemas legacyToolsRetainContracts", async () => {
    const fixture = await loopbackFixture();
    const inputCanon = JSON.parse(readFileSync(new URL("../../docs/decision/input.schema.json", import.meta.url), "utf8"));
    const outputCanon = JSON.parse(readFileSync(new URL("../../docs/decision/output.schema.json", import.meta.url), "utf8"));
    for (const mode of ["absent", "disabled", "ready"]) {
      const home = mkdtempSync(join(tmpdir(), "q01-stdio-"));
      try {
        const sessions = join(home, "sessions");
        const legacyMetrics = join(home, "legacy.jsonl");
        const decisionMetrics = join(home, "decision.jsonl");
        const configPath = join(home, "config.json");
        const decision = mode === "absent" ? undefined : mode === "disabled" ? { enabled: false, api_key: "env:UNSET_SYNTHETIC" } : {
          api_key: "env:Q01_DECISION_KEY", default_model: "synthetic-model", allowed_models: ["synthetic-model"], metrics_file: decisionMetrics,
        };
        writeFileSync(configPath, JSON.stringify({
          providers: [{ name: "synthetic-reader", base_url: fixture.origin + "/v1", api_key: "env:Q01_READER_KEY", default_model: "synthetic-reader-model" }],
          session_dir: sessions, metrics_file: legacyMetrics, ...(decision === undefined ? {} : { decision }),
        }));
        const env = {
          HOME: home,
          PATH: join(process.execPath, "..") + ":/usr/bin:/bin",
          Q01_FIXTURE_ORIGIN: fixture.origin,
          Q01_READER_KEY: "synthetic-reader-key",
          ...(mode === "ready" || mode === "absent" ? { Q01_DECISION_KEY: "synthetic-key-canary" } : {}),
        };
        const transport = new StdioClientTransport({
          command: serverNode,
          args: ["--require", stdioPreload, serverBin, "--config", configPath],
          cwd: home, env, stderr: "pipe",
        });
        let stderr = "";
        transport.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        const client = new Client({ name: "q01-independent", version: "1" });
        try {
          await client.connect(transport);
          const tools = (await client.listTools()).tools;
          if (mode === "absent") {
            const result = await client.callTool({ name: "decision", arguments: { ...baseArgs, execution: { dry_run: false } } });
            const envelope = result.structuredContent as Vector;
            expect({ kind: envelope?.kind, code: envelope?.error?.code, attempts: envelope?.meta?.attempts, posts: fixture.requests.length }).toEqual({
              kind: "error", code: "CONFIG_ERROR", attempts: 0, posts: 0,
            });
          }
          expect(tools.map((tool) => tool.name).sort(), mode).toEqual(mode === "disabled" ? ["analyze", "query", "resume"] : ["analyze", "decision", "query", "resume"]);
          if (mode !== "disabled") {
            const decisionTool = tools.find((tool) => tool.name === "decision");
            expect(decisionTool?.inputSchema).toEqual(inputCanon);
            expect(decisionTool?.outputSchema).toEqual(outputCanon);
            expect(decisionTool?.execution).toEqual({ taskSupport: "forbidden" });
            expect(decisionTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true });
          }
          if (mode === "ready") {
            const args = { ...baseArgs, state: { context: "synthetic-context-canary" }, execution: { dry_run: true } };
            const dry = await client.callTool({ name: "decision", arguments: args });
            expect(dry.structuredContent).toMatchObject({ kind: "dry_run", meta: { attempts: 0 } });
            expect(fixture.requests).toHaveLength(0);
            const result = await client.callTool({ name: "decision", arguments: { ...args, execution: { dry_run: false } } });
            expect(result.structuredContent).toMatchObject({ kind: "decision", meta: { attempts: 1 } });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0].text).toBe(JSON.stringify((dry.structuredContent as Vector).request));
            expect(fixture.requests[0].authorization).toBe("Bearer synthetic-key-canary");
          }
          const query = await client.callTool({ name: "query", arguments: { prompt: "synthetic question" } });
          expect(query.isError).not.toBe(true);
          const sessionId = query.content[0].type === "text" ? query.content[0].text.match(/session=([^\s]+)/)?.[1] : undefined;
          expect(sessionId).toBeTruthy();
          const resume = await client.callTool({ name: "resume", arguments: { session_id: sessionId, prompt: "synthetic follow-up" } });
          expect(resume.isError).not.toBe(true);
          const work = join(home, "corpus"); mkdirSync(work); writeFileSync(join(work, "fixture.txt"), "synthetic file corpus");
          const analyze = await client.callTool({ name: "analyze", arguments: { work_dir: work, prompt: "read synthetic file" } });
          expect(analyze.isError).not.toBe(true);
          expect(fixture.legacyRequests.length).toBeGreaterThanOrEqual(3);
          expect(fixture.legacyRequests.every((request) => request.authorization === "Bearer synthetic-reader-key")).toBe(true);
          expect(readdirSync(sessions)).toHaveLength(2);
          expect(readFileSync(legacyMetrics, "utf8")).toContain('"tool":"query"');
          expect(readFileSync(legacyMetrics, "utf8")).not.toContain('"tool":"decision"');
          if (mode === "ready") {
            expect(readFileSync(decisionMetrics, "utf8").match(/"tool":"decision"/g)).toHaveLength(2);
            expect(readFileSync(decisionMetrics, "utf8")).not.toContain("synthetic-context-canary");
            expect(fixture.requests[0].text).toContain("synthetic-context-canary");
          }
          expect(stderr).not.toContain("synthetic-key-canary");
          expect(stderr).not.toContain("synthetic-context-canary");
        } finally {
          await client.close();
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
    expect(fixture.legacyRequests).toHaveLength(9);
  });

  it("AC-RETRY retryStatusAndAttemptCount", async () => {
    const fixture = await loopbackFixture();
    const client = createDecisionClient(config, { fetch: fixture.fetch, random: () => 0 });
    const defaultRetry = await client.request({ bodyJson: JSON.stringify({ state: { route: "retry-zero" }, questions: baseArgs.questions }) }, { timeout_ms: 3000, max_retries: 0, dry_run: false });
    expect(defaultRetry.success).toBe(false);
    if (!defaultRetry.success) expect(defaultRetry.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(defaultRetry.attempts).toBe(1);
    expect(fixture.counts.get("retry-zero")).toBe(1);
    const result = await client.request({ bodyJson: JSON.stringify({ state: { route: "retry" }, questions: baseArgs.questions }) }, { timeout_ms: 3000, max_retries: 1, dry_run: false });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fixture.counts.get("retry")).toBe(2);
    expect(fixture.requests.slice(1).map((request) => request.text)).toEqual([fixture.requests[1].text, fixture.requests[1].text]);
  });

  it("AC-DEADLINE oneDeadlineCoversQueueRetryAndBody", async () => {
    const fixture = await loopbackFixture();
    const client = createDecisionClient(config, { fetch: fixture.fetch, random: () => 0 });
    const start = performance.now();
    const result = await client.request({ bodyJson: JSON.stringify({ state: { route: "delay-body" }, questions: baseArgs.questions }) }, { timeout_ms: 1000, max_retries: 0, dry_run: false });
    const elapsed = performance.now() - start;
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("UPSTREAM_TIMEOUT");
    expect(result.attempts).toBe(1);
    expect(elapsed).toBeLessThan(1300);
  });

  it("AC-CANCEL AC-QUEUE queuedAndInflightAbortReleaseSlot queueLimitAndSlotCleanupAcrossOutcomes", async () => {
    const fixture = await loopbackFixture();
    const client = createDecisionClient({ ...config, max_concurrency: 1, max_queue: 1 }, { fetch: fixture.fetch });
    const body = (route: string) => ({ bodyJson: JSON.stringify({ state: { route }, questions: baseArgs.questions }) });
    const execute = (route: string, signal?: AbortSignal) => client.request(body(route), { timeout_ms: 3000, max_retries: 0, dry_run: false }, signal);
    const firstAbort = new AbortController();
    const first = execute("hold", firstAbort.signal);
    for (let i = 0; i < 100 && fixture.counts.get("hold") !== 1; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fixture.counts.get("hold")).toBe(1);
    const queuedAbort = new AbortController();
    const queued = execute("never", queuedAbort.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const overflow = await execute("never");
    expect(overflow.success).toBe(false);
    if (!overflow.success) expect(overflow.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(overflow.attempts).toBe(0);
    queuedAbort.abort();
    const cancelledQueued = await queued;
    expect(cancelledQueued.success).toBe(false);
    expect(cancelledQueued.attempts).toBe(0);
    if (!cancelledQueued.success) expect(cancelledQueued.error.code).toBe("CANCELLED");
    firstAbort.abort();
    const cancelledFirst = await first;
    expect(cancelledFirst.success).toBe(false);
    if (!cancelledFirst.success) expect(cancelledFirst.error.code).toBe("CANCELLED");
    const recovered = await execute("ok");
    expect(recovered.success).toBe(true);
    expect(recovered.attempts).toBe(1);
    expect(fixture.requests.filter((request) => request.body.state.route === "never")).toHaveLength(0);
  });

  it("AC-SECRET syntheticSecretsAndContextDoNotLeak", async () => {
    const fixture = await loopbackFixture();
    const key = "synthetic-key-canary";
    const context = "synthetic-context-canary";
    const rawConfig = {
      providers: [{ name: "synthetic-reader", base_url: fixture.origin + "/v1", api_key: "env:Q01_LEGACY_KEY", default_model: "synthetic-reader-model" }],
      decision: { api_key: "env:Q01_SYNTHETIC_KEY" },
    };
    const env = { Q01_SYNTHETIC_KEY: key, Q01_LEGACY_KEY: "synthetic-legacy-key-canary" };
    const setup = loadDecisionSetup(rawConfig.decision, {
      env: { Q01_SYNTHETIC_KEY: env.Q01_SYNTHETIC_KEY },
      home: "/tmp/q01-synthetic-home",
      legacyMetricsFile: "/tmp/q01-synthetic-legacy-metrics.jsonl",
    });
    expect(setup.status).toBe("ready");
    if (setup.status !== "ready") return;
    expect(rawConfig.providers[0].api_key).toBe("env:Q01_LEGACY_KEY");
    expect(env.Q01_LEGACY_KEY).toBe("synthetic-legacy-key-canary");

    const transportLogs: string[] = [];
    let sinkWrites = 0;
    const reflectingFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await fixture.fetch(input, init);
      await response.body?.cancel();
      throw new Error(`synthetic transport reflection ${key} ${context}`);
    };
    const networkHandler = createDecisionHandler({
      setup, transport: { fetch: reflectingFetch }, requestId: () => "synthetic-q01-network",
      metrics: { writeStderr: (line) => { transportLogs.push(line); }, appendFile: async () => { sinkWrites += 1; } },
    });
    const dry = await networkHandler({ ...baseArgs, state: { context }, execution: { dry_run: true } });
    expect(dry.structuredContent).toMatchObject({ kind: "dry_run", request: { state: { context } }, meta: { attempts: 0 } });
    expect(JSON.stringify(dry)).not.toContain(key);
    expect(JSON.stringify(dry.structuredContent?.request)).toContain(context);
    expect(JSON.stringify(dry.structuredContent?.request)).not.toContain(key);
    expect(fixture.requests).toHaveLength(0);
    const failed = await networkHandler({ ...baseArgs, state: { context } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ kind: "error", error: { code: "NETWORK_ERROR" }, meta: { attempts: 1 } });
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0].authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(fixture.requests[0].body)).toContain(context);
    expect(fixture.requests[0].text).not.toContain(key);
    expect(sinkWrites).toBe(0);
    const sinkLogs: string[] = [];
    const sinkSetup = { status: "ready" as const, config: { ...setup.config, metrics_file: "/tmp/q01-synthetic-decision-metrics.jsonl" } };
    const sinkHandler = createDecisionHandler({
      setup: sinkSetup, transport: { fetch: fixture.fetch }, requestId: () => "synthetic-q01-sink",
      metrics: {
        writeStderr: (line) => { sinkLogs.push(line); },
        appendFile: async () => { throw new Error(`${key} ${context}`); },
      },
    });
    const successful = await sinkHandler({ ...baseArgs, state: { context } });
    expect(successful.isError).toBe(false);
    expect(successful.structuredContent).toMatchObject({ kind: "decision", result: { answers: { q: { type: "noul", noul: 0.5 } } } });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1].authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(fixture.requests[1].body)).toContain(context);
    expect(fixture.requests[1].text).not.toContain(key);
    expect(sinkLogs.join("\n")).toContain("Metrics file write failed.");
    const unknownKey = await sinkHandler({ ...baseArgs, api_key: key });
    expect(unknownKey.structuredContent).toMatchObject({ kind: "error", error: { code: "INVALID_ARGUMENT" }, meta: { attempts: 0 } });
    expect(JSON.stringify(unknownKey)).not.toContain(key);
    expect(fixture.requests).toHaveLength(2);
    const publicSurfaces = JSON.stringify([failed, transportLogs, successful, sinkLogs, dry, unknownKey, fixture.requests.map((request) => request.body)]);
    expect(publicSurfaces).not.toContain(key);
    expect(JSON.stringify([failed, transportLogs, successful, sinkLogs])).not.toContain(context);
    expect(fixture.legacyRequests).toHaveLength(0);
  });
});
