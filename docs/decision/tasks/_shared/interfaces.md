# Контракты между листами

Аппрув S1–S7 принимается вместе с деревом и фиксируется в PROGRESS.md; этот файл не является диспетчем. Внешние типы/поведение определяются SPEC и JSON Schema; подписи ниже фиксируют ответственность модулей, не добавляют публичных опций. Изменение шва — через tl до выдачи зависимого листа.

| Шов | Производитель → потребитель | Контракт |
|---|---|---|
| S1 Аргументы/результат | D01 → D02/D03/D04/D05/D06/Q00 | DecisionArgs/DecisionEnvelope соответствуют каноническим JSON Schema; отдельно проверяется JSON-only, unknown fields и semantic relations. Ошибки несут безопасный code/message, без исходных значений. Runtime-схемы tool доступны в dist. |
| S2 Конфигурация | D02 → D03/D04/D05/D06 | DecisionSetup = not-configured / disabled / ready(config). Отсутствующий блок — not-configured, false enabled — disabled без ENV resolution; ready включает разрешённые модели/defaults/required_provider/лимиты/ключ, только в памяти. Некорректный enabled block вызывает существующий ConfigError на старте. |
| S3 Сборка запроса | D03 → D06 | prepareDecision(args, readyConfig) даёт ровно DecisionsRequest body + effectiveExecution + local policy + warnings. Model/defaults/provider mandatory rules применены, execution/policy исключены из body; checked UTF-8 bytes. Никакого IO. |
| S4 Проверка ответа | D03 → D06 | validateResponse(body, preparedRequest) возвращает документированный result либо безопасный UPSTREAM_PROTOCOL. assess(result, localPolicy) — accepted/uncertain/unassessed по каждой question ID, без IO и округления. |
| S5 Транспорт | D04 → D06 | request(body, config, execution, signal) возвращает decoded JSON + attempts + timing/billing state либо classified error; не принимает бизнес-решение и не обходит mandatory provider rules. Один deadline охватывает queue/backoff/HTTP/body. AbortSignal, monotonic clock, sleep/random и fetch injectable. |
| S6 Наблюдаемость | D05 → D06 | recordDecision(envelope, configuredSink) — редактированные stderr/optional separate JSONL, best effort без падения tool. Не получает сырые args/ключи/response text. |
| S7 MCP | D06 → D07/Q01 | registerDecisionTool(server, context) в existing server. Legacy/no block: list=4 и CONFIG_ERROR; disabled: list=3; enabled: list=4. Dry-run вызывает S3 и 0 network calls; success/error одновременно structuredContent и один JSON TextContent, соответствующие output schema. |

Config timeout_ms/max_retries задают defaults; явные execution overrides валидируются по SPEC bounds и применяются последовательно. Не превращать defaults в новый запрет всех повторов и не добавлять незаявленные hard-cap опции. CLI path cascade и старый ProviderPool API не меняются.

Сохраняются optional upstream fields; missing confidence/probabilities/cost не подменяются нулями. Для absent config вызов decision, включая dry-run, возвращает CONFIG_ERROR, поскольку интеграция не настроена. Для configured dry-run attempts=0; ключ не выходит из config и не входит в Request/Envelope.
