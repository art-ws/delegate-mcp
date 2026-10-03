# D03 decision-core component evidence

Component verdict: PASS. Independent QA ACCEPT/DONE: NOT_RUN.
Predecessor: `b5314e7cf634bff703a9b1fddda33ccd3f6cf7b9`.
Source: the commit containing this file on `feat/decision-v0.2`.

## Controlling source and scope

The current main checkout was `740685065096ec28be359ef505fa9895acfd0beb`.
I personally read its PROGRESS, D03 leaf, SPEC v0.2, input/output schemas,
shared context/interfaces/acceptance, and `tasks/baseline.json`. All 13
baseline hashes matched main. SPEC and both JSON schemas were byte-identical
between main and this worktree. Main `interfaces.md` differs from the older
worktree copy; main bytes matched the pinned `16d2b50` blob (SHA256
`4c05892e778f856b33bd59a901f5ebad06e7c9484d1e336820dc87306853017e`).
This component follows main S1/S2. The dispatch path
`tasks/_shared/baseline.json` does not exist; the D03 leaf points to the
actual `tasks/baseline.json`. No canonical documents were changed.

Owned files: `src/decision/request.ts`, `src/decision/response.ts`,
`src/decision/assessment.ts`, `test/decision/core.test.ts`, this evidence file.
No IO, HTTP transport, retry loop, log/MCP registration, real keys, dependency,
engine, build configuration, or shared checkout mutation.

## S3/S4 exports for D06

- `prepareDecision(args: unknown, readyConfig: DecisionConfig): PrepareDecisionResult`
  returns `{success:true,data:PreparedDecision}` or a fixed safe
  `INVALID_ARGUMENT` / `POLICY_CONFLICT` / `INPUT_TOO_LARGE`. `PreparedDecision`
  has `body: DecisionsRequest`, `bodyJson: string`, `requestBytes: number`,
  `effectiveExecution: Required<DecisionExecution>`,
  `localPolicy: DecisionPolicy | undefined`, and `warnings: string[]`.
  `bodyJson` is the exact measured UTF-8 serialization for transport;
  consumers must treat the returned snapshots as immutable. Config/key/headers
  and local execution/policy never enter `body` or `bodyJson`.
- `validateResponse(body: unknown, preparedRequest: Pick<PreparedDecision,"body">):
  ValidateResponseResult` returns `{success:true,data:{result:DecisionsResponse,
  warnings:string[]}}` or only fixed safe `UPSTREAM_PROTOCOL`. It validates
  the full decoded response against prepared question IDs/types, discards unknown
  upstream extras, and preserves optional absence. The actual upstream model
  remains in `result.model`, separate from the requested alias in `body.model`.
- `assess(result: DecisionsResponse, localPolicy?: DecisionPolicy):
  DecisionAssessments` returns one `DecisionAssessment` per validated answer.
  It is pure; uncertain is an ordinary value. Call only after successful S3/S4.

## Reproduce from this worktree

Existing locked dependencies only; if needed, `npm ci --ignore-scripts
--no-audit --no-fund`. Node v26.3.1, npm 11.16.0, tsup 8.5.1 targeting
node20, Vitest 3.2.7. Run in this order:

```sh
npm run build -- src/index.ts src/decision/config.ts src/decision/schemas.ts src/decision/request.ts src/decision/response.ts src/decision/assessment.ts
npm run typecheck
npm test -- test/decision/core.test.ts test/decision/config.test.ts test/decision/schemas.test.ts
npm run lint
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop test/decision/core.test.ts
npm run secretlint
git diff --cached --check
```

Final gate: all commands rc=0; focused suite 577/577 (D03 70, D02 212,
D01 295). It includes a standalone copy of the built dist layout with no
source/docs and the existing Zod dependency, and compiles canonical JSON
Schema 2020-12 using AJV already present in the lockfile. Synthetic values
only; no OpenRouter call or real key/config.

## Named author controls

| AC | Contract vectors | Result |
|---|---|---|
| AC-S3-MODEL | configured default, allowed override, outside whitelist | PASS |
| AC-S3-PROVIDER | null/default, whole-list/object override, nullable config, mandatory fill/subset/weakening; four scalar constraints | PASS |
| AC-S3-LOCAL | no key/config/policy/execution/headers in body, no key read, correct execution defaults and boundary overrides | PASS |
| AC-S3-POLICY | unknown ID, wrong type, Noul false_max >= true_min | PASS |
| AC-S3-BYTES | final UTF-8 serialization with multibyte state; exact/equal and one byte over | PASS |
| AC-S3-WARN | one Choice option, one Score level; original questions retained | PASS |
| AC-S4-IDS | exact answer set/types; known max Choice option including tied max | PASS |
| AC-S4-NUMERIC | Noul/confidence/probability ranges, exact Choice/Score keys, inclusive sum and score expectation tolerance, score range/legend | PASS |
| AC-S4-USAGE | mandatory token counts, optional nonnegative finite cost and preserved absence | PASS |
| AC-S4-SAFE | invalid whole body fixed UPSTREAM_PROTOCOL, no partial answer/canary leak, unknown extras stripped | PASS |
| AC-S4-POLICY | Choice AND with each single failed condition, inclusive margin/tie/missing metric; both Noul endpoints; Score below/equal/above | PASS |
| AC-S4-SCHEMA | decision/dry_run/error shapes match canonical output schema | PASS |
| AC-DIST | compiled S3/S4 exports run independently of checkout source/docs | PASS |

## Retained first attempts

- First build rc=0, first typecheck rc=2: S1 `DecisionValidation` error
  union was broader than S3 errors. S3 now returns a narrow fixed error.
- First focused run after test creation rc=0, 574/574; later 575/575 after
  canonical output-schema and dist controls.
- First standalone test-typecheck after AJV control rc=2 because AJV's
  CommonJS default import was not constructable under NodeNext. Named
  `Ajv2020` import fixed it; final test-typecheck rc=0. Lint in that same
  attempt was rc=0.
- Margin equality review found binary subtraction `0.7 - 0.2` slightly below
  `0.5`. Margin only now absorbs machine arithmetic error at inclusive
  equality; direct confidence/probability comparisons stay exact. The named
  regression passes at `0.5` and fails at `0.5001`.

## Deferred / NOT_RUN

Independent Q00/Q01 acceptance; full legacy gate; actual Node20 execution and
installed npm package; D04 HTTP/deadline/retries; D05 logs/metrics; D06 MCP
registration/wire protocol; D07 release-candidate gate; Q02 live OpenRouter;
push/merge/release/activation. No ACCEPT/DONE is claimed by this component.
