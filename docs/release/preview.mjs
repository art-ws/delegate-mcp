// Analyze the exact reachable history in a disposable clone with a LOCAL bare remote.
// Only analyzer/notes plugins are loaded; publication/git/auth plugins are excluded.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import semanticRelease from "semantic-release";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const controls = args.includes("--controls");
const refIndex = args.indexOf("--ref");
const ref = refIndex < 0 ? "HEAD" : args[refIndex + 1];
const outIndex = args.indexOf("--output");
const output = outIndex < 0 ? undefined : resolve(args[outIndex + 1]);
const scratch = mkdtempSync(join(tmpdir(), "delegate-release-preview-"));
const home = join(scratch, "home"); mkdirSync(home);
const env = { HOME: home, PATH: process.env.PATH, NO_COLOR: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Release Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Release Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const config = JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8"));
const publicRepository = "https://github.com/art-ws/delegate-mcp.git";
function pluginOptions(name) {
  const spec = config.plugins.find((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name);
  assert(spec, `Missing ${name}`);
  return Array.isArray(spec) ? spec[1] : {};
}
function git(cwd, ...argv) {
  const result = spawnSync("git", argv, { cwd, env, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${argv[0]}: ${result.stderr}`);
  return result.stdout.trim();
}
function snapshot(repo, remote) {
  return { head: git(repo, "rev-parse", "HEAD"), tags: git(repo, "tag", "--list"), status: git(repo, "status", "--porcelain"),
    assets: git(repo, "hash-object", "package.json", "package-lock.json", "CHANGELOG.md"), remoteRefs: git(remote, "show-ref") };
}
async function preview(repo, name) {
  const remote = join(scratch, name + ".git");
  git(scratch, "clone", "--bare", "--no-hardlinks", repo, remote);
  git(repo, "remote", "remove", "origin");
  git(repo, "remote", "add", "origin", remote);
  const before = snapshot(repo, remote);
  const calls = { analyzeCommits: 0, generateNotes: 0, prepare: 0, publish: 0, addChannel: 0, success: 0, fail: 0 };
  const guard = Object.fromEntries(["prepare", "publish", "addChannel", "success", "fail"].map((step) => [step, () => {
    calls[step]++; throw new Error(`Forbidden preview lifecycle: ${step}`);
  }]));
  let log = "";
  const sink = new Writable({ write(chunk, _encoding, done) { log += chunk; done(); } });
  const result = await semanticRelease({ ...config, repositoryUrl: remote, dryRun: true, ci: false,
    plugins: [{
      analyzeCommits: async (_options, context) => { calls.analyzeCommits++; return analyzeCommits(pluginOptions("@semantic-release/commit-analyzer"), context); },
      generateNotes: async (_options, context) => { calls.generateNotes++; return generateNotes(pluginOptions("@semantic-release/release-notes-generator"),
        { ...context, options: { ...context.options, repositoryUrl: publicRepository } }); },
      ...guard,
    }],
  }, { cwd: repo, env: { ...env }, stdout: sink, stderr: sink });
  assert.deepEqual(snapshot(repo, remote), before, "Preview changed refs, HEAD or assets");
  for (const step of ["prepare", "publish", "addChannel", "success", "fail"]) assert.equal(calls[step], 0);
  const summary = { name, status: "PASS", source: before.head, releaseType: result ? result.nextRelease?.type ?? null : null,
    nextVersion: result ? result.nextRelease?.version ?? null : null, lastRelease: result ? result.lastRelease?.version ?? null : null,
    notes: result ? result.nextRelease?.notes ?? "" : "", commits: result ? result.commits?.map(({ hash, subject, message }) => ({ hash, subject, message })) ?? [] : [],
    lifecycleCalls: calls, unchanged: ["local HEAD", "local tags", "local worktree/assets", "bare remote refs"],
    auth: "NOT_RUN: npm/GitHub plugins excluded; only disposable local git push-permission check", log: log.replaceAll(scratch, "<scratch>") };
  return summary;
}
function fixture(name, subject) {
  const dir = join(scratch, name); mkdirSync(dir);
  git(dir, "init", "-b", "main");
  for (const path of ["package.json", "package-lock.json", "CHANGELOG.md"]) writeFileSync(join(dir, path), readFileSync(join(root, path)));
  git(dir, "add", "package.json", "package-lock.json", "CHANGELOG.md");
  git(dir, "commit", "-m", "chore: fixture baseline"); git(dir, "tag", "v1.0.0");
  git(dir, "commit", "--allow-empty", "-m", subject);
  git(dir, "remote", "add", "origin", join(scratch, "unused.git"));
  return dir;
}
try {
  assert.deepEqual(config.branches, ["main"]);
  const source = git(root, "rev-parse", `${ref}^{commit}`);
  const trial = join(scratch, "actual-history");
  git(scratch, "clone", "--no-hardlinks", root, trial);
  git(trial, "checkout", "-B", "main", source);
  const actual = await preview(trial, "actual-history");
  actual.reachableHistory = git(trial, "log", "v1.0.0..HEAD", "--format=%H %s").split("\n");
  const results = [actual];
  if (controls) {
    const negative = await preview(fixture("test-only", "test: integrate approved Q01 candidate and r2 QA"), "test-only");
    assert.equal(negative.nextVersion, null); assert.equal(negative.notes, ""); results.push(negative);
    const feature = await preview(fixture("feature", "feat(decision): provide compatible decision tool with automated release preparation"), "feature");
    assert.equal(feature.releaseType, "minor"); assert.equal(feature.nextVersion, "1.1.0"); assert.match(feature.notes, /decision/); results.push(feature);
  }
  const evidence = { status: "PASS", node: process.version, evidenceLevel: "semantic-release API, exact reachable history in local disposable clone; not Actions or publication", results };
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n"); }
  console.log(JSON.stringify(evidence, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
