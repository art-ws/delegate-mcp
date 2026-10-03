# R01 component result

Verdict: **COMPONENT_PASS**. Independent release QA/acceptance is **NOT_RUN**.
Publication and activation remain **HOLD**.

Authorized base: `a6ac09cb8b92555c48dc363acfbfa6e472c3f92c`.
Feature source: `f7ed1f52a3e27a53d3c703b9e0725500abb5f00a`, parent = base,
tree `7852c96eca9f12ed33e81d8ec760088881b3a1be`. Subsequent evidence-only commits
do not change workflow/helpers/manifest/runtime. Final source/parent/tree and
clean status are resolved in the handoff and rechecked against fresh main in QA.

## Behavior and controls

| Check | Verdict | Evidence |
|---|---|---|
| Manual trigger, preview default, read-only preview, explicit-false release, timeout20 | PASS (structural) | `07-config.log`, `check-config.mjs` |
| Unsafe default, push trigger, write preview, unconditional release, preview auth | PASS: all five rejected | `07-config.log` |
| Actual pre-feature reachable history | PASS: no release | `baseline-preview.json` actual-history |
| Test-only negative history | PASS: no release, empty notes | Both preview JSONs |
| Synthetic feature positive | PASS: minor 1.1.0, nonempty decision notes | Both preview JSONs |
| Actual feature reachable history | PASS: minor 1.1.0 from v1.0.0 | `candidate-preview.json`, `09-candidate-preview.log` |
| Preview lifecycle / refs / assets | PASS in disposable local Git fixtures | Zero prepare/publish/addChannel/success/fail; HEAD/tags/assets/bare refs unchanged |
| Production build | PASS | `02-build.log`, rc=0 |
| Ordinary pack / fresh install / installed bin | PASS | `artifact-r01-a2/artifact.json`, `05-artifact.log` |
| Provenance configuration placement | PASS (configuration and source review) | Packed publishConfig.provenance=true; unsupported npm plugin option removed |
| Current Trusted Publisher configuration | DEFERRED | `06-metadata.json`, public GET metadata does not expose settings |
| Existing token authentication | PRESERVED; validity NOT_RUN | Token reference retained only in real release step; values never read |
| Real Actions preview/release, OIDC exchange, published provenance | NOT_RUN | No workflow dispatch or publication |
| Actual Node20 / independent full project gate | NOT_RUN in R01 | Separate independent release QA scope |

The analyzer used semantic-release **25.0.8**, commit-analyzer **13.0.1** and
release-notes-generator **14.1.1** on actual local Node **26.3.1**, npm **11.16.0**.
The runner declaration stays Node24 and prints actual Node/npm versions; runtime
engines stay Node>=20. OIDC requires Node>=22.14/npm>=11.5.1, but runner execution
and external publisher settings are not verified by a local version print.

Actual generated user note:

> **decision:** prepare automated release of decision tool

The feature commit body describes choice/score/noul questions, context,
policies/assessments, dry-run, bounded execution, safe errors and metrics. Default
release rules remain intact; no all-test/docs-minor rule or accepted-history
rewrite was introduced. The library's dry-run log may say “Published release”;
that wording is not publication evidence. Guard counts and snapshots establish
the local no-side-effects result. Only analyzer/notes plugins were executed;
production npm/GitHub/git/changelog authentication and release hooks were excluded.

## Artifact identities

Current manifest remains **1.0.0**. Analyzer predicts **1.1.0** separately.
The verification tarball is not the future prepared/published versioned tarball.

- New ordinary tarball SHA256:
  `b1868080421d5748b269e4822d9cb3c29c00b5058cc46a860bbdb906acb19f10`.
- Installed/build entry SHA256:
  `b9942bf84d5a309867bbc8397ea4f5d9d2443ddcdba292b528bf0864314eeb47`.
- Historical retained archive was only read and rehashed; unchanged SHA256:
  `0ed018ca65ccd85585acdfa9b46ef41294389d66170f144f595e2396955c1619`.
- Actual packed/installed inventory:
  `LICENSE`, `README.md`, `delegate-config.example.json`, `dist/index.js`, `package.json`.
- Installed bin: initialize + tools/list (analyze, decision, query, resume) +
  decision dry request on absent configuration = CONFIG_ERROR, attempts0;
  expected safe metric parsed, no sessions/legacy metrics, networking denied.
- Initial failed-helper tgz and successful retry tgz were kept in separate
  ignored artifact directories; both hash to the new archive SHA. No old
  tarball was rebuilt or overwritten. Binary archives are retained locally,
  while inventory/hash and logs are tracked public evidence.

## Commands / return codes

| Command | rc |
|---|---|
| npm ci --ignore-scripts --no-audit --no-fund | 0 |
| node preview.mjs --ref base --controls --output baseline-preview.json | 0 |
| npm run build | 0 |
| npm run typecheck / npm run lint | 0 / 0 |
| node verify-artifact.mjs initial-directory | 1; expected-metric helper error retained |
| node check-config.mjs first attempt | 1; absent yaml import retained |
| node verify-artifact.mjs retry-directory | 0 (npm pack0/install0/npm-version0) |
| node check-config.mjs retry | 0 |
| node metadata.mjs | 0; npm/GitHub public GET HTTP200 |
| node --check (all four helpers) | 0 |
| secretlint owned workflow/config/manifest/helpers/docs/JSON/logs | 0 |
| git diff --check / staged diff --check | 0 |
| First evidence-commit staged whitespace check | 2; blank EOF in typecheck/lint logs, preserved in2359c974 then normalized |
| node preview.mjs --controls --output candidate-preview.json | 0 |
| sha256 historical/new/first-attempt archives | 0; identities above |

The initial lock contention and tooling/helper failures are preserved in
`FIRST-ATTEMPTS.md` and separate logs. Dependencies, lockfile, engines, source,
canon, manual version, generated CHANGELOG and accepted history are unchanged.
Only the unsupported provenance npm plugin option justified a release-config
change; npm CLI11.16.0 `lib/commands/publish.js` consumes manifest.publishConfig
via `flatten(filteredPublishConfig, opts)`, and libnpmpublish uses opts.provenance
for generation. This source review did not invoke publish or auth.

Next gates: independent exact candidate/fresh-main trial integration, full
project gate and new installed artifact on Node20/current, then owner review
and release handoff. Live failure/limitations remain separate; local component
checks do not establish a live verdict or READY FOR RELEASE.
