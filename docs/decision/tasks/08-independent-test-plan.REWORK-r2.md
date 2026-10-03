# Q00 — REWORK r2 независимого плана

Владелец: test, P1. Лист [Q00](08-independent-test-plan.md), предыдущий [carrier r1](08-independent-test-plan.REWORK-r1.md). Выдача и текущие статусы — только в [PROGRESS.md](PROGRESS.md). Этот carrier сам по себе не разрешает начало правок.

Канон: [SPEC v0.2](../SPEC.md), [input schema](../input.schema.json), [output schema](../output.schema.json), [_shared/context.md](_shared/context.md), [_shared/interfaces.md](_shared/interfaces.md), [_shared/acceptance.md](_shared/acceptance.md), [baseline](baseline.json).

Продолжить после отдельной выдачи от QA `93e54d9db217150bd51e20ccc64a8d512c0c084a`, parent `d108021b2b4e62f28a4c80394b4022d887fb63bc`, source D01 `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`. Ветка review/decision-q00, worktree /opt/art/p/delegate-mcp-wt/test-decision-q00. Владение только test/decision-qa/. Старые попытки сохранить отдельными коммитами и в evidence; runtime, канон, dependencies и задачи не менять.

## Результат review r1

TL подтвердил точные SHA/parent/ветку, чистый worktree и три owned paths. AND исправлен: .8 >= .8, .75 >= .7, margin .75−.25=.50 < .60; только margin провален, OR принял бы ответ. Required usage добавлен. Полные contract inputs и metadata вне args исправлены. Но план ещё REWORK: два expected-valid response не соответствуют своим вопросам, семантические negatives загрязнены той же ошибкой; bad-ID case проверяет другую границу; canary oracle запрещает штатную передачу context.

## Findings и конкретные исправления

1. **F-Q00-R2-RESPONSE**, semantic-vectors.json:615 и далее. Во всех 14 JSON response cases prepared_request.questions.q-choice.criteria имеет ключи a/b, а response.choice и probabilities используют yes/no (или maybe). Поэтому R-MINIMAL-OPTIONAL-OMITTED и R-UNKNOWN-UPSTREAM-KEY обязаны получить UPSTREAM_PROTOCOL по SPEC §7.3 вместо expected valid. Остальные negatives могут отвергаться из-за чужой ошибки раньше своей именованной границы.

   Выбрать одну согласованную пару ключей для всей response семьи и привести request, answer, probabilities, expected values и mutation recipes к ней. Полный baseline обязан быть семантически валиден: совпадающие IDs/types/options; конечные диапазоны; sums/score expectation/legend; required nonnegative integer usage. От него получить valid minimal (опциональные metrics/cost отсутствуют) и valid unknown-fields case. Каждый negative должен повреждать только свою именованную границу, все остальные поля baseline остаются валидны. Missing usage не должен одновременно иметь unknown choice. R-USAGE сейчас меняет input_tokens и cost одновременно: разделить на независимые отрицательные controls; при необходимости добавить output_tokens control. Для каждого negative явно указать исходный valid baseline, изменённый JSON path и неизменённые условия. HTML/non-finite recipes сохранить. Не перенормировать probabilities и не расширять допуски.

2. **F-Q00-R2-POLICY-ID**, semantic-vectors.json:417. Фактически prepared_args.policy = {"q-choice":{"absent-question":{"type":"choice","min_probability":0.5}}}. Это malformed rule без собственного type; не контроль ссылки на неизвестный question ID, описанный в PLAN.

   Требуемая форма: prepared_args.policy = {"absent-question":{"type":"choice","min_probability":0.5}}, при questions, содержащем только q-choice. Само правило form-valid, только внешний policy key отсутствует в questions. Ожидание INVALID_ARGUMENT относится к prepare/semantic ID validation до assessment. Указать этап явно; assessment_input не должен выдавать целую policy map за отдельное правило. A-POLICY-BAD-TYPE оставить отдельным form-valid правилом с существующим q-choice ID и несовпадающим type. Позитивный тот же Choice rule под существующим ID нужен для изоляции проверки ссылки.

3. **F-Q00-R2-CANARY**, contract-vectors.json:1397–1455, PLAN M6. Args содержат context canary в state.value, но oracle запрещает обе canary строки в DecisionRequest body. По SPEC §3/8 state должен попасть в body: корректная реализация обязательно нарушит такой oracle. Raw config.decision.api_key с literal canary также невалиден по §8; путь до transport не определён.

   Задать отдельные разрешённые/запрещённые поверхности для key и context. Key допускается только в Authorization изолированного in-memory transport capture и resolved config памяти harness; запрещён в body, публичных результатах/errors/stdout/stderr/logs/sinks. Context должен сохраняться в state body; для dry_run допускается в request внутри штатного MCP JSON-RPC envelope. Отражённый context не допускается в safe errors/штатных logs/stderr; legacy sessions/metrics не вызываются. Scan не должен объявлять утечкой предусмотренную передачу входа. Обновить противоречащие формулировки PLAN/M6 и expected.

   Setup должен однозначно доходить до transport: либо synthetic raw decision config с api_key="env:Q00_SYNTHETIC_KEY" и явным injected env mapping, без настоящего ENV/файлов; либо полный ready DecisionConfig с указанием способа построения по S2, явно отделённый от raw AppConfig. Literal key в raw loader fixture не использовать. Для startup scenario добавить valid legacy providers setup; mandatory providers не отменять. Разделить transport failure и event-sink write failure на конкретные recipes с ожидаемым исходом каждой фазы и сканируемыми поверхностями. Unknown api_key arg остаётся отдельным INVALID_ARGUMENT/zero-transport control, не leak oracle.

## DoD и проверки плана

- Сохранить 26 AC map, 14 provider fields/146 slugs и M1–M6, исправленный AND и исторические попытки. При добавлении изолированных cases количество vectors может увеличиться.
- Статически проверить внутреннюю согласованность всех positive responses с их request и каждого negative с его именованной границей. Проверка только JSON parse/required fields недостаточна. Зафиксировать команды и результаты собственных fixture consistency checks; actual production validators не являются источником expected outcomes.
- Сдать отдельный commit поверх 93e54d9: полный SHA/parent, clean branch/worktree, owned paths, closure трёх findings с case IDs, commands/rc и сохранённые failed attempts. PASS только о готовности плана, QA ACCEPT инструмента не заявлять.
- Runtime приложения, build/test/stdio/package/Node matrix/мутации/live — NOT_RUN до Q01/Q02. API/настоящие keys/Keychain/configs, push/merge/release/activation запрещены. Общие git metadata — краткая аренда lockctl delegate-mcp/main-checkout, не держать её при ожиданиях.

До выдачи r2: предзадачный WIP=0 и узкий cleanup только собственных ненужных idle/detached дочерних сессий с сохранением worktree/основных/чужих; затем TL live idle и /clear. Timebox r2 30–45 минут активной работы; календарный срок назначается при отдельном диспетче. Dev D03 идёт независимо, test его не ждёт.
