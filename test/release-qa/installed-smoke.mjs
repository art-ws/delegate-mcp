import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const archive = resolve(process.argv[2]);
const label = process.argv[3] ?? "archive";
const output = process.argv[4] ? resolve(process.argv[4]) : undefined;
const scratch = mkdtempSync(join(tmpdir(), "delegate-r02-installed-"));
const home = join(scratch, "home");
mkdirSync(home);
const env = { HOME: home, PATH: process.env.PATH, CI: "1", NO_COLOR: "1" };
const commands = [];
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  commands.push({ command: [command, ...args], rc: result.status });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout;
}

try {
  const install = join(scratch, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", archive], install);
  const pkg = join(install, "node_modules/delegate-mcp");
  const installed = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
  const bin = join(install, "node_modules/.bin/delegate-mcp");
  assert.equal(realpathSync(bin), realpathSync(join(pkg, installed.bin[installed.name])));
  for (const path of ["src", "docs", "test"]) assert(!existsSync(join(pkg, path)));

  const requireInstalled = createRequire(join(install, "package.json"));
  const { Client } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const { StdioClientTransport } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
  const config = join(home, "config.json");
  writeFileSync(config, JSON.stringify({ providers: [{ name: "synthetic", base_url: "http://127.0.0.1:1/v1", api_key: "env:R02_SYNTHETIC", default_model: "synthetic" }] }));
  const preload = join(home, "deny-network.cjs");
  writeFileSync(preload, 'global.fetch=()=>{throw new Error("NETWORK_FORBIDDEN")}; for(const n of ["node:http","node:https","node:net","node:tls"]){const m=require(n);for(const k of ["request","get","connect","createConnection"])if(m[k])m[k]=()=>{throw new Error("NETWORK_FORBIDDEN")}}\n');
  const transport = new StdioClientTransport({ command: bin, args: ["--config", config], cwd: home,
    env: { ...env, NODE_OPTIONS: `--require=${preload}`, R02_SYNTHETIC: "fixture-value" }, stderr: "pipe" });
  const client = new Client({ name: "release-installed-smoke", version: "1" });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => { void transport.close(); }, 15000);
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["analyze", "decision", "query", "resume"]);
    const result = await client.callTool({ name: "decision", arguments: { state: "synthetic", questions: { q: { type: "noul", instructions: "synthetic check" } }, execution: { dry_run: true } } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "CONFIG_ERROR");
    assert.equal(result.structuredContent.meta.attempts, 0);
    assert(!stderr.includes("R02_SYNTHETIC"));
  } finally { clearTimeout(timer); await client.close(); }

  const dryConfig = join(home, "dry-config.json");
  writeFileSync(dryConfig, JSON.stringify({ providers: [{ name: "synthetic", base_url: "http://127.0.0.1:1/v1", api_key: "env:R02_SYNTHETIC_KEY", default_model: "synthetic" }],
    decision: { api_key: "env:R02_SYNTHETIC_KEY" } }));
  const dryTransport = new StdioClientTransport({ command: bin, args: ["--config", dryConfig], cwd: home,
    env: { ...env, NODE_OPTIONS: `--require=${preload}`, R02_SYNTHETIC_KEY: "synthetic-only-canary" }, stderr: "pipe" });
  const dryClient = new Client({ name: "release-dry-run-smoke", version: "1" });
  let dryStderr = "";
  dryTransport.stderr.on("data", (chunk) => { dryStderr += chunk; });
  const dryTimer = setTimeout(() => { void dryTransport.close(); }, 15000);
  try {
    await dryClient.connect(dryTransport);
    assert.deepEqual((await dryClient.listTools()).tools.map((tool) => tool.name).sort(), ["analyze", "decision", "query", "resume"]);
    const dry = await dryClient.callTool({ name: "decision", arguments: { state: { synthetic: "bounded no-network" },
      questions: { q: { type: "noul", instructions: "synthetic check", criteria: { true: "yes", false: "no" } },
        c: { type: "choice", instructions: "select", criteria: { one: "only option" } },
        s: { type: "score", instructions: "score", criteria: ["one level"] } }, execution: { dry_run: true } } });
    assert.equal(dry.isError, false);
    assert.equal(dry.structuredContent.kind, "dry_run");
    assert.equal(dry.structuredContent.meta.attempts, 0);
    assert.equal(dry.structuredContent.request.state.synthetic, "bounded no-network");
    assert(!dryStderr.includes("synthetic-only-canary"));
  } finally { clearTimeout(dryTimer); await dryClient.close(); }

  run("npm", ["ls", "--omit=dev", "--depth=0"], install);
  const resolvedDependencies = Object.fromEntries(Object.keys(installed.dependencies ?? {}).sort().map((name) => [
    name, JSON.parse(readFileSync(join(install, "node_modules", name, "package.json"), "utf8")).version,
  ]));
  const report = { status: "PASS", label, node: process.version, npm: run("npm", ["--version"], install).trim(),
    package: installed.name, packageVersion: installed.version, archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    resolvedDependencies, installedToolList: ["analyze", "decision", "query", "resume"],
    decisionCall: "CONFIG_ERROR attempts=0 and choice/noul/score dry_run attempts=0; network blocked in installed process", reads: "installed package only; no src/docs/test", commands };
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
