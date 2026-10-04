# R02 independent release QA

The checks here complement R01's config checker. They parse the actual workflow
and semantic-release config, remove the real-release guard in a parseable
negative control, and use a disposable local Git repository/bare remote to prove
the preview snapshot oracle detects ref/asset and lifecycle mutations.

Run from the candidate root after `npm ci`:

```sh
node test/release-qa/independent.mjs
node docs/release/preview.mjs --controls --output /path/out/preview.json
```

`installed-smoke.mjs <archive> <label> <output.json>` installs only the supplied
archive, then runs initialize, tools/list and the unconfigured decision call
with network APIs denied inside the installed process. It reads no source,
documentation, or test files from the candidate package. New external evidence
for this run is under `/opt/art/p/delegate-mcp-evidence/release-r02-r1/`.

The workflow grants the release job standard repository write permissions and
manual dispatch on `main`; it does not enforce an exclusive GitHub actor. The
external repository access policy was not inspected and is recorded as
`F-RELEASE-OWNER-GATE` INFO / NOT_RUN, not as a required workflow gate.
