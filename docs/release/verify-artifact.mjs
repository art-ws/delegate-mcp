// Ordinary npm pack + a fresh installation. No source imports and no provider calls.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
const scratch = mkdtempSync(join(tmpdir(), "delegate-release-pack-"));
const home = join(scratch, "home");
mkdirSync(home);
const env = { HOME: home, PATH: process.env.PATH, CI: "1", NO_COLOR: "1" };
const inventory = ["LICENSE", "README.md", "delegate-config.example.json", "dist/index.js", "package.json"].sort();
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const commands = [];
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  commands.push({ command: [command, ...args.map((arg) => arg.startsWith(scratch) ? "<scratch>/" + arg.slice(scratch.length + 1)
    : arg.startsWith(root) ? "<candidate>/" + arg.slice(root.length + 1) : arg)], rc: result.status });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout;
}
function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? walk(join(dir, entry.name), prefix + entry.name + "/") : [prefix + entry.name]);
}

try {
  if (output) mkdirSync(output, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "delegate-mcp");
  assert.deepEqual(manifest.bin, { "delegate-mcp": "dist/index.js" });
  assert.equal(manifest.engines.node, ">=20");
  assert.equal(manifest.publishConfig.provenance, true);
  assert.deepEqual(walk(join(root, "dist")).sort(), ["index.js"]);
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", output ?? scratch], root))[0];
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.deepEqual(packed.files.map((file) => file.path).sort(), inventory);
  const tarball = join(output ?? scratch, packed.filename);
  const install = join(scratch, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], install);
  const pkg = join(install, "node_modules/delegate-mcp");
  assert.deepEqual(walk(pkg).filter((path) => !path.startsWith("node_modules/")).sort(), inventory);
  for (const path of ["src", "docs", "test"]) assert(!existsSync(join(pkg, path)));
  const installed = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
  assert.deepEqual(installed.bin, manifest.bin);
  assert.deepEqual(installed.publishConfig, manifest.publishConfig);
  const bin = join(install, "node_modules/.bin/delegate-mcp");
  assert.equal(realpathSync(bin), realpathSync(join(pkg, installed.bin[manifest.name])));
  assert.equal(sha(bin), sha(join(root, "dist/index.js")));
  // Import the SDK from the fresh install, and execute its declared installed bin.
  const requireInstalled = createRequire(join(install, "package.json"));
  const { Client } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const { StdioClientTransport } = await import(pathToFileURL(requireInstalled.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
  const config = join(home, "config.json");
  writeFileSync(config, JSON.stringify({
    providers: [{ name: "synthetic", base_url: "http://127.0.0.1:1/v1", api_key: "env:RELEASE_SYNTHETIC", default_model: "synthetic" }],
    session_dir: join(home, "sessions"), metrics_file: join(home, "metrics.jsonl"),
  }));
  const preload = join(home, "deny-network.cjs");
  writeFileSync(preload, 'global.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };\nfor (const name of ["node:http", "node:https", "node:net", "node:tls"]) { const m = require(name); for (const k of ["request", "get", "connect", "createConnection"]) if (m[k]) m[k] = () => { throw new Error("NETWORK_FORBIDDEN"); }; }\n');
  const transport = new StdioClientTransport({ command: bin, args: ["--config", config], cwd: home,
    env: { ...env, NODE_OPTIONS: `--require=${preload}`, RELEASE_SYNTHETIC: ["synthetic", "release", "fixture"].join("-") }, stderr: "pipe" });
  const client = new Client({ name: "release-installed-smoke", version: "1" });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => { void transport.close(); }, 15000);
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["analyze", "decision", "query", "resume"]);
    const result = await client.callTool({ name: "decision", arguments: {
      state: "Synthetic release smoke", questions: { q: { type: "noul", instructions: "Check synthetic state" } }, execution: { dry_run: true },
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "CONFIG_ERROR");
    assert.equal(result.structuredContent.meta.attempts, 0);
    const metrics = stderr.trim().split("\n").map(JSON.parse);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].tool, "decision");
    assert.equal(metrics[0].status, "error");
    assert.equal(metrics[0].error_code, "CONFIG_ERROR");
    assert.equal(metrics[0].attempts, 0);
    assert(!existsSync(join(home, "metrics.jsonl")));
    assert(!existsSync(join(home, "sessions")));
  } finally { clearTimeout(timer); await client.close(); }
  const summary = { status: "PASS", node: process.version, npm: run("npm", ["--version"], home).trim(),
    package: packed.name, currentManifestVersion: packed.version, predictedSemanticVersion: "see separate preview evidence",
    tarball: packed.filename, sha256: sha(tarball), indexSha256: sha(bin), inventory,
    installedSmoke: "PASS: installed bin initialize/tools-list/decision CONFIG_ERROR attempts=0, networking denied", commands };
  if (output) writeFileSync(join(output, "artifact.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
