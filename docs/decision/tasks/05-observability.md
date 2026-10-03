# D05 — Метрики decision и безопасные сообщения

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md), [D02](02-config.md).
**Срок:** 1–2 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §7–8, S1/S2/S6. Создать src/decision/metrics.ts и focused tests. Поля метрик ограничены описанными в SPEC; raw args/response/error text не приходят в recorder.

## DoD
Best-effort stderr + optional отдельный JSONL decision.metrics_file; точные timestamps/request_id/model/status/timing/attempts/usage/error_code; отсутствие cost остаётся отсутствием. Ошибки IO не роняют вызов и не отражают секрет/контекст. Existing src/metrics.ts и старый metrics_file не меняются, sessions не создаются.

## Проверки
Build → injected filesystem/logger: success, dry_run, error, absent fields, denied-write, malformed upstream error with synthetic canary. No key/state/questions/policy/trace in sinks. Зафиксировать shape и safe error handling, не принимать личные/боевые данные.

## Вне scope
Prometheus, новый daemon, хранилище ответов, общие legacy metric changes, stdout diagnostics.
