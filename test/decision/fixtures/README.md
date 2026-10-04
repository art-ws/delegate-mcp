# D01 component evidence and fixture matrix

Component verdict: PASS. Independent Q00/Q01 acceptance: NOT_RUN.
Parent: `9c268a425fbea852045c05f0ea19b86db37ba929`.
The source is the commit containing this file; no canonical schema, dependency,
lockfile, build configuration, legacy module or task-state file is changed.

These fixtures are synthetic. No API, real config, secret store, environment key,
reader pool, sessions or metrics are accessed. The dist test starts a Node process
in a temporary directory containing only the built component and its existing
Zod dependency, without checkout src/docs.

## Reproduce from this commit

Use an isolated checkout with Node >=20. Run in order:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build -- src/index.ts src/decision/schemas.ts
npm run typecheck
npm test -- test/decision/schemas.test.ts
npm run lint
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop test/decision/schemas.test.ts
npm run secretlint
git diff --check
```

All final commands returned rc=0. Environment: Node v26.3.1, npm 11.16.0,
locked tsup 8.5.1, Vitest 3.2.7. Final focused suite: 1 file, 295 tests PASS.
The build targets node20. Actual Node 20 execution is NOT_RUN (not installed);
minimum-version package acceptance belongs to D07/Q01.

The existing build CLI emits `dist/index.js` and `dist/decision/schemas.js`.
The additional component entry is necessary for this leaf: the ordinary
`npm run build` still has only the existing index entry and does not include
the unregistered module. D06 must import it into the server's normal bundle.
No tsup/config/index changes are made in D01.

## Matrix

| Named AC | Independent expected behavior | Result |
|---|---|---|
| AC-CANON | Embedded input/output declarations deep-equal unchanged canonical JSON; independent expected required lists and 1/255, 1/10 bounds | PASS |
| AC-INPUT | Choice 0/1/255/256, Score 0/1/10/11; all mixed types, absent required/optional fields, Noul optional/both/missing criteria; string/object/array and null Choice descriptions | PASS |
| AC-PROVIDER | Exactly 14 fields, every documented union/nullable form, omission of each field; independently listed 146 unique options slugs, unknown slug rejection | PASS |
| AC-LOCAL | Execution bounds/integers/booleans; three policy forms, mandatory thresholds, [0,1]; five optional trace strings and arbitrary metadata; Unicode user/session limits | PASS |
| AC-STRICT-JSON | Unknown contract fields rejected, reserved JSON map keys retained, finite JSON-only input, cycles/accessors/sparse arrays rejected, fixed errors without input keys/values | PASS |
| AC-OUTPUT | Decision/dry_run/error, required and absent optional upstream fields, full metrics, structured legend, open upstream objects, strict envelope/meta/assessment/error objects | PASS |
| AC-S1 | Typed discriminated results/variants; fixtures explicitly preserve form-valid values requiring later semantic rejection | PASS |
| AC-DIST | Fresh directory with built module + Zod, no source/docs; both JSON schemas and safe validators import and execute | PASS |

The independent expectations and boundary constructors in schemas.test.ts are
hand-authored, rather than generated from the runtime schema. Full mixed input,
minimal envelopes and all known options keys are explicit JSON fixtures.
Snapshot equality is an additional declaration check, not the only oracle.

## S1 exports

Public declarations for tools/list:
`decisionInputJsonSchema`, `decisionOutputJsonSchema`.

Safe validators:
`validateDecisionArgs`, `validateDecisionEnvelope`,
`validateDecisionsResponse`. Each accepts unknown and returns
`DecisionValidation<T>`: either `{success:true,data:T}`, or
`{success:false,error:{code,message}}`. Codes are INVALID_ARGUMENT for input
and UPSTREAM_PROTOCOL for output. Success preserves the input object, optional
absence and nested JSON; callers must treat validated data as immutable.
No defaults, response normalization or policy evaluation happen here.

Types:
`DecisionArgs`, `DecisionEnvelope`, `DecisionsRequest`, `DecisionsResponse`,
`DecisionQuestion`, `DecisionAnswer`, `DecisionPolicy`, `DecisionExecution`,
`DecisionTrace`, `DecisionAssessment`, `DecisionMeta`, `DecisionError`,
`DecisionErrorCode`, `ProviderPreferences`, `ProviderOptionSlug`,
`DecisionValidation<T>`, `JsonValue`, `JsonObject`, `StructuredValue`.

Zod form schemas:
`decisionArgsSchema`, `decisionEnvelopeSchema`, `decisionsRequestSchema`,
`decisionsResponseSchema`, `decisionQuestionSchema`, `decisionAnswerSchema`,
`decisionPolicySchema`, `decisionExecutionSchema`, `decisionAssessmentSchema`,
`decisionMetaSchema`, `decisionErrorSchema`, `providerPreferencesSchema`.
Known option enumeration: `providerOptionSlugs`.

Use the safe functions at public error boundaries; raw Zod issues can contain
caller-controlled paths/values. JSON-only checking is provided by these functions.
For tools/list use the JSON declarations explicitly: the form schemas contain
custom JSON/map validation and preprocessing, and are not a lossless source for
SDK automatic Zod-to-JSON conversion. MCP registration itself is D06/NOT_RUN.

## Deferred semantic checks

- D02/D03: config defaults, allowed model/provider constraints, required_provider
  conflicts, effective execution limits and prepared UTF-8 byte size.
- D03: matching question/policy IDs and types, Noul false_max < true_min;
  warning generation, threshold equality, AND, ties and assessment status.
- D03: exact answer IDs/types/options; Noul/confidence/probability/Score ranges,
  probability keys/sums/selected maximum, Score expectation/legend equality;
  nonnegative usage/cost; selecting only documented upstream fields.
- D06: dry-run attempts=0 and envelope/request operational consistency.
- D07/Q01: ordinary server bundle/installed package, Node 20 execution,
  full legacy regression and independent acceptance.

Finite-number JSON semantics are implemented here (including nested data); they
are not deferred. Numeric ranges absent from canonical output remain deferred.
Canonical upstream objects allow additional JSON fields, so form validation
accepts them. D03 must remove unknown upstream fields before emitting a result.

## Retained observations

- Initial offline npm ci: rc=1 / ENOTCACHED for an existing lockfile package.
  Normal npm ci with scripts disabled: rc=0, lockfile unchanged.
- Initial file-generation shell invocation: rc=1 from quoting, no file created;
  corrected invocation succeeded. No failed build/typecheck/focused-suite gate.
- Initial suite: 291 PASS. A targeted reserved-key probe then showed that Zod
  silently accepted an unknown top-level __proto__ key. A check of original
  contract keys and a named regression case fix that without changing the canon.
- Integer form checking uses Number.isInteger, without adding Zod's safe-integer
  bound absent from canonical schemas. A 2^54 output integer fixture passes.
- First staged whitespace check: rc=2 for a new blank line at source EOF;
  removed it before committing and reran the final checks.
- Final rebuild/typecheck/focused suite: rc=0 / 295 PASS. Lint, separate focused
  test typecheck, secretlint and whitespace check: rc=0.

No network inference, key/config access, MCP registration, policy evaluation,
legacy full-suite gate, push, merge, release or activation was performed.
