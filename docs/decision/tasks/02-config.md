# D02 — Опциональная конфигурация decision

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md).
**Срок:** 2–3 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**Разрешения и факт выдачи — только в [PROGRESS.md](PROGRESS.md); сам файл не является диспетчем.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §1.2/§8 и S1/S2. Добавить блок decision в existing AppConfig/loader. Владение: src/config.ts, src/decision/config.ts, соответствующие tests. Не менять config cascade или обязательность providers[].

## DoD
Absent → not-configured без чтения ENV; disabled → disabled, без resolution даже битого/пустого api_key; enabled → ready с validated defaults/allowed_models/limits/headers/metrics path, invalid → startup ConfigError. api_key строго env:VAR для нового блока, без значения в ошибках; legacy provider key semantics прежние. Проверка отдельности normalized metrics path и existing realpath. Требования required_provider разрешены только по SPEC, конфиг не создаёт новые поля исполнения.

## Проверки
Build → fixture matrix: CLI/ENV/home; old config без OPENROUTER_API_KEY; disabled with absent/invalid key; enabled unknown fields, key literal/missing/empty; model whitelist/default membership; CR/LF; metrics symlink collision; прежний providers-required regression. Ни Keychain, ни real ENV secrets не используются.

## Контракт сдачи
S2 + focused AC PASS/FAIL и diff ownership. Не подключать config к runtime tool до D06; enabled ошибки loader допустимы, но old configs обязаны проходить.
