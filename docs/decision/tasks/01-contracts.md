# D01 — Типы, runtime-схемы и паритет контрактов

**Ответственный:** dev. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [G0](00-approval.md).
**Срок:** 2–3 часа активной работы; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**HOLD до аппрува владельца. Этот лист не выдан.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC §3–7 и канонические input/output JSON Schema. Создать DecisionArgs/DecisionEnvelope и валидаторы форм; schemas available in runtime bundle. Владение: src/decision/schemas.ts и focused tests/schema fixtures. Зависимость — одобренный G0, без обращения к API.

## Контракт / DoD
Сохраняются structured string/object/array, Choice null descriptions и 1–255 options, Noul optional true/false criteria, Score 1–10, все provider/trace/user/session fields, локальные execution/policy и output variants. Unknown contract fields отвергаются, вложенный JSON сохраняется; finite-number semantics можно закрыть в D03. Экспорт S1 заморожен для потребителей. Паритет объявляемых schemas с каноном доказан fixtures для optional fields и границ, не только snapshot собственного генератора.

## Проверки
Build → focused vectors: mixed three types, absent fields, 256/11 rejection, unknown fields, every provider field, unknown provider-options slug. Ключ синтетический. DoD: compile/typecheck, focused PASS, exported types/validator names и список not-yet-semantic checks в отчёте.

## Вне scope
Реальный config/network/policy evaluation/registration/дописывание опций канона. Новая runtime dependency только через tl; использовать существующий SDK/Zod, не менять engines.
