// Independent clean-production build, package inventory, fresh installs, and stdio smoke.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = process.argv[2];
const retained = process.argv[3];
assert(evidence && retained, "Usage: node package-smoke.mjs <evidence-dir> <retained-author-tgz>");
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "q01-package-"));
const home = join(scratch, "home");
mkdirSync(home);
const env = {
  HOME: home,
  PATH: dirname(process.execPath) + ":/opt/homebrew/bin:/usr/bin:/bin",
  CI: "1",
  NO_COLOR: "1",
};
const logs = [];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const walk = (dir, prefix = "") => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name), prefix + entry.name + "/") : [prefix + entry.name]);
function run(name, command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024,
  });
  const rc = result.status ?? 1;
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, name + ".log"), "command=" + JSON.stringify([command, ...args]) + "\nrc=" + rc + "\n" + output);
  logs.push({ name, rc });
  assert.equal(rc, 0, name + " failed; retain this first attempt");
  return result.stdout ?? "";
}
function productionCopy(target) {
  mkdirSync(target);
  for (const path of ["src", "tsup.config.ts", "tsconfig.json", "package.json", "package-lock.json", "README.md", "delegate-config.example.json", "LICENSE"]) {
    cpSync(join(root, path), join(target, path), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(target, "node_modules"), "dir");
}
function install(tarball, name) {
  const target = join(scratch, name);
  mkdirSync(target);
  writeFileSync(join(target, "package.json"), '{"private":true,"type":"module"}\n');
  run(name + "-install", "npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], target);
  const pkg = join(target, "node_modules/delegate-mcp");
  const bin = join(pkg, "dist/index.js");
  assert(existsSync(bin), name + " did not install the declared bin");
  assert.deepEqual(walk(pkg).filter((path) => !path.startsWith("node_modules/")).sort(),
    ["LICENSE", "README.md", "delegate-config.example.json", "dist/index.js", "package.json"]);
  assert(!existsSync(join(pkg, "src")) && !existsSync(join(pkg, "docs")) && !existsSync(join(pkg, "test")));
  const installedPackage = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
  const dependencyVersions = Object.fromEntries(Object.keys(installedPackage.dependencies ?? {}).map((name) => {
    const dependencyPackage = join(target, "node_modules", ...name.split("/"), "package.json");
    assert(existsSync(dependencyPackage), name + " was not installed at the fresh install root");
    return [name, JSON.parse(readFileSync(dependencyPackage, "utf8")).version];
  }));
  writeFileSync(join(evidence, name + "-resolved-dependencies.log"), JSON.stringify(dependencyVersions, null, 2) + "\n");
  return { target, pkg: realpathSync(pkg), bin: realpathSync(bin), indexSha: sha(bin), dependencyVersions };
}

try {
  const production = join(scratch, "production");
  productionCopy(production);
  run("clean-production-build", "npm", ["run", "build"], production);
  const productionFiles = walk(join(production, "dist")).sort();
  assert.deepEqual(productionFiles, ["index.js"]);
  const productionIndexSha = sha(join(production, "dist/index.js"));
  const packOutput = JSON.parse(run("own-pack", "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", evidence], production))[0];
  assert.deepEqual(packOutput.files.map((entry) => entry.path).sort(),
    ["LICENSE", "README.md", "delegate-config.example.json", "dist/index.js", "package.json"]);
  const ownTarball = join(evidence, packOutput.filename);
  const author = install(resolve(retained), "retained-author");
  const independent = install(ownTarball, "independent-pack");
  assert.equal(independent.indexSha, productionIndexSha);
  const runtimes = [
    { name: "node20", path: process.argv[4] },
    { name: "current", path: process.argv[5] ?? process.execPath },
  ];
  assert(runtimes[0].path, "Node 20 executable is required");
  const preload = resolve(join(root, "test/decision-qa/stdio-preload.cjs"));
  for (const runtime of runtimes) {
    run("retained-author-" + runtime.name + "-stdio", "npm", ["test", "--", "test/decision-qa/independent.test.ts", "-t", "stdioConfigLifecycle"],
      root, { Q01_SERVER_NODE: runtime.path, Q01_SERVER_BIN: author.bin, Q01_STDIO_PRELOAD: preload });
    run("independent-pack-" + runtime.name + "-stdio", "npm", ["test", "--", "test/decision-qa/independent.test.ts", "-t", "stdioConfigLifecycle"],
      root, { Q01_SERVER_NODE: runtime.path, Q01_SERVER_BIN: independent.bin, Q01_STDIO_PRELOAD: preload });
  }
  const packageSummary = {
    retainedAuthorSha256: sha(resolve(retained)),
    retainedAuthorIndexSha256: author.indexSha,
    ownTarballSha256: sha(ownTarball),
    ownTarball: packOutput.filename,
    productionIndexSha256: productionIndexSha,
    inventory: packOutput.files.map((entry) => entry.path).sort(),
    retainedDependencies: author.dependencyVersions,
    ownDependencies: independent.dependencyVersions,
    runtimes: runtimes.map((runtime) => ({ name: runtime.name, version: run(runtime.name + "-version", runtime.path, ["--version"], home).trim() })),
    commands: logs,
  };
  writeFileSync(join(evidence, "package-summary.json"), JSON.stringify(packageSummary, null, 2) + "\n");
  process.stdout.write("PASS package identity and installed stdio runtime matrix\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
