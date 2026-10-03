# D05 safe observability component evidence

Predecessor: `f2e00ed81fbf7582ce75ea94399297e2af8bd8c7`.
Source: the commit containing this file. Verdict: COMPONENT_PASS (author evidence).
Controls declared before implementation/testing; all data and failures synthetic.

| Control | Expected observation |
| --- | --- |
| AC-SHAPE | decision -> success, dry_run -> dry_run, error -> error; exact SPEC keys and timestamp |
| AC-OPTIONALS | Absent actual_model/usage/cost stay absent; supplied zero cost survives |
| AC-SELECT | Unknown fields/toJSON/business data/error message never read or serialized; usage selects only tokens/cost |
| AC-SINK | Default stderr JSONL; optional separate file gets identical line; disabled file gets zero calls |
| AC-IO | Append throw/rejection yields fixed warning without error message/path/stack; recorder resolves void |
| AC-LOGGER | Stderr throw/rejection, including warning failure, never escapes; independent file still attempted |
| AC-IMMUTABLE | Input/result unchanged after success and every IO failure |
| AC-ISOLATION | stdout, legacy metrics/session sinks and transport receive zero calls |
| AC-DIST | Built S6 works from a standalone dist copy without checkout src/docs |

S6 uses a minimal discriminated metrics projection, never a full envelope.
D06 must construct it from approved metadata/S4 validated model and usage/error
code, and pass only S2's normalized optional metrics_file (never ready config).
Status is derived from kind, never caller supplied. No business answer, request,
state/questions/policy/trace, raw upstream body/error, or key reaches the recorder.

All nine named AC rows: PASS. 28 D05 cases plus D01 295, D02 212, D03 70,
D04 94: 699/699 PASS. Q00/Q01 runtime acceptance and mutations: NOT_RUN.

## Exact S6 exports for D06

Only runtime export: `recordDecision`. All other exports are TypeScript types.
Imports of S1 types are erased; built S6 needs only Node built-ins.

```ts
interface DecisionMetricUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

type DecisionMetricInput =
  Pick<DecisionMeta, "request_id" | "requested_model" | "elapsed_ms" | "attempts"> & (
    | { kind: "decision"; actual_model?: string; usage?: DecisionMetricUsage }
    | { kind: "dry_run" }
    | { kind: "error"; error_code: DecisionErrorCode }
  );

type DecisionMetricStatus = "success" | "dry_run" | "error";

interface DecisionMetricLine {
  ts: string;
  request_id: string;
  tool: "decision";
  requested_model: string;
  actual_model?: string;
  status: DecisionMetricStatus;
  elapsed_ms: number;
  attempts: number;
  usage?: DecisionMetricUsage;
  error_code?: DecisionErrorCode;
}

interface DecisionMetricsDependencies {
  now?: () => string;
  writeStderr?: (line: string) => void | Promise<void>;
  appendFile?: (file: string, line: string) => void | Promise<void>;
}

function recordDecision(
  input: DecisionMetricInput,
  configuredSink?: string,
  dependencies?: DecisionMetricsDependencies,
): Promise<void>;
```

D06 explicitly picks the four approved meta fields, preserving kind. For
decision success it may add `actual_model` from validated S4 result.model and
only usage.input_tokens/output_tokens/optional cost. Error uses only the safe
error.code. Dry-run attempts=0 is D06's operational responsibility. Successful
uncertain/unassessed assessments still have metric status=success; this describes
the envelope outcome, not business permission. No full envelope is accepted by
this type. Do not spread meta, config, raw response or envelope into the input.
No adapter that inspects request/result business data was added in D05.

Projection fields are trusted S1/S4 primitives, not an unknown-input validator
or a heuristic secret scrubber. Unknown extras and nested usage extras/toJSON
are ignored by explicit selection. Input/usage objects are not serialized or
modified. Optional fields are copied only when supplied, with no fabricated
zeros, rounding, or actual-model fallback.

Default stderr and the file receive identical JSONL. Timestamp is ISO UTC wall
time, while elapsed_ms is the already measured monotonic duration. Production
stderr uses writeSync on fd 2 to avoid unhandled stream error events; production
file uses asynchronous appendFile UTF-8. Sinks fail independently. File write
failure emits exactly `[decision] Metrics file write failed.` plus newline;
projection/clock failure emits `[decision] Metrics recording failed.` plus
newline. Warning failures are swallowed too. No error message/path/stack or
string conversion of a thrown/rejected value is attempted. No new directories
are created: missing/denied optional destination is a safe write failure.

## Identity, authority and resources

Personally read PROGRESS first, D05 leaf, full SPEC v0.2/input/output schemas,
shared context/interfaces/acceptance and tasks/baseline.json from absolute main
paths, not worktree management docs. Management main/origin were already
7477572b10489696935f7124eec56fb59af1c511 during these reads; all 13 baseline
hashes matched. This is a management-doc advancement, not source rebase.
Source remains feat/decision-v0.2 / dev-decision at the exact predecessor above.

Owned diff: src/decision/metrics.ts, test/decision/metrics.test.ts, this file,
and d05-attempts/*.log. No changes to S1-S5, existing src/metrics.ts, legacy
sessions/sinks, canon, dependencies, engines or build/release configuration.
Only synthetic inputs, injected sinks and disposable temp paths were used;
no real configs/keys/ENV/Keychain/API/HTTP transport were intentionally accessed
by implementation or tests. A shell execution incident below accidentally
printed inherited environment; this is not claimed as secret-safe execution. Child dist
fixtures capture stdout/stderr and remove their own temp directories in finally.

All commands after initial instruction/bootstrap reads used bin/dsh/dev-d05*.
Initial bootstrap reads before learning kb/shell.md used host shell; not claimed
as tmux execution. Worktree lease tmp/d05/dev-worktree; shared git metadata
commit uses only a short delegate-mcp/main-checkout lease. Both released before
final handoff; main checkout only read. Inbox untouched. Further cleanup/clear
is a separate TL carrier before D06.

## Reproduce and retained attempts

Node v26.3.1, npm 11.16.0, tsup 8.5.1, Vitest 3.2.7, TypeScript 5.9.3.
Build target node20 is not evidence of actual Node20 runtime.
Using existing dependencies in the isolated worktree, exact commands:

```sh
npm run build -- src/index.ts src/decision/config.ts src/decision/schemas.ts src/decision/request.ts src/decision/response.ts src/decision/assessment.ts src/decision/client.ts src/decision/metrics.ts
npm run typecheck
npm run lint
npm test -- test/decision/schemas.test.ts test/decision/config.test.ts test/decision/core.test.ts test/decision/client.test.ts test/decision/metrics.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck test/decision/metrics.test.ts
npm run secretlint
git diff --cached --check
```

| Retained attempt | Result |
| --- | --- |
| 00-read | Exploratory cat rc=1: product AGENTS.md/CLAUDE.md absent; governing agent-dev CLAUDE.md was read successfully |
| 01-build / 02-typecheck / 03-lint / 05-test-typecheck | rc=0 on first attempt |
| 04-focused | rc=0, 696/696, including first 25 S6 controls |
| 06-build / 07-focused / 08-test-typecheck | rc=0, final 699/699 after three explicit reflected EACCES controls |
| 09-secretlint | rc=0 on first attempt |
| 10-baseline-versions | rc=0, 13/13 hashes and tool versions |
| 11-lint / 12-secretlint | rc=0 on final tests/evidence |
| 13-whitespace | rc=0 staged owned diff, but enclosing shell failed as described below |
| 14-shell-incident | Sanitized description only; raw output excluded |
| 15-whitespace | Corrected staging under main-checkout lease, rc=0 |
| 16-secretlint | Final sanitized evidence rc=0 |

No failed implementation gate or waived assertion. Initial reads also attempted
eslint.config.js (absent); actual eslint.config.mjs was read and used by lint.
Build/test outputs, including first run, retained separately. Logs preserve
content/return codes; whitespace-only trailing blank lines normalized if needed.
Original baseline artifacts/tests and AC assertions were not replaced.

## Execution incident: inherited environment exposure

First staging wrapper returned rc=2 because nested shell quoting was malformed.
Its lockctl-protected subprocess executed `bash -c set`, which dumped inherited
environment, including secret values, to the tool output and a local dsh log.
The intended git stage ran after that lease had already released. This is an
execution/security failure despite the independently passing component gates.
Raw output is not copied into repository evidence, final payload or new files.
Affected variable names: GEMINI_API_KEY and MUXEON_WEB_PASSWORD. TL/operator
must decide immediate rotation/remediation; no credentials are changed here.
The dsh wrapper automatically removes its temporary output log and rc file;
their absence was verified value-blind from this session's log-path references.
The tool transcript may retain the exposure. A sanitized attempt log is retained.
First absence-verification rc=1 used a bad tmux target; corrected target rc=0
confirmed absence without printing log contents or environment.
Corrected git operations use a standalone script invoked under lockctl, avoiding
nested inline bash quoting. No claim that the exposure was fully erased.

## NOT_RUN / DEFERRED

D06 registration/MCP wiring/default server bundle integration, D07 full gate,
full legacy suite, actual Node20, npm-installed package, Q01 independent runtime
QA/mutations, Q02/live API/latency/price/privacy support. Existing server build
does not import S6 yet; additional entry CLI build verifies S6 without changing
build config. Push/merge/release/activation NOT_RUN. No QA ACCEPT/DONE claim.
