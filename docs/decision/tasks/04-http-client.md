# D04 — OpenRouter HTTP, очередь, отмена и дедлайн

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md), [D02](02-config.md).
**Срок:** 4–5 часов; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**Разрешения и факт выдачи — только в [PROGRESS.md](PROGRESS.md); сам файл не является диспетчем.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §8, S1/S2/S5. Создать src/decision/client.ts с injected transport/clock/sleep/random и bounded scheduler; focused HTTP tests. Один фиксированный endpoint Decisions API, без reader pool или endpoint fallback.

## DoD
Bearer только в HTTP header; redirects запрещены. Default один POST; явные 1–2 retries только разрешённые классы/Retry-After/backoff, общий deadline queue+sleep+send+read. Attempts соответствует начатым HTTP запросам. Ограниченный body reader, classified safe errors, billing_uncertain после неопределённой отправки. UTF-8 input cap обслуживает D03; response byte cap и non-JSON выполняет транспорт. Queue/concurrency лимиты, cancellation queued/in-flight, освобождение slots при каждом исходе. Переполнение queue: UPSTREAM_UNAVAILABLE, attempts=0.

## Проверки
Build → local injected fetch/local loopback fixture, fake clock: 400/401/402/403/404/413/429/500/502/503/524/529/unknown statuses; no default retry; Retry-After within/outside deadline; cancelled waits, oversized chunked body, redirect denied, error response отражает canary. Повторные вызовы работают после ошибок/отмены.

## Вне scope
Реальные ключи/OpenRouter POST, policy evaluation/JSON-RPC, сетевой proxy config пользователя, unrestricted retries, downgrade privacy.
