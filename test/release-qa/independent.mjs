import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const YAML = require("js-yaml");
const workflow = YAML.load(readFileSync(join(root, ".github/workflows/release.yml"), "utf8"));
const releaseConfig = JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8"));
const results = [];

function pass(name, fn) { fn(); results.push({ name, result: "PASS" }); }
function assertWorkflow(wf) {
  const triggerKey = Object.hasOwn(wf, "on") ? "on" : true; // js-yaml 4 uses YAML 1.1 and parses GitHub's key as a boolean.
  assert.deepEqual(Object.keys(wf[triggerKey]), ["workflow_dispatch"]);
  assert.equal(wf[triggerKey].workflow_dispatch.inputs.dry_run.type, "boolean");
  assert.equal(wf[triggerKey].workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(wf.jobs.preview.if, "github.ref == 'refs/heads/main'");
  assert.equal(wf.jobs.preview["timeout-minutes"], 20);
  assert.equal(wf.jobs.preview["runs-on"], "ubuntu-latest");
  assert.equal(wf.jobs.release.needs, "preview");
  assert.match(wf.jobs.release.if, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(wf.jobs.release.if, /inputs\.dry_run\s*==\s*false/);
  assert.equal(wf.jobs.release["timeout-minutes"], 20);
  assert.equal(wf.permissions.contents, "read");
  assert.equal(wf.jobs.preview.permissions, undefined);
  assert.equal(wf.jobs.release.permissions.contents, "write");
  assert.equal(wf.jobs.release.permissions["id-token"], "write");
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  const steps = wf.jobs.preview.steps.map((step) => JSON.stringify(step));
  const index = (needle) => steps.findIndex((step) => step.includes(needle));
  assert(index("npm ci") < index("npm run build"));
  assert(index("npm run build") < index("verify-artifact.mjs"));
  assert(index("verify-artifact.mjs") < index("preview.mjs"));
  assert(wf.jobs.preview.steps.find((step) => String(step.run).includes("npm ci")));
  assert.equal(wf.jobs.preview.steps.find((step) => String(step.uses).startsWith("actions/checkout")).with["persist-credentials"], false);
  const previewText = JSON.stringify(wf.jobs.preview);
  assert(!previewText.includes("NPM_TOKEN"));
  assert(!previewText.includes("semantic-release (real publication)"));
  const realJob = JSON.stringify(wf.jobs.release);
  assert(realJob.includes("NPM_TOKEN"));
  assert(realJob.includes("npx --no-install semantic-release"));
}

pass("workflow trigger, boolean default, job dependencies, main/ref guard, timeouts, scopes, credentials", () => assertWorkflow(workflow));

// Negative control 1: keep the workflow parseable while deleting the real-publication guard.
const bypass = structuredClone(workflow);
bypass.jobs.release.if = "github.ref == 'refs/heads/main'";
assert.equal(YAML.load(YAML.dump(bypass)).jobs.release.if, "github.ref == 'refs/heads/main'");
let nc1Red = false;
try { assertWorkflow(bypass); } catch (error) { nc1Red = error instanceof assert.AssertionError; }
assert.equal(nc1Red, true, "guard-removal mutant escaped the independent workflow oracle");
results.push({ name: "NC1 parseable release guard removal", result: "RED (expected): independent main+explicit-false guard assertion failed" });

pass("semantic-release plugin order and exact git asset scope", () => {
  const names = releaseConfig.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);
  assert.deepEqual(names, ["@semantic-release/commit-analyzer", "@semantic-release/release-notes-generator", "@semantic-release/changelog", "@semantic-release/npm", "@semantic-release/github", "@semantic-release/git"]);
  const gitPlugin = releaseConfig.plugins.find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "@semantic-release/git");
  assert.deepEqual(gitPlugin[1].assets, ["CHANGELOG.md", "package.json", "package-lock.json"]);
  assert(!releaseConfig.plugins.some((plugin) => /test|docs/i.test(Array.isArray(plugin) ? plugin[0] : plugin)));
});

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "R02 Fixture", GIT_AUTHOR_EMAIL: "r02@example.invalid", GIT_COMMITTER_NAME: "R02 Fixture", GIT_COMMITTER_EMAIL: "r02@example.invalid" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function snapshot(repo, bare) {
  return { head: git(repo, "rev-parse", "HEAD"), tags: git(repo, "tag", "--list"), assets: git(repo, "hash-object", "package.json", "package-lock.json", "CHANGELOG.md"), remote: git(bare, "show-ref") };
}
function assertPreviewInvariant(before, after, lifecycle) {
  assert.deepEqual(after, before, "preview changed local refs or release assets");
  assert.equal(lifecycle.length, 0, `forbidden preview lifecycle called: ${lifecycle.join(",")}`);
}

// Negative control 2: use a disposable repository and local bare remote only.
const scratch = mkdtempSync(join(tmpdir(), "r02-independent-control-"));
try {
  const repo = join(scratch, "repo"); const bare = join(scratch, "remote.git");
  mkdirSync(repo); git(repo, "init", "-b", "main");
  for (const [name, value] of [["package.json", "{}\n"], ["package-lock.json", "{}\n"], ["CHANGELOG.md", "# Changelog\n"]]) writeFileSync(join(repo, name), value);
  git(repo, "add", "."); git(repo, "commit", "-m", "chore: fixture"); git(repo, "tag", "v1.0.0");
  git(scratch, "init", "--bare", bare); git(repo, "remote", "add", "origin", bare); git(repo, "push", "origin", "main", "--tags");
  const before = snapshot(repo, bare);
  assertPreviewInvariant(before, snapshot(repo, bare), []);
  writeFileSync(join(repo, "package.json"), '{"previewControl":true}\n');
  git(repo, "add", "package.json"); git(repo, "commit", "-m", "chore: simulated forbidden asset mutation");
  git(repo, "push", "origin", "main");
  assert.throws(() => assertPreviewInvariant(before, snapshot(repo, bare), ["publish"]), /preview changed|forbidden preview lifecycle/);
  results.push({ name: "NC2 forbidden local lifecycle/ref/asset side effect", result: "RED (expected): independent snapshot/lifecycle oracle detected mutated fixture" });
} finally { rmSync(scratch, { recursive: true, force: true }); }

console.log(JSON.stringify({ status: "PASS", scope: "independent static YAML and local Git control assertions; no external network", results }, null, 2));
