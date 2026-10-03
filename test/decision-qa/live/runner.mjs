import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const options = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => {
  if (value.startsWith("--")) rows.push([value.slice(2), all[index + 1]]);
  return rows;
}, []));
const installation = resolve(options.install ?? "");
const node = resolve(options.node ?? process.execPath);
const mode = options.mode;
const attempt = options.attempt ?? "1";
const evidence = resolve(options.evidence ?? "");
const counterPath = join(evidence, "fetch-counter.json");
assert(["prepare", "live"].includes(mode) && existsSync(join(installation, "package.json")) && evidence);
assert(/^\d+$/.test(attempt));
mkdirSync(evidence, { recursive: true });
assert.equal(Object.hasOwn(process.env, "NODE_OPTIONS"), false, "NODE_OPTIONS must not be inherited");
const secret = mode === "prepare" ? "synthetic-q02-preflight-key" : process.env.OPENROUTER_API_KEY;
assert(typeof secret === "string" && secret.length > 0, "required child environment is absent");
const requireInstalled = createRequire(join(installation, "package.json"));
const { Client } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
const bin = join(installation, "node_modules/.bin/delegate-mcp");
const guard = resolve("test/decision-qa/live/fetch-guard.cjs");
const fixtureDir = resolve("test/decision-qa/live");
const cases = [
  { name: "alias", model: "~typesafe/jev-latest", file: "alias.args.json", warnings: [] },
  { name: "boundaries", model: "typesafe/jev-1.13", file: "boundaries.args.json", warnings: ["single_option", "degenerate_scale"] },
];
const fixtures = cases.map((item) => ({ ...item, args: JSON.parse(readFileSync(join(fixtureDir, item.file), "utf8")) }));
assert.equal(Object.keys(fixtures[1].args.questions.choice_255.criteria).length, 255);
assert.equal(fixtures[1].args.questions.choice_1.criteria && Object.keys(fixtures[1].args.questions.choice_1.criteria).length, 1);
assert.equal(fixtures[1].args.questions.score_10.criteria.length, 10);
assert.equal(fixtures[1].args.questions.score_1.criteria.length, 1);
assert.equal(Object.hasOwn(fixtures[1].args.questions.flag, "criteria"), false);
assert.equal(Object.keys(fixtures[0].args.questions).map((id) => fixtures[0].args.questions[id].type).sort().join(","), "choice,noul,score");

const ledgerPath = join(evidence, "budget-ledger.json");
let ledger;
if (mode === "prepare") {
  ledger = { max_posts: 2, consumed_posts: 0, state: "PREPARED_NO_POST" };
  if (existsSync(ledgerPath)) assert.deepEqual(JSON.parse(readFileSync(ledgerPath, "utf8")), ledger, "budget already used; refusing preparation");
  else writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", { flag: "wx" });
} else {
  ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  assert.deepEqual(ledger, { max_posts: 2, consumed_posts: 0, state: "PREPARED_NO_POST" }, "budget already used or not prepared; refusing live run");
}

const home = mkdtempSync(join(tmpdir(), "q02-installed-"));
const decisionMetrics = join(home, "decision-metrics.jsonl");
const legacyMetrics = join(home, "legacy-metrics.jsonl");
const configPath = join(home, "config.json");
writeFileSync(configPath, JSON.stringify({
  providers: [{ name: "q02-unused-reader", base_url: "https://example.invalid/v1", api_key: "env:Q02_UNUSED_READER_KEY", default_model: "synthetic-reader-model" }],
  decision: {
    api_key: "env:OPENROUTER_API_KEY",
    default_model: "~typesafe/jev-latest",
    allowed_models: ["~typesafe/jev-latest", "typesafe/jev-1.13"],
    provider_defaults: {}, required_provider: {}, timeout_ms: 30000, max_retries: 0,
    max_request_bytes: 32768, max_response_bytes: 1048576, max_concurrency: 1, max_queue: 0,
    metrics_file: decisionMetrics,
  },
  metrics_file: legacyMetrics,
}));

let stderrText = "";
const env = {
  HOME: home,
  PATH: `${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  OPENROUTER_API_KEY: secret,
  Q02_UNUSED_READER_KEY: "synthetic-unused-reader-key",
  Q02_COUNTER_FILE: counterPath,
};
assert.equal(Object.hasOwn(env, "NODE_OPTIONS"), false);
const transport = new StdioClientTransport({ command: node, args: ["--require", guard, bin, "--config", configPath], cwd: home, env, stderr: "pipe" });
transport.stderr?.on("data", (data) => { stderrText += data.toString(); });
const client = new Client({ name: "q02-installed-smoke", version: "1" });
const protocolErrors = [];
client.onerror = (error) => protocolErrors.push(String(error?.name ?? "protocol-error"));
const output = { mode, cases: [], tools: [], secret_scan: "PENDING", protocol_errors: [] };
let stage = "fixture-and-budget-preflight";
let observed = null;
let secretScanStatus = "PASS";

function secretFree(value) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  assert(!json.includes(secret), "secret-scan-failed");
}
function readCounter() {
  return existsSync(counterPath) ? JSON.parse(readFileSync(counterPath, "utf8")) : { posts: 0 };
}
async function callBounded(params) {
  let timer;
  try {
    return await Promise.race([
      client.callTool(params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("bounded-call-timeout")), 33000); }),
    ]);
  } finally { clearTimeout(timer); }
}
function safeError(envelope) {
  return {
    code: envelope.error?.code,
    http_status: envelope.error?.http_status,
    billing_uncertain: envelope.error?.billing_uncertain,
    requested_model: envelope.meta?.requested_model,
    attempts: envelope.meta?.attempts,
    elapsed_ms: envelope.meta?.elapsed_ms,
    warnings: envelope.meta?.warnings,
  };
}
function checkEnvelope(result, args, model, expectedWarnings) {
  assert.equal(result.isError, false);
  const envp = result.structuredContent;
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), envp);
  assert.equal(envp.kind, "decision");
  assert.equal(envp.meta.requested_model, model);
  assert.equal(envp.meta.attempts, 1);
  assert.deepEqual([...envp.meta.warnings].sort(), [...expectedWarnings].sort());
  assert.deepEqual(Object.keys(envp.result.answers).sort(), Object.keys(args.questions).sort());
  assert.equal(typeof envp.result.model, "string");
  if (envp.result.provider !== undefined) assert.equal(typeof envp.result.provider, "string");
  assert(Number.isInteger(envp.result.usage.input_tokens) && envp.result.usage.input_tokens >= 0);
  assert(Number.isInteger(envp.result.usage.output_tokens) && envp.result.usage.output_tokens >= 0);
  if (envp.result.usage.cost !== undefined) assert(Number.isFinite(envp.result.usage.cost) && envp.result.usage.cost >= 0);
  for (const [id, question] of Object.entries(args.questions)) {
    const answer = envp.result.answers[id];
    assert.equal(answer.type, question.type);
    if (question.type === "choice") {
      const ids = Object.keys(question.criteria);
      assert(ids.includes(answer.choice));
      if (answer.probabilities !== undefined) {
        assert.deepEqual(Object.keys(answer.probabilities).sort(), ids.sort());
        const values = Object.values(answer.probabilities);
        assert(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
        assert(Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 0.02);
        assert(answer.probabilities[answer.choice] >= Math.max(...values));
      }
      if (answer.confidence !== undefined) assert(Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1);
    } else if (question.type === "noul") {
      assert(Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1);
    } else {
      const n = question.criteria.length;
      assert(Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= n - 1);
      if (answer.probabilities !== undefined) {
        const keys = Array.from({ length: n }, (_, i) => String(i));
        assert.deepEqual(Object.keys(answer.probabilities).sort(), keys.sort());
        const values = keys.map((key) => answer.probabilities[key]);
        assert(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
        assert(Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 0.02);
        assert(Math.abs(answer.score - values.reduce((sum, value, index) => sum + index * value, 0)) <= 0.02 * (n - 1) + 0.02);
      }
      if (answer.legend !== undefined) assert.deepEqual(answer.legend, question.criteria);
      if (answer.confidence !== undefined) assert(Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1);
    }
  }
  return envp;
}

try {
  stage = "stdio-connect";
  await client.connect(transport);
  stage = "tools-list";
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(tools, ["analyze", "decision", "query", "resume"]);
  output.tools = tools;
  if (mode === "prepare") {
    for (const fixture of fixtures) {
      stage = `dry-run-${fixture.name}-call`;
      const args = { ...fixture.args, model: fixture.model, execution: { dry_run: true, max_retries: 0, timeout_ms: 30000 } };
      const result = await callBounded({ name: "decision", arguments: args });
      secretFree(result);
      const observedEnvelope = result.structuredContent;
      observed = {
        isError: result.isError === true,
        kind: observedEnvelope?.kind,
        error_code: ["CONFIG_ERROR", "INVALID_ARGUMENT", "POLICY_CONFLICT", "INPUT_TOO_LARGE", "UPSTREAM_AUTH", "UPSTREAM_PAYMENT", "UPSTREAM_FORBIDDEN", "UPSTREAM_NOT_FOUND", "UPSTREAM_REQUEST", "UPSTREAM_RATE_LIMIT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_PROTOCOL", "NETWORK_ERROR", "CANCELLED"].includes(observedEnvelope?.error?.code) ? observedEnvelope.error.code : undefined,
        attempts: Number.isInteger(observedEnvelope?.meta?.attempts) ? observedEnvelope.meta.attempts : undefined,
      };
      stage = `dry-run-${fixture.name}-validation`;
      assert.equal(result.isError, false);
      const envp = result.structuredContent;
      assert.equal(envp.kind, "dry_run");
      assert.equal(envp.meta.attempts, 0);
      assert.equal(envp.meta.requested_model, fixture.model);
      assert.deepEqual([...envp.meta.warnings].sort(), [...fixture.warnings].sort());
      const requestJson = JSON.stringify(envp.request);
      const requestBytes = Buffer.byteLength(requestJson, "utf8");
      assert(requestBytes <= 32768);
      assert.equal(envp.request.model, fixture.model);
      assert.deepEqual(Object.keys(envp.request.questions).sort(), Object.keys(fixture.args.questions).sort());
      assert(!("execution" in envp.request) && !("api_key" in envp.request) && !("authorization" in envp.request));
      assert.equal(readCounter().posts, 0);
      writeFileSync(join(evidence, `${fixture.name}-dry-run-body.json`), JSON.stringify(envp.request, null, 2) + "\n");
      output.cases.push({ name: fixture.name, status: "DRY_RUN_PASS", requested_model: fixture.model, request_bytes: requestBytes, attempts: 0, warnings: envp.meta.warnings });
    }
    assert.equal(readCounter().posts, 0);
  } else {
    for (const fixture of fixtures) {
      stage = `live-${fixture.name}`;
      assert(ledger.consumed_posts < ledger.max_posts, "budget-exhausted");
      ledger = { ...ledger, consumed_posts: ledger.consumed_posts + 1, state: "LIVE_IN_PROGRESS" };
      writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
      const args = { ...fixture.args, model: fixture.model, execution: { dry_run: false, max_retries: 0, timeout_ms: 30000 } };
      const callStarted = Date.now();
      const result = await callBounded({ name: "decision", arguments: args });
      const elapsedWallMs = Date.now() - callStarted;
      secretFree(result);
      const envp = result.structuredContent;
      if (envp.kind !== "decision" || result.isError === true) {
        const row = { name: fixture.name, status: "FAIL_STOP", safe_error: safeError(envp), local_post_count: readCounter().posts, remaining_budget: ledger.max_posts - ledger.consumed_posts };
        output.cases.push(row);
        writeFileSync(join(evidence, "live-partial.json"), JSON.stringify(output, null, 2) + "\n");
        ledger = { ...ledger, state: "STOPPED_AFTER_ERROR" };
        writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
        throw new Error("live-call-failed-stop");
      }
      checkEnvelope(result, fixture.args, fixture.model, fixture.warnings);
      const counter = readCounter();
      assert.equal(counter.posts, ledger.consumed_posts);
      const row = {
        name: fixture.name, status: "PASS", requested_model: envp.meta.requested_model,
        resolved_model: envp.result.model,
        provider: envp.result.provider === undefined ? "ABSENT" : envp.result.provider,
        usage: { input_tokens: envp.result.usage.input_tokens, output_tokens: envp.result.usage.output_tokens,
          ...(envp.result.usage.cost === undefined ? {} : { cost: envp.result.usage.cost }) },
        attempts: envp.meta.attempts, local_post_count: counter.posts, request_bytes: counter.request_bytes,
        elapsed_ms: envp.meta.elapsed_ms, wall_elapsed_ms: elapsedWallMs, warnings: envp.meta.warnings,
      };
      output.cases.push(row);
      writeFileSync(join(evidence, "live-partial.json"), JSON.stringify(output, null, 2) + "\n");
      ledger = { ...ledger, state: ledger.consumed_posts === 1 ? "FIRST_PASS_SECOND_AUTHORIZED" : "COMPLETE" };
      writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
    }
  }
  assert.deepEqual(protocolErrors, []);
  assert(!stderrText.includes(secret), "secret-scan-failed-stderr");
  output.protocol_errors = protocolErrors;
  output.secret_scan = "PASS";
  writeFileSync(join(evidence, `${mode}-attempt-${attempt}-summary.json`), JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ mode, cases: output.cases, tools: output.tools, secret_scan: output.secret_scan }) + "\n");
} catch {
  try { secretFree(stderrText); } catch { secretScanStatus = "BLOCKED"; }
  const safe = { mode, status: "STOPPED", stage, observed: secretScanStatus === "PASS" ? observed : null, cases: secretScanStatus === "PASS" ? output.cases : [], local_post_count: readCounter().posts, remaining_budget: mode === "live" ? 2 - ledger.consumed_posts : 2, secret_scan: secretScanStatus };
  try { writeFileSync(join(evidence, `${mode}-attempt-${attempt}-stopped.json`), JSON.stringify(safe, null, 2) + "\n"); } catch {}
  if (mode === "live" && ledger.state === "LIVE_IN_PROGRESS") {
    ledger = { ...ledger, state: "STOPPED_AFTER_UNVERIFIED_ATTEMPT" };
    try { writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); } catch {}
  }
  process.stderr.write(secretScanStatus === "PASS" ? "Q02 runner stopped; sanitized evidence records the bounded result.\n" : "Q02 runner stopped; secret-safe evidence projection was blocked.\n");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
