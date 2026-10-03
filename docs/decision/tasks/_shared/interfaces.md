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

## S1 — закреплённые экспорты D01

Источник: `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`, `src/decision/schemas.ts`; evidence — `test/decision/fixtures/README.md`. TL принимает component как вход зависимых листьев; независимая QA — Q01, текущие статусы в PROGRESS.md.

- Основные типы: DecisionArgs, DecisionEnvelope, DecisionsRequest, DecisionsResponse, DecisionQuestion, DecisionAnswer, DecisionPolicy, DecisionExecution, DecisionTrace, DecisionAssessment, DecisionMeta, DecisionError, DecisionErrorCode, ProviderPreferences, ProviderOptionSlug, DecisionValidation<T>, JsonValue, JsonObject, StructuredValue.
- Безопасные границы: validateDecisionArgs / validateDecisionEnvelope / validateDecisionsResponse принимают unknown и возвращают `{success:true,data:T}` либо `{success:false,error:{code,message}}`; INVALID_ARGUMENT для входа, UPSTREAM_PROTOCOL для ответа. Ошибки фиксированные, raw Zod issues наружу не идут. Успех сохраняет исходный объект; потребители считают его immutable.
- JSON declarations: decisionInputJsonSchema / decisionOutputJsonSchema, providerOptionSlugs. **D06 использует JSON declarations явно в tools/list**, не предполагает lossless automatic conversion custom/preprocess Zod; включение модуля в обычный server bundle принадлежит D06.
- Экспортированы form schemas: decisionArgsSchema, decisionEnvelopeSchema, decisionsRequestSchema, decisionsResponseSchema, decisionQuestionSchema, decisionAnswerSchema, decisionPolicySchema, decisionExecutionSchema, decisionAssessmentSchema, decisionMetaSchema, decisionErrorSchema, providerPreferencesSchema.
- D01 уже проверяет finite JSON numbers. D03 закрывает matching policy IDs/types, noul interval, assessment/AND/tie/equality, exact response IDs/types/options, numeric ranges, probability keys/sums/maximum, Score expectation/legend, nonnegative usage/cost и удаление unknown upstream fields. D01 form-validator допускает upstream additional JSON fields согласно канону и не заменяет эти semantic checks. D06 закрывает operational consistency/dry-run attempts=0.
