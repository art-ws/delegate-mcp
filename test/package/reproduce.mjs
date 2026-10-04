// Run from a clean candidate checkout with npm ci already completed.
// node test/package/reproduce.mjs [gate|isolated|package|all] [server-node ...]
// Production copies contain only the declared inputs; no test exports can enter pack.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv[2] ?? "all";
assert(["gate", "isolated", "package", "all"].includes(mode));
const runtimes = process.argv.slice(3);
if (runtimes.length === 0) runtimes.push(process.execPath);
const evidence = join(root, "test/package/evidence"); mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "d07-reproduce-"));
const home = join(scratch, "home"); mkdirSync(home);
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: home, CI: "1", NO_COLOR: "1", npm_config_cache: join(scratch, "npm-cache") };
const summary = [];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function run(name, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  const rc = result.status ?? 1;
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const sanitize = (s) => s.replaceAll(root, "<source>").replaceAll(scratch, "<scratch>");
  const log = sanitize(`command=${JSON.stringify([command, ...args])}\nrc=${rc}\n${output}`).replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((s) => s.trimEnd()).join("\n").trimEnd() + "\n";
  writeFileSync(join(evidence, `${name}.log`), log);
  summary.push({ name, command: sanitize(JSON.stringify([command, ...args])), rc });
  process.stdout.write(`${name} rc=${rc}\n${output.split("\n").slice(-9).join("\n")}\n`);
  assert.equal(rc, 0, `${name}: retained failed attempt (no retry/waiver)`);
  return result.stdout;
}
function copy(paths, target) {
  mkdirSync(target, { recursive: true });
  for (const path of paths) cpSync(join(root, path), join(target, path), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(target, "node_modules"), "dir");
}
function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
}
try {
  run(`${mode}-versions`, process.execPath, ["--version"]);
  run(`${mode}-npm-version`, "npm", ["--version"]);
  if (mode === "gate" || mode === "all") {
    for (const task of ["build", "typecheck", "lint", "test", "secretlint"]) run(task === "secretlint" ? "final-security-scan" : `final-${task}`, "npm", task === "test" ? ["test"] : ["run", task]);
  }
  if (mode === "isolated" || mode === "all") {
    const checkout = join(scratch, "isolated");
    copy(["src", "test", "docs", "delegate-config.example.json", "package.json", "package-lock.json", "tsup.config.ts", "tsconfig.json", "eslint.config.mjs", ".secretlintrc.json", ".secretlintignore"], checkout);
    // Dependency cache is shared read-only; all source, dist and schema files are local copies.
    assert.notEqual(checkout, root);
    run("isolated-build", "npm", ["run", "build"], checkout);
    env.NODE_OPTIONS = `--require=${join(checkout, "test/package/oracle-guard.cjs")}`;
    env.D07_ORACLE_CHECKOUT = checkout;
    try {
      run("isolated-oracle-guard-self-check", process.execPath, ["-e", 'const fs=require("node:fs"),a=require("node:assert/strict"); fs.readFileSync(process.argv[1]); a.throws(()=>fs.readFileSync(process.argv[2]),/External schema oracle/); console.log("PASS local canonical oracle allowed; external checkout forbidden");', join(checkout, "docs/decision/input.schema.json"), join(root, "docs/decision/input.schema.json")], checkout);
      run("isolated-test", "npm", ["test"], checkout);
    }
    finally { delete env.NODE_OPTIONS; delete env.D07_ORACLE_CHECKOUT; }
  }
  if (mode === "package" || mode === "all") {
    const production = join(scratch, "production");
    const inputs = ["src", "tsup.config.ts", "tsconfig.json", "package.json", "package-lock.json", "README.md", "delegate-config.example.json", "LICENSE"];
    copy(inputs, production);
    const inputFiles = [...walk(join(root, "src"), "src/"), ...inputs.filter((p) => p !== "src")].sort();
    const identity = { build: "npm run build (tsup.config.ts; clean:true; only src/index.ts entry; node20 target)", buildNode: process.version, sourceInputs: Object.fromEntries(inputFiles.map((p) => [p, sha(join(root, p))])) };
    writeFileSync(join(evidence, "production-inputs.json"), JSON.stringify(identity, null, 2) + "\n");
    run("production-build", "npm", ["run", "build"], production);
    assert.deepEqual(walk(join(production, "dist")), ["index.js"]);
    const indexSha = sha(join(production, "dist/index.js"));
    const packed = JSON.parse(run("pack", "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", evidence], production))[0];
    assert.deepEqual(packed.files.map((f) => f.path).sort(), ["LICENSE", "README.md", "delegate-config.example.json", "dist/index.js", "package.json"]);
    const tarball = join(evidence, packed.filename);
    writeFileSync(join(evidence, "inventory.json"), JSON.stringify({ tarball: packed.filename, sha256: sha(tarball), indexSha256: indexSha, npmIntegrity: packed.integrity, files: packed.files }, null, 2) + "\n");
    // npm 11's default dry-run refuses an already-published version before emitting
    // inventory. Preserve that finding separately; --force here checks inventory only.
    // --dry-run is unconditional, and name/version/release configuration stay unchanged.
    const dryPublish = JSON.parse(run("publish-inventory-dry-run", "npm", ["publish", "--dry-run", "--force", "--json", "--ignore-scripts", tarball], production))["delegate-mcp"];
    assert.equal(dryPublish.integrity, packed.integrity);
    assert.deepEqual(dryPublish.files, packed.files);
    const installed = join(scratch, "installed"); mkdirSync(installed);
    writeFileSync(join(installed, "package.json"), '{"private":true,"type":"module"}\n');
    run("fresh-install", "npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], installed);
    assert.equal(sha(join(installed, "node_modules/delegate-mcp/dist/index.js")), indexSha);
    const installedPackage = JSON.parse(readFileSync(join(installed, "node_modules/delegate-mcp/package.json"), "utf8"));
    assert.equal(installedPackage.name, "delegate-mcp"); assert.equal(installedPackage.version, "1.0.0");
    assert.equal(installedPackage.engines.node, ">=20"); assert.equal(installedPackage.bin["delegate-mcp"], "dist/index.js");
    for (let i = 0; i < runtimes.length; i++) {
      run(`installed-node-${i}-version`, runtimes[i], ["--version"]);
      run(`installed-node-${i}-smoke`, process.execPath, [join(root, "test/package/installed-smoke.mjs"), installed, runtimes[i]]);
    }
  }
} finally {
  writeFileSync(join(evidence, `${mode}-commands.json`), JSON.stringify(summary, null, 2) + "\n");
  // Owned disposable builds/install have finished; retained logs and tarball survive.
  rmSync(scratch, { recursive: true, force: true });
}
