# R02 r1 independent release QA

Scope: isolated trial integration of the accepted R01 release preparation with
the stamped fresh main. This report covers workflow/configuration classification
and independent local controls. Exact final commit identity and post-commit
full-gate/build/archive evidence are recorded in external evidence at
`/opt/art/p/delegate-mcp-evidence/release-r02-r1/`.

## Classification

- Workflow/manual-only trigger, boolean `dry_run` default true, `main` guards,
  preview-to-release dependency, explicit false condition, job permissions,
  bounded timeouts, concurrency, and command ordering: PASS.
- Current repo behavior follows standard writer permissions and manual dispatch
  on `main`. The workflow does not establish exclusive actor enforcement;
  external repository access policy was not inspected. `F-RELEASE-OWNER-GATE` is
  INFO / NOT_RUN and is not a required P1 gate.
- Plugin order and exact git asset set: PASS. `publishConfig.provenance=true`
  is in the packed manifest; trusted-publisher settings, token validity, OIDC
  exchange, and published attestation remain NOT_RUN.
- Parseable publication-guard removal: named assertion RED, expected.
- Disposable preview lifecycle/ref/asset mutation: named snapshot assertion
  RED, expected. No external release or publication plugin is invoked.
- Local analyzer: baseline and test-only integration predict no release; the
  actual feature history predicts minor `1.1.0` from `1.0.0` and includes the
  decision feature notes. Preview lifecycle calls and local refs/assets remain
  unchanged.

No workflow dispatch, npm publication (including dry-run), tag, GitHub Release,
credential read, or live API request was performed. R02 PASS, if all final
identity and gate checks succeed, is QA of release preparation only; it is not
READY and does not resolve the separate live/Q02 limitation.
