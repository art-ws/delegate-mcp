# G1 — Review и park проверенного кода в main

**Ответственный:** tl. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [Q01](09-local-acceptance.md).
**Срок:** 30–60 минут; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
Q01 PASS на точном candidate SHA, dev leaf packets, verified artifact hashes. Read-only review покрывает owned diff, SPEC traceability, secrets и исходную совместимость. tl принимает evidence; собственные runtime tests не проводит.

## DoD
Свежий main сверён; пробное слияние/полный gate делает test в Q01 на fresh-tip integration tree, не tl. Если tip изменился после QA, tl возвращает Q01 на новый immutable integration tree; зелёное старого tip не переносится. При зелёном final tree и GO-IMPLEMENT с park-main scope tl выполняет merge/push exact reviewed commit через existing workflow, без force и посторонних staged paths. Зафиксированы main SHA/tree и proven tarball identity; закрыта только локальная реализация.

## Границы
Если scope аппрува не разрешает park в main — держать проверенную feature-ветку и запросить конкретное расширение, не мержить. Live может оставаться HOLD, тогда после park статус local implementation DONE / API integration NOT_RUN. npm/tag/deploy/agent activation не выполняются. Изменение архитектуры/контракта — отдельное решение до интеграции.
