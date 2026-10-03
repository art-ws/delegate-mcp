# Q00 — Независимые векторы и план проверок

**Ответственный:** test. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [D01](01-contracts.md).
**Срок:** 1–2 часа; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**Разрешения и факт выдачи — только в [PROGRESS.md](PROGRESS.md); сам файл не является диспетчем.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Цель / вход
SPEC, канонические schemas, D01 SHA, shared acceptance. Подготовить независимые expected outcomes для всего контракта и именованные oracle/fixtures для Q01; работа может идти параллельно с D02–D07 после GO.

## Scope / результат
План cases + синтетические JSON/HTTP fixtures в test/decision-qa/ или отдельной QA-ветке; expected values выведены из SPEC, не из текущих функций автора. Wire-body matrix на 14 provider fields/146 slugs, primitive boundaries, optional upstream metrics, policy boundaries, lifecycle и secret canaries. Mutations M1–M6 имеют заранее названные RED assertions и команды build/test/restore. Не писать fixes в runtime.

## DoD
Каждая строка acceptance map имеет вход/ожидаемый ответ/оракул; для непокрытого — явный NOT_RUN. Список условий stdio/npm install smoke и rebuild-before-test. Пакет не объявляет инструмент PASS, поскольку реализация ещё не завершена. Ветку/fixtures получает tl; руки напрямую не синхронизируются.

## Контроль
Только подготовка vectors/plan после GO, без real API/key. Где возможно — проверить синтаксис собственных fixtures; это не runtime acceptance. Фактический полнопакетный прогон принадлежит Q01.
