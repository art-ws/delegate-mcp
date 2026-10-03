# Q01 — узкий REWORK r2: tracked evidence и точная карта

Владелец test; следующий раунд только после cleanup/WIP0, live idle/clear TL и отдельной выдачи. [Q01](09-local-acceptance.md), [package followup](09-local-acceptance.FOLLOWUP-package.md), [r1](09-local-acceptance.REWORK-r1.md), [acceptance](_shared/acceptance.md), [S1–S7](_shared/interfaces.md), [SPEC](../SPEC.md). Статусы — [PROGRESS](PROGRESS.md).

Пакет `7a716d8a-4596-47d1-b989-efec82ff7c4a` заявляет PASS. TL verdict **REWORK_REQUIRED**: final integration `0c3bfde6709a440102a5aeb2ec26387be6649a23`, tree `7957755a2623c9699513a1e8735b4bc13c7b4989`, parent `989bd18f71127241a0929c667643fba0b5af5ce1` не содержит шести author tracked logs. Worktree /opt/art/p/delegate-mcp-wt/test-decision-q01-r1, review/decision-q01-r1 чистый, но ignored untracked файлы не видны в обычном status. G1 WAIT.

## Принятые части r1

- Весь `docs/decision/tasks/` Git tree совпадает с проверенным main `83ca347b9590948dc52d1e6c498af8a8c15ce361`; carriers/frozen seams сохранены. Producer runtime/manifest/lock/build bytes совпадают с `489b6aad6061e4e0161c125066ea3b79374beddd`.
- M2 real implicit activation: combined CONFIG_ERROR/attempts0/POST0 oracle RED получает decision/attempts1/POST1; отдельный query/analyze/resume GREEN при mutant. Build/restore/same GREEN подтверждены логами40–43.
- M3 named AND vector RED получает accepted вместо uncertain/below_margin; successful build/restore GREEN сохранены. M6c обе фазы до key RED; новые key body/dry/unknown-output scans и разрешённый context проверены чтением actual test bytes. Эти semantic controls не переделывать.
- Final gate exact0c3bfde после commit: before/after SHA/tree совпадают, полный suite886/886, independent21/21, commands/rc=0 по FINAL evidence. Retained/own clean pack hashes совпадают; Node20/current installed smoke evidence сохранено. Это выполненные проверки старого SHA, не final gate будущего r2.

## Остаток F-Q01-EVIDENCE

Все шесть paths из r1 существуют в физическом worktree и cmp равны source489. Однако для **каждого** `git show 0c3bfde:<path>` возвращает rc128, а `git diff --name-status 489b6aa 0c3bfde -- test/decision/fixtures` показывает D. Они восстановлены как ignored untracked файлы, а не как часть integration commit.

Нужно вернуть их в Git tree, а не только на диск:

- test/decision/fixtures/d04-attempts/11-secretlint.log
- test/decision/fixtures/d04-attempts/18-secretlint.log
- test/decision/fixtures/d05-attempts/09-secretlint.log
- test/decision/fixtures/d05-attempts/12-secretlint.log
- test/decision/fixtures/d05-attempts/16-secretlint.log
- test/decision/fixtures/d06-attempts/28-secretlint.log

Узкое разрешение r1 на побайтное восстановление сохраняется. Использовать Git restore точных source paths или force-add **только этих шести явно перечисленных paths**; никакого add-A/маски *.log/изменения ignore rules. Commit с явным pathspec. Не менять содержимое, не читать raw incident transcript.

Oracle до сдачи: `git cat-file -e <finalSHA>:<path>` rc0, `git ls-tree` содержит каждый файл; сравнить SHA256 **Git blobs** source489 и finalSHA для всех шести. Проверка только Path.exists/cmp worktree/clean status недостаточна. Diff producer→final вне согласованных main management/QA paths не должен содержать удаления или иной непредусмотренной дельты.

## Остаток точной AC map

PLAN утверждает, что каждый row именует exact oracle, но `providerUnionFormsAndSlugRules`, `localFieldsExcludedAndDryRunIsOffline`, `decisionAndLegacyPoolsSinksAreIsolated` отсутствуют в actual independent.test.ts. Это старые planned labels, не названия выполненных tests.

Исправить map на реальные существующие named tests/assertion locations и exact log/commands. Для AC-UNIONS указать фактический provider-matrix oracle; для AC-BODY — фактические body/dry-run assertions; AC-ISOLATION — реальный grouped stdio case и его sink/protocol assertions. Для остальных rows сверить scope claims с actual controls; author regression coverage так и назвать. Не требуется отдельный новый test на каждый row или повторение unchanged mutations. Непроверенное обозначить NOT_RUN, а не подставлять общую строку PASS. Сохранить26AC/14fields146slugs/18response13assessment, fixtures/expected outcomes не менять. Сохранить точные M2/M3/M6 mutation patches/recipes в secret-safe evidence для воспроизведения, старые попытки не переписывать.

## Новая сдача

Предшественник QA0c3bfde плюс **заново разрешённый fresh main**, включая этот carrier/status. Новая собственная review/decision-q01-r2 / /opt/art/p/delegate-mcp-wt/test-decision-q01-r2; предыдущие dirty/clean worktrees сохранить. Перенести accepted producer/QA delta, management tree побайтно из fresh main и вернуть шесть source logs в tracked tree. Ownership test/decision-qa и те же узкие byte-restores; runtime/canon/dependencies/build/release changes запрещены.

После corrected commit freeze новый SHA/tree и выполнить clean install→build→typecheck→lint→full test→secretlint→whitespace на **новом** exact integration SHA. Выводы во внешнем /opt/art/p/delegate-mcp-evidence/q01-r2, before/after HEAD/tree/status, commands/rc. M1–M6 и installed Node20/current evidence допустимо сохранить при точных unchanged source/oracle/artifact inputs; без новых изменений harness/runtime их повторять не требуется. Архив и ordinary entry hash сверить повторно; если inputs изменились, повторить затронутые controls. Никакого переноса старого full gate на новый SHA.

Пакет: PASS/REWORK, fresh main/source/predecessor/final SHA/tree/parent, clean worktree/owned diff, closure по Git blobs и accurate AC map, commands/rc/counts/versions, package identity и evidence reuse basis, attempts/NOT_RUN. Timebox30–45 минут активной работы, контроль в пределах timebox; сроки назначает TL при отдельной выдаче. Сначала cleanup/WIP0, самостоятельно /clear/r2 не начинать. Dev резерв; G1/Q02/G2 WAIT, liveNOT_RUN, F-D07-PUBLISH-VERSION OPEN; no publish/live/activation/push/merge. Inbox untouched.
