# Q01 — REWORK r1: integration identity и отрицательные контроли

Владелец test; продолжение Q01 только после отдельной clean-slate выдачи TL.
Исходные требования: [Q01](09-local-acceptance.md), [package followup](09-local-acceptance.FOLLOWUP-package.md), [acceptance](_shared/acceptance.md), [S1–S7](_shared/interfaces.md), [SPEC](../SPEC.md). Статусы и разрешения — [PROGRESS](PROGRESS.md).

## Проверенный пакет

Сдача `0f3f4357-f0bc-4867-b328-9fbc9013cb0f` заявляет ACCEPT. TL verdict: **REWORK_REQUIRED**, G1 запрещён до исправленного Q01 PASS.

- Producer source: `489b6aad6061e4e0161c125066ea3b79374beddd`.
- Проверенный fresh main: `7ee10211b0b32d03ea489cf95821fc173f33825c`, tree `0839b4775dcdb14697fd088f1fc4210e8c2f5c62`.
- QA integration: `116280f77ae5230ce87066c5a903277103427c19`, tree `39b0abf86e3656fb93aa34bb47c4f76881496a4a`, parent `57ac5156ca9d61865b5b47e894621c7659fc3260`; clean review/decision-q01-final.
- Runtime, package manifest/lockfile и build configuration относительно producer source не изменены. Retained/independent tarballs имеют SHA256 `0ed018ca65ccd85585acdfa9b46ef41294389d66170f144f595e2396955c1619`; ordinary index `b9942bf84d5a309867bbc8397ea4f5d9d2443ddcdba292b528bf0864314eeb47`.
- `accept-full-test.log` стартует 21:53:34 MSK, после commit 21:53:06, содержит 884/884 и 19/19 independent. Прежний `immutable-*` относится к более раннему состоянию; не смешивать поколения evidence. Ошибка времени final gate не установлена.
- Node20.20.2/current26.3.1 installed stdio evidence, package inventory и исправленные M5b/M6c сохранены как выполненные проверки. Они не снимают findings ниже. TL runtime тестов не выполнял.

## F-Q01-INTEGRATION — сохранность fresh main

В интеграции против main7ee1021 удалены пять TL-owned carriers:

1. `docs/decision/tasks/07-docs-packaging.FOLLOWUP-artifacts.md`
2. `docs/decision/tasks/08-independent-test-plan.REWORK-r1.md`
3. `docs/decision/tasks/08-independent-test-plan.REWORK-r2.md`
4. `docs/decision/tasks/08-independent-test-plan.REWORK-r3.md`
5. `docs/decision/tasks/09-local-acceptance.FOLLOWUP-package.md`

Также `_shared/interfaces.md` потерял 61 строку закреплённых швов. Сохранение одного PROGRESS недостаточно: feature checkout содержит старые management docs.

Создать исправленную trial integration от **заново проверенного live main**, включая этот carrier. Перенести accepted producer delta и QA-owned paths; сохранить **всё** `docs/decision/tasks/` побайтно из fresh main. Допускается восстановление этих management paths исключительно из точного fresh main без редактирования содержания. Это узкое разрешение восстановить чужие байты, не владение каноном/статусами. Не переносить весь устаревший feature tree поверх main. Проверить diff/hash всех main management paths, а не только PROGRESS; записать main SHA/tree и integration SHA/tree. После final gate TL не будет дописывать management в проверенный candidate перед G1.

## F-Q01-EVIDENCE — авторские tracked файлы

Относительно source489b6aa исчезли шесть ранее принятых tracked evidence paths:

- `test/decision/fixtures/d04-attempts/11-secretlint.log`
- `test/decision/fixtures/d04-attempts/18-secretlint.log`
- `test/decision/fixtures/d05-attempts/09-secretlint.log`
- `test/decision/fixtures/d05-attempts/12-secretlint.log`
- `test/decision/fixtures/d05-attempts/16-secretlint.log`
- `test/decision/fixtures/d06-attempts/28-secretlint.log`

Восстановить ровно эти tracked файлы побайтно из source489b6aa; игнорирование `*.log` не разрешает удалять уже tracked файлы. Узкое разрешение на восстановление дано этим carrier. Не менять другие author evidence; не читать raw incident transcript. Проверить producer paths вне QA ownership на отсутствие непредусмотренной дельты и сохранить сравнение.

## F-Q01-MUTATIONS — M2/M3 не соответствуют объявленным контролям

`run-mutations.py` реально делает M2 `not-configured → disabled`. Это полезный RED на tools/list, но **не** обязательное implicit ENV activation. В `M2-03-mutant-red.log` падение inventory assertion происходит до legacy query/resume/analyze, поэтому GREEN этих инструментов при мутанте не доказан.

Добавить именно M2 из acceptance: absent decision block при заданном синтетическом ENV ошибочно активирует ready setup или резолвит ENV. Проверить конкретный absent-config CONFIG_ERROR/zero-POST oracle; одновременно отдельными assertions/test cases выполнить query/analyze (и сохранённый resume) GREEN **пока M2 установлен**. Не объединять их с ранним RED assertion в один обрывающийся test. Записать candidate build GREEN → mutant build GREEN → named decision RED + named legacy GREEN → restore build и тот же decision/legacy GREEN. Старый M2 оставить как дополнительный hidden-tool negative, его PASS не выдавать за закрытие обязательного M2.

M3 реально исключает `below_margin` из failures через дополнительный `reason !== "below_margin"`. Named AND vector RED действителен как margin-bypass control, но это не заявленные Choice OR или Noul inclusive-boundary mutation. Выполнить одну точную обязательную альтернативу: Choice OR либо Noul `<= → <` / `>= → >`. Заранее назвать соответствующий AND/equality vector; mutant должен собраться, краснить именно этот expected result и после restore дать GREEN. Старую попытку сохранить с её настоящей классификацией.

M1/M4/M5b valid sequences сохраняются; повторять их без изменившегося oracle/source не требуется. Изменения named oracles требуют повторного соответствующего mutation control. Все временные producer mutations только в собственном disposable checkout и полностью восстановлены до commit/final gate.

## F-Q01-SECRET-SURFACES — отсутствующие key assertions

В `independent.test.ts` AC-SECRET две фазы корректно доходят до двух отдельных POST; publicSurfaces сканирует failed/transportLogs/successful/sinkLogs. Но key отсутствие **не** проверяется в обоих captured request bodies, в штатном dry_run output и в unknown-key error result. Q00 per-canary recipe требует эти проверки; положительный context assertion сам по себе не доказывает key absence.

Добавить key-only negative scans для двух body captures, dry_run output, unknown-key error output и собранных sinks/logs. Context в state body и штатном dry_run request разрешён и обязан сохраняться; в reflected safe errors/logs/stderr запрещён. Authorization/harness memory не считать утечкой. Сохранить отдельные network/sink phases, exact counts и успешный sink-phase decision. После новых assertions повторить M6c: обе фазы до canary RED, restore тот же oracle GREEN. Не использовать INVALID_ARGUMENT/zero-transport вместо двух фаз.

## Сдача r1

Owned edits: `test/decision-qa/`; исключения только побайтные восстановления management tree из fresh main и шести source evidence paths выше. Producer/canon/dependencies/engines/build/release configuration не редактировать. Сохранить старые ветки/worktrees и `/opt/art/p/delegate-mcp-evidence/q01`; новые попытки в отдельном r1 evidence directory, не перезаписывать старые логи/artifacts.

Обновить AC/M1–M6 map точными существующими test names, командами/rc и путями логов. Различить independent expected-vector assertions и повторное выполнение author regression suite; generic строка «independent suite» не является доказательством всех planned oracle names. Историческую Q00 plan-only запись пометить исторической, не оставлять её текущим NOT_RUN рядом с runtime PASS.

Закрыть findings, затем freeze integration commit и выполнить **новый полный gate на его точном SHA**: clean install, build, typecheck, lint, full npm test, secretlint, whitespace. Выводы — вне immutable tree. Записать до/после HEAD/tree/status, команды/rc, failed attempts и новый PASS/REWORK verdict. Влияние changes на installed stdio harness проверить на retained и independent package под actual Node20/current; при переносе прежнего evidence обосновать точные неизменные входы, harness и artifact bytes. Own clean production pack сравнить с retained отдельно. Actual source/build, installed artifact и mutation evidence не смешивать.

Вход r1 — сохранённый QA116280f плюс fresh main после этого carrier; timebox 1–2 часа активной работы, контроль ≤90 минут, календарный срок назначает TL при отдельной выдаче. Сначала узкий cleanup/WIP=0 → live idle/clear TL → work-order. Никаких самовольных /clear, publish/dry-run publish, push/merge, real keys/configs, внешних POST или live. Dev остаётся в резерве. AC-LIVE NOT_RUN; F-D07-PUBLISH-VERSION OPEN для будущего разрешённого release.
