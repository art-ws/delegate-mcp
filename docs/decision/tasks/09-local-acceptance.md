# Q01 — Независимая локальная приёмка и регрессия

**Ответственный:** test. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D07](07-docs-packaging.md), [Q00](08-independent-test-plan.md).
**Срок:** 4–6 часов; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
Законченный immutable candidate SHA, D07 tarball hash, Q00 plan, SPEC §10. Приёмка в отдельном worktree: source build и installed-artifact checks различаются в отчёте. Проверяет test, не автор dev и не tl.

## Scope / DoD
Выполнить _shared/acceptance.md целиком на synthetic/local fixtures. Build→typecheck→lint→полный npm test→secretlint; Node20/current; stdio initialize/tools/list/call; npm pack/temp install с отсутствующим checkout source/docs. Все исходные analyze/query/resume regression paths, disabled/no-block/enabled, wire-body и response rules, retries/cancel/queue/IO, six predeclared mutations. У mutations successful build+named RED+restore GREEN обязательны.

Перед G1 test проверяет свежий main и trial integration в своём изолированном worktree: полный gate должен относиться к точному интеграционному SHA, который TL затем park в main. Если main или candidate изменились, прежний PASS не переносится автоматически; test повторяет затронутые проверки на новом SHA и фиксирует идентичность npm artifact.

## Вердикт
PASS только при подтверждённых AC и сохранении frozen baseline seams; FAIL/REWORK с минимальным reproduction иначе. Mismatch с dev сначала проверить своим методом. Новая реализация вне SPEC — finding, не silent patch. Вердикт содержит SHA, tarball hash, commands/rc, oracle controls, findings и NOT_RUN live/quality/calibration. Приёмка реального API этим листом не заявляется.

## Ограничения
Никаких real credentials, внешних POST, изменения runtime, shared checkout installs или npm publish. Исправления маршрутизирует tl в следующий dev leaf, после этого retest той же test-руке на новом SHA.
