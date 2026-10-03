# D06 — Регистрация четвёртого инструмента в existing MCP

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md), [D02](02-config.md), [D03](03-decision-core.md), [D04](04-http-client.md), [D05](05-observability.md).
**Срок:** 3–4 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**Разрешения и факт выдачи — только в [PROGRESS.md](PROGRESS.md); сам файл не является диспетчем.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §1/§3/§7 и S1–S7. Подключить src/decision/tool.ts в src/tools.ts ToolContext/createServer, lifecycle в src/index.ts только при необходимости отмены/cleanup. Единственный existing bin/stdio transport.

## DoD
Enabled/no-block list=4, disabled list=3; no-block CONFIG_ERROR и ноль POST даже dry-run. Configured dry-run: готовый body, attempts=0; configured call: prepare→transport→validate→assess→safe metric→MCP result. Success/error имеют structuredContent + один JSON TextContent, output schema, correct isError; uncertain не ошибка. Tool annotations и cancellation по SPEC. Нет применения decision.session_id к resume, вызова file/session loader или reader pool для decision. Старые return headers/config/sessions/pool остаются прежними.

## Проверки
Build → реальный stdio MCP-client + local mocked HTTP: initialize/list/call всех четырёх, all three primitives, dry-run, malformed params, startup fails, errors don't crash next call, abort during call. Regression existing suites. Direct function call не заменяет stdio round-trip.

## Вне scope
Новый package/bin/process/registration у агентов, реальные API keys, изменение tools list expectations без legacy scenarios.
