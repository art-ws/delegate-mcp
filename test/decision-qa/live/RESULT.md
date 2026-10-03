# Q02 live smoke — 2026-10-04

## Verdict

**Live smoke: FAIL_STOP after the first request.** The installed server sent one permitted synthetic request for `~typesafe/jev-latest`. OpenRouter returned the safe error `UPSTREAM_FORBIDDEN` (HTTP 403). The runner made no retry and stopped before the pinned-model call. This does not establish a model or primitive response.

## Identity and execution

- QA base: `f77656c7fddddda029f66659db8fba5e3964a2fb`, tree `d44ee39b521376284cbd9d0b85fa1b3de528c8fd`.
- Fresh `main` at dispatch: `c8124634b81037b11b89f0cd421174ed129aeb0a`, equal to `origin/main`; the Q02 branch was created at this exact tip.
- Retained package SHA-256: `0ed018ca65ccd85585acdfa9b46ef41294389d66170f144f595e2396955c1619`; installed `dist/index.js` SHA-256: `b9942bf84d5a309867bbc8397ea4f5d9d2443ddcdba292b528bf0864314eeb47`.
- Runtime: Node `v26.3.1`, npm `11.16.0`; installed package `delegate-mcp@1.0.0`.
- Runner used the installed ordinary bin over stdio. `NODE_OPTIONS` was absent. A local fetch guard allowed only POST to the fixed Decisions endpoint, counted requests/bytes, enforced the two-request and 32,768-byte ceilings, and passed original fetch arguments to native fetch.
- Preflight command: `node test/decision-qa/live/runner.mjs --install <isolated-install> --node <node-path> --mode prepare --attempt 3 --evidence <external-evidence>`; exit `0`. Both dry-runs returned with `attempts=0`; guard count remained 0. Alias request body: 545 bytes. Pinned boundary body: 9,983 bytes. Both are below the limit.
- Live command: same installed runner with `--mode live`; the private launcher supplied `env:OPENROUTER_API_KEY` to its process. Exit `1` by its stop-on-error contract. One request was counted; no retry occurred. The launcher path and real secret storage metadata are excluded from project evidence.
- Install command: `npm install --prefix <isolated-install> --ignore-scripts --no-audit --no-fund <retained-archive>`; exit `0` (`added 96 packages in 1m`).
- `git diff --check`: exit `0` before commit. No build/test suite was run as part of Q02.

## Findings

| Check | Status | Evidence |
|---|---|---|
| Alias live request | **FAIL** | `UPSTREAM_FORBIDDEN`, HTTP 403; requested model `~typesafe/jev-latest`; resolved model/provider/usage were not returned; attempts 1; POST count 1; body 545 bytes; elapsed 737 ms; `billing_uncertain=false`. |
| Three primitive responses (Choice/Noul/Score) | **NOT_RUN** | They were present in the rejected request; no answer was returned to validate. |
| Pinned `typesafe/jev-1.13`, structured guidance | **NOT_RUN** | Stopped after the first live error. |
| Choice 255 and 1 option | **NOT_RUN live** | Included in the prepared pinned body; dry-run accepted both. |
| Score 10 and 1 criteria | **NOT_RUN live** | Included in the prepared pinned body; dry-run accepted both. |
| Noul without criteria | **NOT_RUN live** | Included in the prepared pinned body; dry-run accepted it. |
| Single-option and degenerate-scale warnings | **PASS dry-run; NOT_RUN live** | `single_option` and `degenerate_scale` were emitted for the 1-option Choice and 1-level Score. |
| Request limit, timeout, no retry | **PASS configuration/preflight** | Both exact bodies ≤32,768 bytes; explicit and configured timeout 30,000 ms; explicit and configured `max_retries=0`. Live envelope attempts=1. |
| Privacy policy | **NOT_RUN / not applied** | No required privacy policy was configured; no third request was authorized for this run. No privacy guarantee is claimed. |
| Budget and secret safety | **PASS** | Ledger is stopped with 1 of 2 requests consumed and 1 remaining; no replay. Value-blind scans passed for the returned MCP result and captured server stderr. |

## Sanitized evidence

External evidence directory: `/opt/art/p/delegate-mcp-evidence/q02/`.

- `prepare-attempt-3-summary.json`, `alias-dry-run-body.json`, `boundaries-dry-run-body.json`
- `live-partial.json`, `live-attempt-1-stopped.json`, `fetch-counter.json`, `budget-ledger.json`
- `install/` is the isolated fresh install of the retained archive. The original archive was left unchanged.

Two earlier local preflight harness attempts stopped before any POST; their stage files remain in the evidence directory. They did not consume budget. The third preflight passed. No raw upstream body, headers, authorization, key value, stderr, or error text is retained.

## Deferred

- Pinned-model and live boundary verification are deferred to TL direction; the remaining request budget is not reusable by this work-order.
- Model quality/calibration, cost projection, latency SLA, and privacy guarantees were not evaluated.
