# D07 author evidence

Author component result: **PASS with named limitations**. Independent Q01/G1 acceptance
and live inference are **NOT_RUN**. Source parent is
`42734c1412a7d24d62e427d49301db86fd7f8255`; the final source SHA is the commit containing
this evidence and is supplied in the handoff. Management baseline was read at `7493f25`;
all 13 declared main baseline hashes matched before execution. Canonical input/output
schema bytes matched the reviewed baseline, and no canonical or producer module changed.

## Change and ownership

- English README documents the fourth tool, all arguments via canonical links,
  startup/config behavior, ENV injection, policy, limits, safe errors, and privacy.
- Generic `delegate-config.example.json` retains all previous reader fields and adds
  decision with `enabled:false`. Inject its referenced variable and change enabled to
  true to activate. This preserves the existing example-config regression assertion.
- `package.json` adds only `pretest`, using the already-reviewed D06 fixture preparation.
  Name/version/bin/engines/dependencies, package-lock, build config and release workflow
  remain unchanged. Production build still emits just the ordinary entry.
- Two reads in `integration.test.ts` now use repository-relative canonical schema URLs.
  Existing runtime-export comparisons and independent canonical comparisons both remain.
- Everything else is owned package fixtures, the repeat script, and retained evidence.
  No old assertion was removed or relaxed.

## Reproduce and restore

From a clean checkout of the exact final candidate, with Node >=20 and npm installed:

```sh
npm ci
node test/package/reproduce.mjs gate
node test/package/reproduce.mjs isolated
node test/package/reproduce.mjs package /path/to/current/node /path/to/other/node
```

Omit runtime arguments to use the running Node. The script constructs a minimal child
environment (synthetic HOME, no inherited integration credentials), writes exact
command/rc logs and JSON command indexes under `test/package/evidence/`, and tears down
only its own temporary production build/install/isolated suite. It leaves the packed
tarball and evidence there. `gate` means exactly build → typecheck → lint → full test →
secretlint. `isolated` copies source/tests/canon to a temporary cwd, shares only the
read-only dependency cache, builds there, and runs the full suite there.

Every package invocation starts an independently declared clean production build from
`src/`, `tsup.config.ts`, `tsconfig.json`, package metadata/lock, README, example, and
LICENSE. Exact input SHA256 hashes are in `evidence/production-inputs.json`. Packing never
uses the test-enriched worktree dist. To restore an ordinary production dist in the
working checkout after tests, run `npm run build`. Tests' preparation checks the entry
SHA before/after; it cannot silently replace that ordinary entry.

The installed fixture imports its SDK from the fresh installation and launches the
installed `node_modules/.bin/delegate-mcp` with the requested real Node runtime. It never
imports source producer modules. Canonical schemas are an independent fixture oracle;
the installed package itself contains no src/docs/tests. Test-only preload redirects
only the fixed production Decision URL to an owned ephemeral loopback port, retains
native fetch, and rejects every other non-fixture destination. Reader HTTP also stays
on that same owned fixture. No real configuration, key, Keychain or inference API is used.

## Results

| Named control | Result / evidence |
| --- | --- |
| D07-README/EXAMPLE | PASS; English docs and generic disabled addition; all previous example assertions retained |
| D07-GATE | PASS; final build/typecheck/lint/test/secretlint logs, rc=0; 13 files, 865/865 cases |
| D07-AC-DIST | PASS; all six original cases retained; standard npm pretest now prepares their exports |
| D07-ENTRY-IDENTITY | PASS; before/after preparation and clean production/installed entry SHA256 `b9942bf84d5a309867bbc8397ea4f5d9d2443ddcdba292b528bf0864314eeb47` |
| D07-ISOLATED-ORACLE | PASS; temporary cwd suite 865/865; preload forbids schema reads outside that checkout; self-check allows local oracle and deliberately rejects external oracle |
| D07-PACK-INVENTORY | PASS; npm pack, five files, no test exports or source/docs |
| D07-PUBLISH-INVENTORY | PASS; npm publish --dry-run --force --json --ignore-scripts on the tarball; exact files and integrity equal npm pack |
| D07-PUBLISH-DEFAULT | FAIL / F-D07-PUBLISH-VERSION; npm 11 ordinary dry-run rejects the unchanged already-published version; no waiver or version/release change |
| D07-INSTALLED-STDIO | PASS on Node v26.3.1 and v24.18.0; actual initialize/list/call on installed bin, twelve named control lines per runtime |
| D07-NODE20 | NOT_RUN; no Node20 executable found in PATH or local Homebrew runtime locations; transfer to Q01; node20 build target is not runtime proof |
| Independent Q01/mutations/G1 | NOT_RUN; owned author checks do not claim ACCEPT/DONE |
| Real Decision API/release/tag/push/merge/activation | NOT_RUN; outside this dispatch |

Installed controls cover absent (four tools/CONFIG_ERROR, including dry-run, no key
activation), disabled (three tools, unresolved invalid key), ready (four tools), missing
key/invalid-block startup rc=1 with no stdout, bundled schema parity, dual envelope,
Choice/Noul/Score full provider/trace/user/session round-trip, exact dry-run wire body,
dry-run attempts=0, optional metric/cost absence, uncertain and unassessed assessments,
safe reflected HTTP error, reader-session/metrics isolation, and analyze/query/resume
with stored history/provider/model pinning. Each runtime uses three synthetic Decision
POSTs and nine synthetic chat POSTs locally; these are not live API results.

Toolchain: Darwin, build Node v26.3.1, npm 11.16.0, tsup 8.5.1. Runtime observations are
from actual installed subprocesses, not target declarations. Installed runtime
dependency versions are resolved from the unchanged package ranges during fresh npm
install; future registry resolution can differ. Build dependencies use the existing
lockfile; Q01 should verify the exact retained artifact plus its independent controls.

## Artifact

Retained file: `evidence/delegate-mcp-1.0.0.tgz` (ignored build artifact, not source).

SHA256: `0ed018ca65ccd85585acdfa9b46ef41294389d66170f144f595e2396955c1619`.

Exact inventory (bytes/modes): LICENSE 1067/0644, README.md 27956/0644,
delegate-config.example.json 1592/0644, dist/index.js 102802/0755,
package.json 1801/0644. JSON inventory and npm integrity are in `evidence/inventory.json`.
Fresh installation verified the installed entry bytes against that production entry.

## Retained attempts and findings

1. `01-baseline-build.log` rc=0 and `02-baseline-test-red.log` rc=1: bare D06 sequence
   failed the six AC-DIST cases (859 passed). Fixed by standard pretest preparation;
   no hidden manual step, assertion change, or waiver.
2. `03-build.log`, `04-typecheck.log`, `05-lint.log` rc=0; `06-test.log` rc=1 (864 passed):
   initially enabled example required an additional key in the unchanged old regression
   fixture. Fixed the owned example to disabled and explained explicit enabling.
3. `attempt-07-publish-existing-version.log` rc=1: F-D07-PUBLISH-VERSION. npm 11 checks
   registry version eligibility even for default dry-run and refuses existing 1.0.0.
   Name/version must stay unchanged in D07. A separately named forced **dry-run** validates
   inventory while explicitly skipping that eligibility check; it does not establish
   release eligibility or close the default dry-run finding. TL must resolve release
   version only in a later authorized release task. No publish operation without dry-run.
4. `attempt-08-isolated-missing-sample.log` rc=1: temporary copy omitted the example read
   by the legacy suite. Fixed the fixture copy list; no production or assertion change.
5. `attempt-09-smoke-history-oracle.log` rc=1: author fixture expected resume to increase
   HTTP message count, while the legacy contract folds history into one prompt. Corrected
   this new assertion to verify prior question/answer/follow-up and pinned model on wire.
6. `attempt-10-oracle-macos-path.log` rc=1: new oracle guard compared `/var` and `/private/var`
   lexically and rejected its own canonical files. Fixed both sides to realpaths; negative
   external-oracle control and full isolated suite then passed.
7. `attempt-11-whitespace-red.log` rc=2: staging review found trailing whitespace and
   terminal blank lines in captured test output. Evidence display was normalized (ANSI
   colors/trailing whitespace only); complete assertions, commands, rc and first failures
   remain. Final explicit-path whitespace review then passed. Secretlint evidence uses
   `final-security-scan.log` because the existing ignore rule excludes `*secret*` filenames.

DEFERRED: Node20 runtime proof and independent Q01/mutations; default registry dry-run
eligibility is the named third outcome, not silently folded into packaging inventory PASS.
Inbox is untouched; main is read only; no source push/merge/release/activation is performed.
