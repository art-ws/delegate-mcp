# Manual release preparation

The Release workflow is manual (`workflow_dispatch`) and defaults to
`dry_run=true`. Select `main`. The read-only preview job builds production
`dist/index.js`, packs the ordinary manifest, installs that tarball into a fresh
temporary directory, initializes the installed MCP bin, lists its tools, and
checks an unconfigured decision request with zero upstream attempts. The smoke
denies networking in the server process and uses no real provider credentials.

Preview then runs semantic-release's analyzer and notes generator against the
exact checked-out reachable history in a disposable clone with a local bare
remote. It computes the next version and notes using the configured rules. It
loads no npm, GitHub, changelog, or git asset plugins and receives no release
credentials. Lifecycle guards and snapshots check that prepare/publish and the
other release hooks never run, and local/remote tags, HEAD and release assets do
not change. A local git push-permission check in the disposable fixture is part
of semantic-release; no external push occurs. This is an analysis preview, not
proof that production authentication works.

Only the separate job guarded by `inputs.dry_run == false` can invoke the existing
real semantic-release pipeline. Both jobs are bounded to 20 minutes. Releases
are serialized; feature branches cannot publish. The release job has the write
permissions required for version/CHANGELOG assets, tags, GitHub Releases and npm
provenance. It rebuilds and verifies its own ordinary artifact before publication.

## Local reproduction

Use a clean checkout of the candidate with the full tagged history, Node 24.10+
(or another runtime supported by the installed semantic-release), and npm:

```sh
npm ci
npm run build
node docs/release/check-config.mjs
node docs/release/verify-artifact.mjs /path/to/new-artifact-evidence
node docs/release/preview.mjs --controls --output /path/to/preview.json
node docs/release/metadata.mjs
```

The helpers do not run `npm publish`, including its dry-run variant. Keep each
failed attempt and use a new artifact directory on a retry. `verify-artifact.mjs`
reports the manifest version and tarball hash separately from the preview's
predicted semantic version. Before semantic-release's prepare step, the manifest
may still be `1.0.0` while a preview predicts `1.1.0`. The ordinary verification
tgz is therefore an inventory/smoke artifact, not the future versioned published
tgz. Historical acceptance archives remain separate evidence; a new manifest
requires a new artifact hash. No manual version bump or generated changelog edit
is needed. The release plugins update package.json, package-lock.json and
CHANGELOG.md together at release time.

## Feature visibility

The compatible decision tool is delivered alongside analyze/query/resume. It
supports choice, score and noul questions with explicit context and criteria,
dry-run request preview, policies and assessments, bounded upstream execution,
safe error envelopes and metrics. Existing delegate configuration remains
compatible; provider setup and live checks are separate release gates.

The accepted integration subject is `test: integrate approved Q01 candidate and
r2 QA`. Default semantic-release rules do not release test/docs/ci-only history.
An honest `feat(decision)` preparation commit describes the newly delivered
decision capability and release preparation without rewriting accepted history
or making all test/docs commits minor. The recorded analyzer controls require
test-only history to produce no release and feature history to produce minor
and nonempty decision notes. A future squash/merge must preserve that feature
commit's meaning; re-run preview on the final main history before release.

## Authentication and provenance

Current npm Trusted Publisher settings are **unconfirmed**. Public metadata can
show the package/repository and existing attestations, but cannot confirm the
current publisher configuration. The existing `NPM_TOKEN` reference is retained
only in the real release step; no token value is read by these helpers. Token
validity and the real Actions authentication flow are **NOT_RUN** locally.

An authorized package owner can configure and confirm a GitHub Actions Trusted
Publisher for npm package `delegate-mcp` with organization/user **art-ws**,
repository **delegate-mcp**, workflow filename **release.yml** (not its full
path), and an environment matching the workflow if one is configured. Confirm
permission for direct npm publication where npm offers an allowed-actions
choice. Settings changes and token removal require a separate authorized action;
do not remove the token reference merely because another project uses OIDC.

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
GitHub-hosted runners, npm >=11.5.1 and Node >=22.14. The runner is configured for
Node 24, while package runtime engines stay Node >=20. After confirming publisher
metadata, verify the actual runner npm version meets the requirement, explicitly
upgrade/pin the CLI if necessary, and use the existing registry-url and
`id-token: write` release permission. Exact runner versions are printed in the
workflow; their execution and OIDC exchange remain **NOT_RUN** in preparation.

Provenance is configured at `package.json.publishConfig.provenance=true`, which
the npm CLI actually reads. The npm semantic-release plugin's options are
`npmPublish`, `pkgRoot` and `tarballDir`; its former `provenance` plugin option was
not a supported consumer setting and has been removed. See the
[plugin documentation](https://github.com/semantic-release/npm#npm-configuration)
and [npm provenance guide](https://docs.npmjs.com/generating-provenance-statements/).
The packed manifest preserves this setting. A setting or an analysis preview
does not establish an attestation: published provenance is **NOT_RUN** until a
real release is separately authorized and its registry attestation inspected.

## Owner handoff

Publication is on hold until independent package/release QA, final main review,
live verdict (or an explicit owner decision about the live limitation), and the
release handoff are accepted. First run a manual preview on that exact main tip
and review the version, decision notes, artifact and external authentication
setup. Only the owner then selects `dry_run=false` to release. Preparation does
not dispatch the workflow, create a tag/GitHub Release, publish npm, or activate
the MCP server. Local component PASS is not independent acceptance or release
authorization.
