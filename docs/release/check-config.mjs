// Structural workflow checks plus negative controls; never invokes Actions/auth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../../.releaserc.json", import.meta.url), "utf8"));
function check(w) {
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]);
  assert.equal(w.on.workflow_dispatch.inputs.dry_run.type, "boolean");
  assert.equal(w.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.deepEqual(w.permissions, { contents: "read" });
  assert.equal(w.concurrency["cancel-in-progress"], false);
  const { preview, release } = w.jobs;
  assert.equal(preview.if, "github.ref == 'refs/heads/main'");
  assert.equal(preview.permissions, undefined);
  assert.equal(preview["timeout-minutes"], 20);
  assert.equal(release["timeout-minutes"], 20);
  assert.equal(release.needs, "preview");
  assert.equal(release.if, "github.ref == 'refs/heads/main' && inputs.dry_run == false");
  assert.deepEqual(release.permissions, { contents: "write", "id-token": "write" });
  assert(!preview.steps.some((step) => step.env));
  assert.equal(preview.steps.find((step) => step.uses === "actions/checkout@v4").with["persist-credentials"], false);
  for (const job of [preview, release]) {
    const commands = job.steps.filter((step) => step.run).map((step) => step.run);
    assert(commands.indexOf("npm run build") < commands.indexOf("node docs/release/verify-artifact.mjs"));
    assert.equal(job.steps.find((step) => step.uses === "actions/setup-node@v4").with["node-version"], 24);
    assert.equal(job.steps.find((step) => step.uses === "actions/setup-node@v4").with["registry-url"], "https://registry.npmjs.org");
  }
  const previewCommands = preview.steps.filter((step) => step.run).map((step) => step.run);
  assert(previewCommands.includes("node docs/release/preview.mjs"));
  assert(!previewCommands.some((command) => /semantic-release|npm publish/.test(command)));
  const publish = release.steps.at(-1);
  assert.equal(publish.run, "npx --no-install semantic-release");
  assert.deepEqual(publish.env, { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}", NPM_TOKEN: "${{ secrets.NPM_TOKEN }}" });
}
check(workflow);
const negatives = [
  ["unsafe-default", (w) => { w.on.workflow_dispatch.inputs.dry_run.default = false; }],
  ["automatic-push", (w) => { w.on.push = {}; }],
  ["preview-write", (w) => { w.permissions.contents = "write"; }],
  ["unconditional-release", (w) => { w.jobs.release.if = "github.ref == 'refs/heads/main'"; }],
  ["preview-auth", (w) => { w.jobs.preview.steps.at(-1).env = { NPM_TOKEN: "placeholder" }; }],
];
for (const [name, mutate] of negatives) {
  const variant = structuredClone(workflow); mutate(variant);
  assert.throws(() => check(variant), assert.AssertionError, `${name} was not rejected`);
}
assert.equal(pkg.engines.node, ">=20");
assert.equal(pkg.publishConfig.provenance, true);
const npm = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/npm")[1];
assert.deepEqual(npm, { npmPublish: true });
const readme = readFileSync(new URL("../../node_modules/@semantic-release/npm/README.md", import.meta.url), "utf8");
assert(readme.includes('"publishConfig"') && readme.includes('"provenance": true'));
console.log(JSON.stringify({ status: "PASS", manualDefaultPreview: "PASS", previewPermissions: "read", releaseFalseOnly: "PASS",
  negativeControls: negatives.map(([name]) => ({ name, expected: "REJECT", observed: "REJECT" })),
  provenancePlacement: "PASS: publishConfig.provenance=true; undocumented plugin option removed",
  authRuntime: "NOT_RUN", actionsRuntime: "NOT_RUN" }, null, 2));
