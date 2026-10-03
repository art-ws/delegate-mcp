# Preserved initial attempts

- Initial `lockctl acquire delegate-mcp/main-checkout` returned rc=1: TL briefly
  held the checkout to record dispatch status. A subsequent acquire with a
  bounded wait succeeded. The authorized status-only main delta was checked;
  the worktree base stayed exactly a6ac09cb8b92555c48dc363acfbfa6e472c3f92c.
- Initial apply_patch was rejected before mutation because delete/add operations
  targeted the same workflow path. Replaced it with one update patch.
- Baseline preview/control run rc=0. Production build rc=0.
- `03-artifact.log`, rc=1: helper incorrectly required empty stderr after an
  unconfigured decision request. Runtime emitted its expected safe error metric
  (`CONFIG_ERROR`, attempts=0). Corrected the helper to parse and assert that
  metric. Initial artifact directory was retained, retry used a separate one.
- `04-config.log`, rc=1: `yaml` package was not installed. Used existing locked
  `js-yaml`; no dependency changes. The failure log remains separate from retry.
- Two web opens for public npm metadata returned internal tool errors. The
  standalone public metadata GET helper subsequently received HTTP200 from npm
  and GitHub, without credentials. It does not expose publisher settings.

No npm publish command (including dry-run) or real Release workflow was invoked.

- Evidence commit staging whitespace check returned rc=2 for trailing empty
  lines in npm typecheck/lint logs. They were committed before the red result
  was handled; commit2359c974 preserves those original bytes. A subsequent
  evidence-only correction removes trailing empty lines and reruns the check;
  runtime/config/artifact bytes are unaffected. No history was amended.
