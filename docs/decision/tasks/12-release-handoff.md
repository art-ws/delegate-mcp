# G2 — Итоговый пакет и gate выпуска

**Ответственный:** tl. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [G1](10-integration-review.md), [Q02](11-live-smoke.md).
**Срок:** 30 минут; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
Local Q01 PASS + G1 main identity, Q02 live evidence или явно документированный отказ/NOT_RUN с решением владельца о выпуске. Подготовить конкретный reviewable release-handoff existing delegate-mcp; публикация не является действием этого листа.

## DoD
Один итоговый пакет: source/main SHA, tarball SHA256, AC map, local/live verdicts, ограничения, npm dry-run evidence, English README/config example, путь запуска с ENV reference и release workflow/version proposal. Если Q02 не прошёл/не разрешён, статус RELEASE HOLD; не подменять его local PASS. При успешном Q02 статус READY FOR RELEASE, не PUBLISHED.

## Выпуск / границы
GO-RELEASE от владельца относится к конкретному пакету/версии и разрешённому способу выпуска; до него ни npm publish, ни tag/GitHub Release/workflow_dispatch, ни массовая активация MCP. Финальное выполнение выпуска/раскатка — следующее явное поручение существующему владельцу релиза, без добавления ролей в эту команду. G2 завершается подготовкой handoff, не выдуманным доказательством публикации.
