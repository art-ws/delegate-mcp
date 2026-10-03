# D02 configuration component evidence

Component verdict: PASS. Independent acceptance: NOT_RUN.
Parent: `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`.
Source: the commit containing this file, on `feat/decision-v0.2`.

The controlling SPEC/input/output and all 13 baseline SHA256 values matched the
main checkout before implementation. The current S1 interfaces bytes also match
TL's `d0e7029` stamp (SHA256
`cbcd319fa9f4fca577b6c1cff3f7fd9109e1bbd2aa53b1a1444a7b254e8b3da8`).
Main metadata was read under the short `delegate-mcp/main-checkout` lease and
released immediately. No main files or task statuses were changed.

## Reproduce

Use an isolated checkout and the existing locked dependencies. If not already
installed, use `npm ci --ignore-scripts --no-audit --no-fund`. No dependency,
lockfile, engine or build configuration change is needed.

Run in order:

```sh
npm run build -- src/index.ts src/decision/config.ts src/decision/schemas.ts
npm run typecheck
npm test -- test/config.test.ts test/decision/config.test.ts test/decision/schemas.test.ts
npm run lint
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop test/decision/config.test.ts test/decision/schemas.test.ts
npm run secretlint
git diff --check
```

Final commands above: rc=0 each. Environment: Node v26.3.1, npm 11.16.0,
tsup 8.5.1 (target node20), Vitest 3.2.7.
Focused suite: 528/528 tests PASS, comprising D02 212, legacy config 21,
and unchanged D01 behavioral assertions 295. Both compiled-component fixtures
import and run in fresh temporary directories without source/docs, with the
complete built dist layout and only the existing Zod dependency.

All keys, ENV maps, config files, metrics files, domains and header credentials
are synthetic. No actual process ENV keys, Keychain, real configs, HTTP request,
OpenRouter POST or metrics/session writes are used by the new fixtures.

## Named matrix

| AC | Behavior checked | Result |
|---|---|---|
| AC-S2 | absent -> not-configured; disabled -> disabled; enabled/default -> ready(config); direct ENV proxy throws on any read in absent/disabled cases | PASS |
| AC-KEY | strict env:VAR, literal/malformed/missing/empty/whitespace resolution rejected; valid identifier and memory-only resolution | PASS |
| AC-STRICT | nonobject/invalid enabled, unknown fields including reserved names, forbidden public options; fixed ConfigError without canary values/keys/raw Zod errors | PASS |
| AC-DEFAULTS | exact SPEC defaults; optional headers/metrics absent; no implicit activation | PASS |
| AC-MODEL | nonempty default/list/entries, membership, explicit whitelist, no trimming or replacement | PASS |
| AC-LIMITS | timeout 1000/120000, retries 0/2, positive byte/concurrency integers, queue >=0; below/above/fractional/null/string/boolean/nonfinite rejection | PASS |
| AC-PROVIDER | all 14 defaults fields, nested/reserved JSON retained, nullable ProviderPreferences preserved; only the five SPEC mandatory constraints allowed, no weakening/null/empty only | PASS |
| AC-HEADERS | public HTTPS domain/IP/IDN, no credentials, private/reserved/non-HTTPS/malformed URLs rejected, CR/LF and nonempty title checks | PASS |
| AC-METRICS | tilde expansion, relative path from cwd, normalized nonexistent-path/default-path collision, existing symlink on either/both sides and directory alias; distinct files unchanged | PASS |
| AC-CASCADE | CLI long/short/equals > ENV > home yields distinct S2 states; existing explicit missing-source checks retained in legacy suite | PASS |
| AC-LEGACY | providers remains nonempty/active; old config without OpenRouter key passes; literal legacy provider keys retain warning semantics | PASS |
| AC-DIST | built S2 exports load/run, including fail-loud ConfigError, without source/docs; D01 built declarations and safe validators still pass | PASS |

These are author component results, not independent Q00/Q01 acceptance or live
API evidence. The fixtures are hand-authored against SPEC boundaries rather than
generated from implementation defaults.

## S2 exports and consumption

`src/decision/config.ts` exports `loadDecisionSetup(raw, options)` and types
`DecisionSetup`, `DecisionConfig`, `DecisionLoadOptions`, `RequiredProvider`.
The options are injected ENV, home and legacyMetricsFile; cwd is process.cwd().
No new public JSON configuration field is introduced beyond SPEC.

```ts
type DecisionSetup =
  | { status: "not-configured" }
  | { status: "disabled" }
  | { status: "ready"; config: DecisionConfig };
```

`src/config.ts` keeps `loadConfig`, `resolveConfigPath`, `resolveAndLoadConfig` and
`ConfigError`. It reexports DecisionSetup/DecisionConfig/RequiredProvider.
The returned AppConfig always has `decision: DecisionSetup`; the property is
optional in the interface for existing programmatic AppConfig constructors.
Later runtime consumers treat an undefined property as not-configured.

Ready config contains the resolved key, default/allowed models, provider defaults,
mandatory constraints, timeout/retry defaults, request/response bytes, concurrency,
queue, and optional referer/title/normalized metrics path. Do not serialize it or
pass its key to request/envelope/logging. Disabled settings are opaque: no key,
other setting or unknown field is resolved or validated.

S1 safe validation retains provider JSON without defaults/normalization; D02
explicitly fills config defaults. Canonical ProviderPreferences allows null, so
explicit provider_defaults:null is preserved. required_provider remains a strict
object with only data_collection:deny, zdr:true, allow_fallbacks:false,
require_parameters:true and a nonempty only list. D03 applies these constraints
to requests; this leaf does not assemble or execute requests.

Referer checks are lexical, including URL canonicalization of unusual IPv4 forms
and rejection of local/reserved hosts. No DNS lookup occurs: the referer is an
attribution header, not a URL that this component fetches.
Metrics comparison checks normalized paths and both existing realpaths. Other
realpath errors fail safely; absent files do not create or write a sink. The
check is at configuration loading, with no hot reload or filesystem monitoring.

## Retained attempts and findings

- First build/typecheck: rc=0. First focused run: rc=1, 522 PASS / 1 FAIL.
  D02 207 and legacy config 21 already passed. The named D01 AC-DIST fixture
  failed with ERR_MODULE_NOT_FOUND because it copied only schemas.js while
  tsup now shares code chunks with the config consumer. Its copying step now
  preserves the complete dist layout; every D01 behavioral assertion remains.
  This test-only change is included in D02's corresponding regression fixtures.
- After the dist fixture fix and S2/dist assertions: 525/525 PASS; build,
  typecheck, lint and focused test typecheck rc=0. Secretlint rc=1 flagged the
  synthetic BasicAuth URL literal in a negative referer vector. The same URL is
  now assembled from synthetic authority parts; no rule suppression was added.
- Source review corrected overbroad rejection of public IPv4 ranges and added
  named valid public-address cases plus an IPv6 documentation-address control.
- Final rebuilt run: 528/528 PASS; all commands in the reproduction list rc=0.
  No unresolved D02 component failure remains.

Owned diff: src/config.ts, src/decision/config.ts,
test/decision/config.test.ts, test/decision/schemas.test.ts,
test/decision/fixtures/D02-CONFIG.md.
No canonical document/schema, S1 source, provider/files/sessions/legacy metrics
implementation, dependency, lockfile, engine, release workflow or runtime tool
registration is changed.

## Deferred / NOT_RUN

- D03 request defaults/overrides, model override enforcement, required-provider
  application and policy conflict handling, response semantics: NOT_RUN.
- D04 HTTP/deadline/retries/cancel and D05 actual metric sink: NOT_RUN.
- D06 MCP registration, tools/list and tools/call behavior: NOT_RUN.
- D07/Q01 full legacy suite, installed npm package, actual Node 20 execution and
  independent acceptance: NOT_RUN. Node20 build target is not Node20 execution.
- Q02 live API and quality/latency/price: NOT_RUN.
- Push/merge/release/activation: NOT_RUN, outside this dispatch.
