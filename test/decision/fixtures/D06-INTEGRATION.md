# D06 MCP integration component evidence

Predecessor: `0d0ade5fad394e7451453618ac81e71aa1e52f53`.
Author component evidence only. Independent QA remains Q01.

Controls declared before implementation; all transports/credentials are synthetic.

| Control | Required observation |
| --- | --- |
| D06-INVENTORY | Real stdio initialize/list: absent/ready four tools, disabled three; undefined programmatic setup behaves absent |
| D06-STARTUP | Invalid enabled block/missing key/providers fail before serving; disabled opaque block resolves no key |
| D06-SCHEMAS | Exact canonical input/output declarations, annotations and forbidden task support over stdio |
| D06-PIPELINE | Choice/Noul/Score, all provider fields and correlation fields survive exact S3 bytes; local fields and keys isolated |
| D06-DRY | Ready dry-run exact prepared body, zero attempts/POST; absent dry-run safe CONFIG_ERROR |
| D06-ERROR | Safe semantic/protocol/transport errors, billing/attempts/status preserved, schema-valid envelope and JSON text equality; next call recovers |
| D06-META | Injected local ID, monotonic elapsed, requested vs actual model, S3/S4 warnings and optional absence preserved |
| D06-METRICS | Minimal S6 projection, separate optional sinks, uncertain normal success, best-effort IO, no canary reflection |
| D06-CANCEL | Real MCP cancellation during queue/fetch/body/backoff, no retry after cancel; shared FIFO slots recover |
| D06-CLOSE | SDK disconnect cancels queued/in-flight decision transport through handler signal |
| D06-LEGACY | Real stdio analyze/query/resume preserve headers, file packing, session pinning, pool and metric behavior; decision never uses them |
| D06-REGRESSION | Ordinary build, typecheck, lint, full existing regression plus new suite, secretlint, whitespace |

Production endpoint/config surface, S1-S6 producer modules, dependencies, engines,
canon and release configuration stay within the dispatch scope. Package install,
actual Node20, independent mutations and live API are NOT_RUN (D07/Q01/Q02).

All twelve named rows above: PASS (author component). Full regression: 865/865,
13 files, including 42 D06 cases and all 823 predecessor cases. No assertion was
removed or waived. The one legacy list expectation includes decision; every
legacy schema/header/session/pool/metric scenario remains present.

## Source and scope

Source: the commit containing this evidence; parent is the predecessor above.
Branch `feat/decision-v0.2`, isolated worktree `dev-decision`. Management canon
was personally read from the main checkout, initially main/origin/main
`4debc94050419d260c3d8a3b20f7cc960d8df4f1`; all 13 baseline SHA256 values matched.
Final baseline identities/bytes are retained in `d06-attempts/26-baseline.log`.
S1-S6 modules, legacy producers, config, canon, package/lockfile, engines and
build/release configuration are unchanged.

Owned source: `src/decision/tool.ts`, `src/decision/registration.ts`, only
ToolContext/createServer additions in `src/tools.ts`, EOF cleanup in
`src/index.ts`. Owned verification: `integration.test.ts`, one existing legacy
list-expectation adjustment in `test/tools.test.ts`, these synthetic fixtures
and retained evidence. Commit stages only those explicit paths.

## S7 exports and injection

Runtime exports from `src/decision/tool.ts`:

```ts
createDecisionHandler(context: DecisionToolContext): DecisionHandler
registerDecisionTool(server: McpServer, context: DecisionToolContext): void
```

Type exports:

```ts
interface DecisionToolContext {
  setup?: DecisionSetup;
  transport?: DecisionTransportDependencies;
  now?: () => number;        // monotonic, separate from legacy Date.now
  requestId?: () => string;  // local, unrelated to session_id or trace
  metrics?: DecisionMetricsDependencies;
}
type DecisionHandler = (args: unknown, signal?: AbortSignal) => Promise<CallToolResult>;
// ToolContext addition; config is the only source of the setup:
decision?: Omit<DecisionToolContext, "setup">;
```

`createServer` calls registerDecisionTool first, then unchanged
registerDelegateTools. Disabled returns before registration/client/key work;
undefined setup means not-configured. One S5 client/scheduler is created per
ready registration and reused for every call. All injection is programmatic;
no endpoint/env/config/argument surface is added to production.

Owned helper `registration.ts` exports `withDecisionSchemas(server, register)`.
It must run before SDK tool handlers are initialized (public
assertCanSetRequestHandler enforces this); registerDecisionTool arranges this.
Public setRequestHandler intercepts only initial tools/list/tools/call installation,
and is restored immediately in finally. SDK list production and legacy dispatch
remain intact; S1 JSON declarations replace only decision metadata. The public
RegisteredTool.execution property supplies taskSupport=forbidden. A task request
is rejected before transport, using an SDK InvalidParams error.

The installed SDK's argument-record parser removes reserved keys such as
__proto__. The bridge preserves decision's original params through Protocol's
first parse; Server.setRequestHandler still validates canonical JSON-RPC, and
S3 validates the original args. Legacy calls receive the original canonical SDK
parse and dispatch. Malformed JSON-RPC and unknown tools retain SDK errors.

S7 calls prepare -> configured dry-run or persistent request -> validateResponse
-> assess -> explicit S6 projection -> MCP result. Exact immutable bodyJson is
sent. Meta records local ID, allowed requested model, monotonic integer elapsed,
actual started attempts and merged S3/S4 warnings. Transport errors retain observed
status/attempts/billing; semantic errors do not invent HTTP status. S4 failure
after HTTP success sets billing_uncertain=true and returns no partial result.
Canonical success has no billing_uncertain property; no additional field is added.
Success, dry-run and error duplicate one envelope in structuredContent and exactly
one JSON TextContent; uncertain/unassessed have isError=false. Optional upstream
fields remain absent. S6 receives only the four approved meta fields plus kind,
validated model/token/cost primitives or safe error code, and only the S2 sink.

## Lifecycle and synthetic stdio evidence

SDK handler `extra.signal` reaches S5 queue/backoff/native fetch/body waits.
Real SDK cancellation produces the expected client promise rejection; internal
safe CANCELLED metric lines prove attempts=0 for queued and attempts=1 for active
requests, no retry, and next-call recovery. Queue overflow and queued deadline
also return schema-valid envelopes with zero attempts. EOF now calls the existing
server.close because SDK stdio does not do so itself; SDK aborts queued/in-flight
handler signals, removes listeners and exits before the client's 2s SIGTERM
fallback. EOF tests verify both CANCELLED records and only one POST.

Fixture transports use native fetch to a process-owned free loopback port. A
test-only preload rewrites the fixed Decisions endpoint and rejects other
non-loopback destinations. Child processes have temporary cwd/HOME and only
explicit synthetic keys/origin plus PATH; the gate runner also gives predecessor
fixture children a minimal environment with no integration credentials. This is
local author evidence, not live API or installed-package acceptance.

Stdio checks cover all three primitives and all 14 provider fields, exact
correlation/body data, policy/execution/key/header isolation, ready/absent dry-run,
safe local/upstream/HTTP errors, recovery, optional metrics, IO failure, combined
warnings and absent confidence/probabilities/cost. Legacy analyze/query/resume
run in ready/absent/disabled modes and preserve file packing, headers, local
session histories/pinning and separate metrics. Decision.session_id never creates
a resume session. Canary reflection checks cover input errors, HTTP bodies,
invalid upstream fields, SDK abort reasons, stderr and both metric sinks.

## Reproduce

Node v26.3.1, npm 11.16.0, SDK 1.30.0, Zod 4.4.3, tsup 8.5.1, Vitest 3.2.7,
TypeScript 5.9.3; exact values in `d06-attempts/27-versions.log`. Target node20
is a build setting, not an actual Node20 execution claim. Run shell via bin/dsh.
Gate runner wraps each command, captures command/rc and supplies a minimal env:

```sh
node test/decision/fixtures/d06-run.mjs <log> npm run build
node test/decision/fixtures/d06-run.mjs <log> ./node_modules/.bin/vitest run test/decision/integration.test.ts test/tools.test.ts
node test/decision/fixtures/d06-run.mjs <log> node test/decision/fixtures/d06-component-artifacts.mjs
node test/decision/fixtures/d06-run.mjs <log> npm test
node test/decision/fixtures/d06-run.mjs <log> npm run typecheck
node test/decision/fixtures/d06-run.mjs <log> npm run lint
node test/decision/fixtures/d06-run.mjs <log> ./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck test/decision/integration.test.ts
node test/decision/fixtures/d06-run.mjs <log> npm run secretlint
git diff --cached --check
```

Ordinary npm run build includes every runtime module in dist/index.js. Old D01-D05
AC-DIST tests separately import component entrypoints and therefore need the
test-only component-artifacts script. It adds exports without cleaning dist or
altering production index bytes; before/after SHA256 is asserted. Full regression
and all new stdio tests thus run the same ordinary index (final SHA256
`b9942bf84d5a309867bbc8397ea4f5d9d2443ddcdba292b528bf0864314eeb47`).
Production build config is unchanged. A bare build -> npm test without this
fixture prerequisite still lacks the old component exports; D07 should preserve
or reconcile this test prerequisite. This is not installed-package evidence.

## Retained attempts and findings

| Attempts in d06-attempts | Command/result |
| --- | --- |
| 01/03/07/10/13-build | Ordinary npm run build rc=0 |
| 02-typecheck | rc=2, TS2367 generic schema identity comparison; fixed by comparing identity as unknown |
| 04-focused | rc=0, first 28 D06 cases |
| 05-typecheck / 06-lint / 15-typecheck | rc=0 |
| 08-focused | rc=0, 35 D06 cases, including actual EOF cleanup |
| 09-full | rc=1, 852 PASS / 6 FAIL: D01-D05 separate dist entrypoints were not built |
| 11-component-artifacts | rc=0; adds test exports, ordinary index SHA unchanged |
| 12-full | rc=1, 858 PASS / 1 FAIL: reserved __proto__ input lost by SDK record conversion |
| 14-focused | rc=0, 38 D06 + 14 legacy tools after bridge fix; includes safe task refusal and malformed RPC |
| 16-build / 19-build | minimal-env ordinary build rc=0 |
| 17-focused | minimal-env rc=0, 40 D06 + 14 legacy tools |
| 18/24-test-typecheck | minimal-env focused test TypeScript rc=0 |
| 20-component-artifacts | minimal-env rc=0; final ordinary index SHA unchanged |
| 21/25-full | minimal-env rc=0, final 865/865 (42 D06 + 823 predecessor); 25 runs stdio from temporary cwd |
| 22-typecheck / 23-lint | minimal-env rc=0 |
| 26-baseline / 27-versions | rc=0, 13/13 baseline bytes and exact versions |
| 28-secretlint / 29-whitespace | final full secretlint and staged whitespace, rc=0 |
| 30-staging-first | rc=1 because gitignore excludes secretlint report; corrected by forcing only that safe explicitly owned report, without changing ignore rules |
| 31-whitespace-first | rc=2 for trailing spaces in Vitest's retained failure output; normalized only log whitespace, preserving commands/failures/assertions |

F-D06-SDK-RECORD: resolved in owned bridge with named stdio RED -> GREEN.
F-D06-COMPONENT-ARTIFACTS: resolved for this regression by explicit fixture
preparation, preserving ordinary index identity and all six AC-DIST assertions;
the bare-command prerequisite is reported above for D07. First failures are kept
in separate logs; no producer seam, assertion or canonical schema was relaxed.
Only trailing whitespace and end-of-file blank lines in owned logs are normalized.
No raw F-D05 transcript/environment was read or copied; script/argv shell channel
was used, with no nested bash-c quoting or environment dumps.

## NOT_RUN / DEFERRED and leases

D07 docs/package gate, actual Node20, npm pack/install, Q01 independent runtime
QA/full mutations, Q02/live API, price/latency/privacy support, push/merge/release/
activation: NOT_RUN. No independent ACCEPT/DONE is claimed. Next leaf requires
separate TL review and cleanup/clear carrier.

Worktree lease tmp/d06/dev-worktree; shared git metadata only under short
delegate-mcp/main-checkout lease for explicit staging/commit. Main checkout was
read-only. Both leases are released before final handoff; inbox untouched.
