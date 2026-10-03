# D04 transport component evidence

Predecessor: `79819d6b5606efd2de6f5fb8faa0e1138e40b46d`.
Verdict: COMPONENT_PASS (author evidence). Source: the commit containing this file.
Controls below were declared before implementation/testing.
Independent QA ACCEPT/DONE, MCP integration, live API and release: NOT_RUN.

S5 API: `createDecisionClient(readyConfig, dependencies?)` creates one
configured client with a persistent bounded FIFO scheduler. Its
`request(prepared, effectiveExecution, signal?)` consumes the exact S3 `bodyJson`.
Success returns decoded `body: unknown`, attempts, elapsed_ms, billing_uncertain;
failure returns a fixed `DecisionError` and the same timing/attempt metadata.
D06 owns dry-run, S4 validation, assessment and envelopes. No config serialization.

Predeclared controls (all synthetic injected fetch, no real ENV/config/key):

| Control | Required observation |
| --- | --- |
| AC-WIRE | Exact fixed URL/POST/S3 UTF-8 body; only configured auth/optional headers; manual redirect |
| AC-STATUS | Full HTTP matrix and retryable/billing flags; unknown 5xx never auto retry |
| AC-ATTEMPTS | Default 0 retries gives one POST; explicit 1/2 gives at most 2/3 |
| AC-DEADLINE | One budget covers queue, backoff, headers and body; no attempt at expiry |
| AC-RETRY-AFTER | Numeric/date wait respects budget; exponential delay plus bounded jitter |
| AC-QUEUE | Shared concurrency/FIFO/queue bound; overflow and expired waiter attempts=0 |
| AC-CANCEL | Preabort/queued/fetch/body/backoff stop; no retry; waiter removed |
| AC-BYTES | Actual chunk bytes bounded, regardless of Content-Length; non-JSON/UTF-8 invalid safe |
| AC-REDIRECT | Redirect never followed; classified protocol error |
| AC-REDACTION | Reflected body/transport/cancel canaries never in safe errors/logs |
| AC-CLEANUP | Slots/listeners/timers released after all outcomes; later calls work |
| AC-OVERRIDES | SPEC execution bounds, defaults not hard caps; dry-run cannot POST |

All twelve named AC rows above: PASS. Additional AC-DIST: PASS, built S5 runs
with S3/S4 in a temporary complete dist copy, without checkout source/docs.
94 D04 cases plus 70 D03, 212 D02 and 295 D01 cases: 671/671 PASS.

## Exact exports for D06

```ts
function createDecisionClient(
  config: DecisionConfig,
  dependencies?: DecisionTransportDependencies,
): DecisionClient;

interface DecisionClient {
  request(
    prepared: Pick<PreparedDecision, "bodyJson">,
    execution: Required<DecisionExecution>,
    signal?: AbortSignal,
  ): Promise<DecisionTransportResult>;
}

interface DecisionTransportDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => number; // monotonic milliseconds
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>; // abort-aware
  random?: () => number; // jitter source, clamped to [0,1]
  wallNow?: () => number; // epoch milliseconds for HTTP-date Retry-After only
}

interface DecisionTransportState {
  attempts: number;
  elapsed_ms: number;
  billing_uncertain: boolean;
}

type DecisionTransportResult =
  | ({ success: true; body: unknown } & DecisionTransportState)
  | ({ success: false; error: DecisionError } & DecisionTransportState);
```

Instantiate once per ready config and reuse: constructing a client per call
would defeat concurrency/queue limits. Call S4 only after S5 success; decoded
JSON is an internal boundary, not an approved MCP result. S4 owns semantic
validation and stripping of unknown fields. Do not log the decoded body.
S5 does not accept config as a per-call argument or rebuild S3 body/provider
rules. It snapshots bodyJson at entry and sends that same string on retries.
D06 handles dry_run before request; direct transport dry_run=true is a safe
INVALID_ARGUMENT with attempts=0. Execution defaults belong to S3; S5 accepts
effective values throughout SPEC's 1000–120000 ms / 0–2 bounds.

## Operational reasons

- One monotonic deadline starts at request entry before queue acquisition.
  It is never restarted. One abort-aware watchdog interrupts waiting IO even
  if an injected fetch ignores its signal. Retry waits are capped at remaining
  budget, preventing large Retry-After from overflowing Node timers. Retry-After
  uses max(exponential backoff+jitter, requested wait), for seconds or HTTP-date.
- Attempts increments immediately before each fetch invocation. Queue overflow,
  queued deadline, preabort and abort after slot grant but before fetch have zero.
  FIFO slots cover the request including backoff, not only the individual POST.
- Automatic retries: network failures and 429/500/502/503/524/529 only, at most
  max_retries+1 attempts. Unknown 5xx is retryable for a new user request but
  never automatically retried. Exhausted deadline remains retryable=true but
  blocks any new automatic attempt. Protocol/cancel/argument errors are false.
- HTTP status is present only when classification has an observed response;
  local queue/cancel/deadline/network errors do not invent a status. Non-2xx
  bodies are discarded immediately without parsing or logging. Successful
  bodies are read with an actual byte bound, independent of Content-Length;
  malformed JSON/invalid UTF-8/oversize is UPSTREAM_PROTOCOL, without retry.
- billing_uncertain is sticky after network failure, 5xx, unexpected response,
  or an unusable successful body. Known 4xx rejection does not introduce it.
  Cancel/deadline introduces it while a send/result is unresolved; during
  backoff after a known 429 it remains false unless an earlier attempt was
  uncertain. Later success or known rejection cannot clear earlier uncertainty.
  There is no exactly-once or free-retry claim.
- Every outcome removes caller and phase listeners, aborts the watchdog and
  request controller, and releases its slot exactly once. Cancelled queued
  waiters are removed; late responses are cancelled; body readers are cancelled
  and unlocked without waiting for an uncooperative source. Reuse is covered
  after success/error/protocol/network/cancel/timeout/overflow.
- Messages are fixed strings. Upstream bodies/errors/headers, caller abort
  reasons, ready config and key never enter safe failures or logs. Only the
  Authorization header receives the synthetic key. Optional HTTP-Referer/X-Title
  come from config; session_id remains solely in S3 body. Redirects are manual
  and all redirect statuses (or already-redirected injected responses) fail.

## Identity / scope

Personally read management documents from main
`6a6fb7cd3cdca2febb2269fe6e8fb67ce0cac263`: PROGRESS first, D04 leaf, full
SPEC v0.2, input/output schemas, shared context/interfaces/acceptance and
tasks/baseline.json. All 13 main baseline hashes verified unchanged.
Worktree branch: feat/decision-v0.2, exact predecessor above; no checkout switch.
Owned files: src/decision/client.ts, test/decision/client.test.ts, this file
and d04-attempts/*.log. No S1–S4, legacy runtime, canon, dependencies, engines,
build/release configuration or main checkout changes.

Only synthetic injected fetch and controllable streams were used. No HTTP
listener, real ENV/config/key/Keychain read, OpenRouter POST or user proxy setup.
The temporary dist directory is generated and removed by the fixture itself.
Initial bootstrap reads preceded learning kb/shell.md and used host shell;
all implementation and verification commands thereafter used bin/dsh / dev-d04*.
Worktree mutation lease: tmp/d04/dev-worktree, acquired via lockctl and released
before final handoff (the live release/status is reported with delivery).

## Reproduce / retained attempts

Existing dependencies only. Node v26.3.1, npm 11.16.0, tsup 8.5.1 target node20,
Vitest 3.2.7. In the isolated worktree, build before tests:

```sh
npm run build -- src/index.ts src/decision/config.ts src/decision/schemas.ts src/decision/request.ts src/decision/response.ts src/decision/assessment.ts src/decision/client.ts
npm run typecheck
npm run lint
npm test -- test/decision/client.test.ts test/decision/core.test.ts test/decision/config.test.ts test/decision/schemas.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck test/decision/client.test.ts
npm run secretlint
git diff --cached --check
```

Command output is retained in d04-attempts; trailing blank lines are normalized
for git whitespace hygiene, without changing failure messages. Exit codes:

| Logs | Command/result |
| --- | --- |
| 01-build / 02-typecheck | first build/typecheck rc=0 |
| 03-focused | first focused rc=1: 85/86; huge Retry-After overflowed timer and started extra attempts instead of deadline |
| 04-lint | rc=0 |
| 05-test-typecheck | first test typecheck rc=2: inferred headers union contained optional undefined Content-Length |
| 06-build / 07-focused | rc=0, 669/669 after bounded waits, typed fixture and more controls |
| 08-typecheck / 09-lint / 10-test-typecheck / 11-secretlint | rc=0 |
| 12-focused | rc=0, 671/671 including compiled S5 and grant/cancel race |
| 13-build / 14-focused | final source build and focused rc=0, 671/671 |
| 15-typecheck / 16-lint / 17-test-typecheck | final rc=0 |
| 18-secretlint | final rc=0 |
| 19-whitespace-first | first staged whitespace rc=2: npm/Vitest logs contained trailing blank lines; normalized log endings |

First failures were preserved, fixed by bounding the wait at remaining budget
and explicitly typing fixture headers; the original assertions remain.
Later cleanup review moved watchdog creation inside the safe try/finally and
avoided duplicate response discard during backoff. Final rebuild and controls
cover these source bytes. No gate was waived or failed test ignored.
The final staged whitespace check after normalization returns rc=0.

## DEFERRED / NOT_RUN

Independent Q00/Q01 acceptance and mutations; full legacy suite; actual Node20
execution and npm-installed package; loopback/native-fetch network fixture;
D05 observability, D06 MCP registration/envelopes, D07 gate; Q02 live API,
latency/price/quality/privacy support. Push/merge/release/activation NOT_RUN.
The normal server bundle does not register S5 yet; extra build entries above
verify this component without changing build configuration. No ACCEPT/DONE claim.
