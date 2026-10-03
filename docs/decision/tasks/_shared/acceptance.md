# Матрица приёмки и доказательств

Актуальные результаты и разрешения — в PROGRESS.md; отсутствие evidence означает NOT_RUN. Mock/fixtures локальны и используют синтетические данные. Источник требований — SPEC §10; таблица распределяет их между владельцами, не меняет требования.

| Требование SPEC | Реализация | Независимое доказательство |
|---|---|---|
| §1, §10.1 регистрация и legacy config | D02/D06 | Q01: реальный stdio MCP initialize/tools/list/tools/call; enabled/no block/disabled/startup-fail |
| §3–5, §10.2 все типы, limits/provider metadata | D01/D03 | Q00: независимые vectors; Q01: wire-body fixtures, 14 provider fields, 146 known provider option slugs |
| §6–7, §10.3–4 response/policy | D03 | Q01: wrong ID/option/type/numeric/legend/sum, missing metrics/cost, threshold equality, tie and AND |
| §8, §10.5 network/deadline/cancel/retries | D04 | Q01: local HTTP routes, fake clock для backoff, queued and in-flight cancel, slot release, exact attempt counts |
| §8, §10.6 секреты и отдельные метрики | D02/D05/D06 | Q01: canary key/context in fixture responses and write-error messages; no leak; no delegate session/metric writes |
| §10.8 прежние три инструмента | D02/D06 | Q01: полный прежний suite + stdio query/analyze/resume на mock pool, заголовки/session pinning/metrics |
| §10.9 установочный пакет, Node ≥20 | D07 | Q01: npm pack → install in fresh temp dir → stdio smoke without source/docs, Node 20 + current Node |
| §10.7 реальный API, alias/pinned model | — | Q02, только разрешённый live scope после Q01/G1: limited synthetic POST, actual model/provider/usage and semantic contract |

## Обязательные отрицательные контроли Q01

- M1: отключить применение required_provider; заранее ожидаем RED на wire-body/weakening assertion, без настоящей сети.
- M2: включить неявное ENV activation при absent config; RED legacy-no-config oracle, при этом старые query/analyze остаются GREEN.
- M3: поменять включительность noul boundary или объединить Choice rules OR вместо AND; RED поимённой boundary/AND assertion.
- M4: допустить лишний HTTP retry при max_retries=0 или отменить один deadline queue+retry; RED attempt-count/deadline oracle.
- M5: направить decision в общий reader pool либо записать его metrics/session в старые sinks; RED protocol/sink-isolation oracle.
- M6: вставить canary ключа в safe error/stderr; RED secret-leak assertion, без настоящего секрета.

Если выбранная мутация не собирается или не краснит названное утверждение, результат INVALID и Q01 не PASS до исправления QA-оракула. Каждая мутация восстанавливается; final gate гоняется на чистом candidate SHA.

## Общий пакет Q01

Точный SHA и npm tarball SHA256, команды/rc и версии Node, число assertions/cases, таблица PASS/FAIL/NOT_RUN, все попытки/мутации (ожидал/получил), findings с воспроизведением и список непокрытого. API latency/quality/price не выводить из mock observations. За пределами Q02 no live key/no OpenRouter network.
