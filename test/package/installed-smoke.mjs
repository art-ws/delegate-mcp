// Usage: node installed-smoke.mjs <fresh-install-dir> <server-node>.
// Only the installed SDK/bin, reviewed JSON oracle, and native loopback HTTP are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [installation, node] = process.argv.slice(2);
assert(installation && node, "Supply fresh installation and Node runtime");
const requireInstalled = createRequire(join(resolve(installation), "package.json"));
const { Client } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const canon = (name) => JSON.parse(readFileSync(new URL(`../../docs/decision/${name}.schema.json`, import.meta.url), "utf8"));
const inputOracle = canon("input"), outputOracle = canon("output");
const full = JSON.parse(readFileSync(new URL("../decision/fixtures/input-full.json", import.meta.url), "utf8"));
const bin = join(resolve(installation), "node_modules/.bin/delegate-mcp");
const pkg = dirname(dirname(realpathSync(bin)));
assert(!existsSync(join(pkg, "src")) && !existsSync(join(pkg, "docs")) && !existsSync(join(pkg, "test")));
assert.deepEqual(readdirSync(join(pkg, "dist")), ["index.js"]);
const key = ["SYNTHETIC", "D07", "KEY", "CANARY"].join("_");
const contextCanary = ["SYNTHETIC", "D07", "CONTEXT", "CANARY"].join("_");
const wire = [], chat = [];
let fixtureFailure;
const http = createServer(async (req, res) => {
  try {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    assert.equal(req.method, "POST");
    if (req.url === "/decision") {
      wire.push({ body, text });
      assert.equal(req.headers.authorization === `Bearer ${key}`, true);
      if (body.state.scenario === "http-error") { res.writeHead(401); res.end(contextCanary + key); return; }
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id,
        q.type === "choice" ? { type: "choice", choice: Object.keys(q.criteria)[0] } :
        q.type === "score" ? { type: "score", score: 0 } : { type: "noul", noul: 0.5 }]));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model: "typesafe/jev-1.13", answers, usage: { input_tokens: 7, output_tokens: 2 }, extra: key + contextCanary }));
    } else {
      assert.equal(req.url, "/v1/chat/completions");
      chat.push(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "synthetic-chat", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "synthetic reader answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 3 } }));
    }
  } catch (error) { fixtureFailure = error; res.writeHead(500); res.end("Fixture assertion failed"); }
});
await new Promise((yes) => http.listen(0, "127.0.0.1", yes));
const origin = `http://127.0.0.1:${http.address().port}`;
const homes = [];
const envFor = (home, includeKey) => ({ HOME: home, PATH: `${dirname(node)}:/usr/bin:/bin`, D07_READER_KEY: "synthetic-reader-key", D07_FIXTURE_ORIGIN: origin, ...(includeKey ? { D07_DECISION_KEY: key } : {}) });
const rows = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
const pass = (name) => process.stdout.write(`PASS ${name}\n`);

async function session(mode) {
  const home = mkdtempSync(join(tmpdir(), "d07-installed-")); homes.push(home);
  const decisionMetrics = join(home, "decision.jsonl"), legacyMetrics = join(home, "reader.jsonl"), sessions = join(home, "sessions");
  const decision = mode === "absent" ? undefined : mode === "disabled" ? { enabled: false, api_key: "env:UNSET_FIXTURE_VAR", invalid: true } :
    { api_key: "env:D07_DECISION_KEY", required_provider: { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe"] }, metrics_file: decisionMetrics };
  const config = { providers: [{ name: "synthetic-reader", base_url: `${origin}/v1`, api_key: "env:D07_READER_KEY", default_model: "synthetic-reader-model" }], session_dir: sessions, metrics_file: legacyMetrics, decision };
  const configPath = join(home, "config.json"); writeFileSync(configPath, JSON.stringify(config));
  const transport = new StdioClientTransport({ command: node, args: ["--require", join(fixtureDir, "loopback-preload.cjs"), bin, "--config", configPath], cwd: home, env: envFor(home, mode === "ready"), stderr: "pipe" });
  let stderr = "";
  transport.stderr.on("data", (s) => { stderr += s.toString(); });
  const client = new Client({ name: "d07-installed-package", version: "1" });
  const errors = []; client.onerror = (error) => errors.push(error);
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), mode === "disabled" ? ["analyze", "query", "resume"] : ["analyze", "decision", "query", "resume"]);
    if (mode !== "disabled") {
      const tool = tools.find((t) => t.name === "decision");
      assert.deepEqual(tool.inputSchema, inputOracle); assert.deepEqual(tool.outputSchema, outputOracle);
      assert.deepEqual(tool.execution, { taskSupport: "forbidden" });
    }
    pass(`D07-INSTALLED-INVENTORY/SCHEMA-${mode}`);
    const call = async (args) => {
      const result = await client.callTool({ name: "decision", arguments: args });
      assert.equal(result.content.length, 1); assert.equal(result.content[0].type, "text");
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      const envelope = result.structuredContent;
      assert.equal(result.isError, envelope.kind === "error");
      assert(!JSON.stringify(result).includes(key));
      return envelope;
    };
    const before = wire.length;
    if (mode === "absent") {
      for (const dry_run of [false, true]) {
        const result = await call({ ...full, execution: { dry_run } });
        assert.equal(result.error.code, "CONFIG_ERROR"); assert.equal(result.meta.attempts, 0);
      }
      assert.equal(wire.length, before); pass("D07-INSTALLED-ABSENT-NO-ACTIVATION");
    } else if (mode === "disabled") {
      assert.equal((await client.callTool({ name: "decision", arguments: full })).isError, true);
      assert.equal(wire.length, before); pass("D07-INSTALLED-DISABLED-NO-KEY");
    } else {
      const args = structuredClone(full); args.state.context = contextCanary;
      const dry = await call(args);
      assert.equal(dry.kind, "dry_run"); assert.equal(dry.meta.attempts, 0); assert.equal(wire.length, before);
      assert(!existsSync(legacyMetrics)); assert(!existsSync(sessions));
      pass("D07-INSTALLED-DRY-ZERO-POST");
      const result = await call({ ...args, execution: { dry_run: false } });
      assert.equal(result.kind, "decision"); assert.equal(result.meta.attempts, 1); assert.equal(wire.length, before + 1);
      assert.deepEqual(wire.at(-1).body, dry.request); assert.equal(wire.at(-1).text, JSON.stringify(dry.request));
      assert(!wire.at(-1).text.includes(key)); assert(!("execution" in dry.request)); assert(!("policy" in dry.request));
      assert.equal(Object.keys(dry.request.provider).length, 14);
      assert.deepEqual(result.result.answers, { pick: { type: "choice", choice: "a" }, flag: { type: "noul", noul: 0.5 }, level: { type: "score", score: 0 } });
      assert.deepEqual(result.result.usage, { input_tokens: 7, output_tokens: 2 });
      assert.deepEqual(result.assessments.pick, { status: "uncertain", value: "a", reasons: ["missing_metric"] });
      assert.deepEqual(result.assessments.flag, { status: "uncertain", value: null, reasons: ["ambiguous_probability"] });
      assert.deepEqual(result.assessments.level, { status: "uncertain", value: 0, reasons: ["missing_metric"] });
      assert(result.meta.warnings.includes("missing_optional_metrics")); assert(!("extra" in result.result));
      const noPolicy = await call({ state: "Synthetic", questions: { q: { type: "noul", instructions: "Check" } } });
      assert.deepEqual(noPolicy.assessments.q, { status: "unassessed", value: 0.5, reasons: [] });
      const error = await call({ state: { scenario: "http-error", context: contextCanary }, questions: { q: { type: "noul", instructions: "Check" } } });
      assert.equal(error.error.code, "UPSTREAM_AUTH"); assert.equal(error.error.http_status, 401); assert.equal(error.meta.attempts, 1);
      assert(!JSON.stringify(error).includes(contextCanary));
      assert.deepEqual(rows(decisionMetrics).map((r) => r.status), ["dry_run", "success", "success", "error"]);
      assert(!existsSync(legacyMetrics)); assert(!existsSync(sessions));
      assert.equal(chat.length, 6); // absent + disabled: three reader calls each
      pass("D07-INSTALLED-ROUNDTRIP/OPTIONAL/POLICY/SAFE-ERROR/SINK-ISOLATION");
    }
    const readerBefore = chat.length;
    const query = await client.callTool({ name: "query", arguments: { prompt: "Synthetic question" } });
    assert.notEqual(query.isError, true); assert.match(query.content[0].text, /^\[delegate query\] provider=synthetic-reader model=synthetic-reader-model /);
    const id = query.content[0].text.match(/session=([^\s]+)/)[1];
    const resume = await client.callTool({ name: "resume", arguments: { session_id: id, prompt: "Synthetic follow-up" } });
    assert.notEqual(resume.isError, true); assert.match(resume.content[0].text, /^\[delegate resume\]/);
    assert.equal(chat.at(-1).model, "synthetic-reader-model");
    const history = JSON.stringify(chat.at(-1).messages);
    for (const fragment of ["Synthetic question", "synthetic reader answer", "Synthetic follow-up"]) assert(history.includes(fragment));
    const work = join(home, "corpus"); mkdirSync(work); writeFileSync(join(work, "example.txt"), "SYNTHETIC_FILE_CONTENT");
    const analyze = await client.callTool({ name: "analyze", arguments: { work_dir: work, prompt: "Read synthetic file" } });
    assert.notEqual(analyze.isError, true); assert.match(analyze.content[0].text, /^\[delegate analyze\]/);
    assert(JSON.stringify(chat.at(-1)).includes("SYNTHETIC_FILE_CONTENT"));
    assert.equal(chat.length, readerBefore + 3); assert.equal(rows(legacyMetrics).length, 3);
    assert.equal(readdirSync(sessions).length, 2);
    assert(!stderr.includes(key) && !stderr.includes(contextCanary));
    assert.deepEqual(errors, []); assert.equal(fixtureFailure, undefined);
    pass(`D07-INSTALLED-LEGACY-QUERY/RESUME/ANALYZE-${mode}`);
  } finally { await client.close(); }
}

async function startupFailure(decision) {
  const home = mkdtempSync(join(tmpdir(), "d07-invalid-")); homes.push(home);
  const config = join(home, "config.json");
  writeFileSync(config, JSON.stringify({ providers: [{ name: "fixture", base_url: `${origin}/v1`, api_key: "env:D07_READER_KEY", default_model: "fixture" }], decision }));
  const child = spawn(node, [bin, "--config", config], { cwd: home, env: envFor(home, false), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", (s) => { stdout += s; }); child.stderr.on("data", (s) => { stderr += s; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const rc = await new Promise((yes, no) => { child.on("error", no); child.on("exit", yes); });
    assert.equal(rc, 1); assert.equal(stdout, ""); assert(stderr.includes("fatal")); assert(!stderr.includes(key));
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}

try {
  for (const mode of ["absent", "disabled", "ready"]) await session(mode);
  await startupFailure({ api_key: "env:UNSET_FIXTURE_VAR" });
  await startupFailure({ api_key: "env:UNSET_FIXTURE_VAR", invalid: true });
  pass("D07-INSTALLED-STARTUP-MISSING-KEY/INVALID");
  assert.equal(wire.length, 3); assert.equal(chat.length, 9);
  pass("D07-INSTALLED-SYNTHETIC-ONLY-3-DECISION-POST/9-CHAT-POST");
} finally {
  http.closeAllConnections(); await new Promise((yes) => http.close(yes));
  for (const home of homes) rmSync(home, { recursive: true, force: true });
}
