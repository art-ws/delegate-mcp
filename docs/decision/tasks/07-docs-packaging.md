# D07 — README, примеры и установочный пакет

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D06](06-mcp-integration.md).
**Срок:** 2–3 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §8/§10.9, functioning candidate D06. Владение: README.md (English), delegate-config.example.json, package files/build config при доказанной необходимости; tests/package fixtures. Подготовить existing delegate-mcp для обновления, не выполнять release.

## DoD
English README описывает fourth tool, all input options via schemas/spec links, env key injection, absence/disabled/enabled startup behavior, policy/dry-run/errors/limits/privacy, no reasoning and no execution of action. Пример дополнения существующего config — generic, только ENV reference. Node ≥20/bin package name сохраняются. Runtime schemas bundled, install-from-tarball не читает repo/docs. npm pack и npm publish --dry-run проверяют inventory; ни npm publish без dry-run, ни workflow_dispatch не выполняются. DoD содержит tarball SHA256 и reproducible command file.

## Проверки
Полный build/typecheck/lint/test/secretlint; npm pack → temp install → stdio smoke на synthetic providers/config и mocked decision HTTP. Node20/current smoke при доступных рантаймах; недоступный runtime отметить NOT_RUN и передать Q01, не менять engines. No real config/keys/internal host facts in tarball.

## Вне scope
Tag/npm publish/release workflow, активация MCP у команды, production deploy, API POST.
