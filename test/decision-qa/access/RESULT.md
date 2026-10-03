# D-ACCESS — bounded access diagnostics

## Verdict

**UNKNOWN: Decisions access refusal cause not established.** The two authorized GET observations each returned HTTP 403. The current-key endpoint did not return the required HTTP 200 response shape, and the model catalog did not return a usable catalog. Neither result explains the earlier Decisions POST 403. No further calls are authorized by this work order.

The runner passed all no-key synthetic controls. Its per-request socket timeout was configured as 15 seconds. Measured elapsed time was 15,400 ms for models and 15,216 ms for key, so this run does not demonstrate a strict 15-second wall-clock bound; the runner records that elapsed time and made no repeat. The two requests are retained as the only live attempts.

## Source and ownership

- QA source: `6b5f503cd15a6fbbda112604192b09eb2e6029e7`; tree `3277f33b288e67d553d2f466137dd9156fd80b38`; parent `c8124634b81037b11b89f0cd421174ed129aeb0a`.
- Worktree: `/opt/art/p/delegate-mcp-wt/test-decision-q02-access`; branch `review/decision-q02-access`.
- Owned repository paths: `test/decision-qa/access/` only. External evidence: `/opt/art/p/delegate-mcp-evidence/q02-access/`.
- Runtime: Python 3.14.5. Node: not used.
- The old Q02 paid ledger and its stopped remaining request were not opened for reuse or modified.

## Commands and results

- No-key controls: `python3 test/decision-qa/access/runner.py --mode controls --evidence /opt/art/p/delegate-mcp-evidence/q02-access` — exit 0, `PASS`.
- Live command: `python3 <private secretctl pointer> exec OPENROUTER_API_KEY -- <owned bin/dsh> --mode live --evidence /opt/art/p/delegate-mcp-evidence/q02-access` — exit 0. The private pointer and its storage metadata are intentionally omitted here. The launcher passed the key only in the child environment, then reduced that environment to `OPENROUTER_API_KEY`.
- `bin/dsh` is a standalone argv launcher. No `bash -c`, environment dump, tracing, retry wrapper, or proxy configuration was used.
- Synthetic controls covered: unknown/private field dropping; false, null, and missing distinctions; expiry derivation; HTTP 403, invalid JSON, oversize, and redirect classifications; reflected canary absent from persisted controls.

## Sanitized observations

Evidence is in `projection.json` and `controls.json` outside the repository. The saved projection contains only HTTP status, elapsed time, response byte count, fixed category, exact model-presence booleans, key-recognition/expiry/flag booleans or `unknown`, and request counters.

| Endpoint | Status | Elapsed | Bytes | Category | Projection |
|---|---:|---:|---:|---|---|
| `GET /api/v1/models` | 403 | 15,400 ms | 66 | `HTTP_ERROR` | Exact id/slug presence is `unknown`; no catalog shape was accepted. |
| `GET /api/v1/key` | 403 | 15,216 ms | 66 | `HTTP_ERROR` | `recognized=false` under the required 200+shape rule; expiry, key flags, and positive remaining limit are `unknown`. |

Counters: models GET 1; key GET 1; POST 0; retries 0; redirects 0. The requests used the same child environment key. No response body, headers, error text, identifiers, labels, dates, usage values, or full model catalog was persisted. The stopped Q02 paid ledger was untouched.

The in-process value-blind check scanned each projected row and final serialized evidence for the current key before writing; no match occurred. Synthetic controls separately verified that a reflected canary and private fixture fields do not enter evidence. Diagnostics use fixed messages only.

## Interpretation and limits

- The key endpoint did not prove that the key is accepted, expired, or otherwise valid; its required recognized response shape was unavailable.
- The catalog endpoint did not establish presence or absence of either exact model id or canonical slug.
- Neither GET establishes Decisions entitlement or the cause of the earlier Q02 403. Do not infer region, guardrails, account state, budget, or a model alias explanation.
- Required residual question for TL/operator: what permission or account-side condition, if any, governs Decisions access for this key? Answering it needs an explicitly approved owner-side check. No further API calls or settings changes are proposed here.
- The documented endpoints and request shapes were personally checked at the official current-key and models-list API reference pages. Their raw-print examples were not used.

## Scope status

This leaf does not claim G2 or Release readiness. R02 Release QA was not started. No POST/inference call, key/account setting change, alternate endpoint/key/route/proxy, retry, release workflow, publish, tag, or activation occurred.
