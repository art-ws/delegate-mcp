# D03 — Сборка запроса, проверка ответа и policy

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md), [D02](02-config.md).
**Срок:** 3–4 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §3–8, S1–S4. Чистые функции prepareDecision / validateResponse / assess без IO. Владение: src/decision/assessment.ts, при необходимости src/decision/request.ts/response.ts, focused tests. Добавление этих двух файлов не меняет публичный контракт.

## DoD
Apply model/defaults and mandatory provider merge; reject POLICY_CONFLICT, unknown policy IDs/types and invalid noul interval. Body ровно upstream fields; policy/execution/ключ исключены. Проверить размер окончательного JSON UTF-8 без truncation. Warn one-option/one-level, не менять options. Ответ: exact question keys/types, known choice, finite numbers/ranges, distribution/score tolerance и legend по SPEC; optional missing metrics/cost preserved absent, unknown upstream fields отброшены. Policy: unassessed default, Choice AND/margin/tie, inclusive Noul boundaries, Score no rounding; missing metric → uncertain.

## Проверки
Независимые synthetic vectors: provider null/weakening/subset/array override; exact UTF-8 cap; below/equal/above thresholds; tied probabilities; missing optional metrics; wrong option/ID/legend/score/distribution and negative cost. Invalid reply → UPSTREAM_PROTOCOL без частичного принятия. Результат соответствует output schema.

## Вне scope
Network/retries/логи/tool actions, изменение probability tolerances ради fixtures, добавление готового объяснения Jev.
