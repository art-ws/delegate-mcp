# Q00 — REWORK r1 независимого плана

Владелец: test. P1. Исходный leaf: [Q00](08-independent-test-plan.md). Этот файл — carrier доработки, выдача и статусы только в [PROGRESS.md](PROGRESS.md).

Контекст: [SPEC v0.2](../SPEC.md), [input schema](../input.schema.json), [output schema](../output.schema.json), [_shared/context.md](_shared/context.md), [_shared/interfaces.md](_shared/interfaces.md), [_shared/acceptance.md](_shared/acceptance.md), [baseline](baseline.json).

Source D01: `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`. QA candidate: `d108021b2b4e62f28a4c80394b4022d887fb63bc`, parent — D01. Продолжить review/decision-q00 в /opt/art/p/delegate-mcp-wt/test-decision-q00 от этого QA SHA. Владение — только test/decision-qa/. Не менять runtime, канон, dependencies, дерево задач. Runtime acceptance, мутации, build/test/stdio/package/live остаются вне Q00; допустима проверка синтаксиса и внутренней согласованности собственных fixtures.

## Findings статического review TL

1. **F-Q00-AND:** semantic-vectors.json:23, A-CHOICE-AND-FAIL. confidence=0.8 ≥0.8, selected probability=0.75 ≥0.7, margin=0.75−0.25=0.50 ≥0.20. По SPEC §6 все условия проходят; expected uncertain/below_margin неверен. Такой вектор не убивает OR-мутант M3. Сделать независимый контроль, где ровно один порог не пройден (например, min_margin=0.60 при прежних probabilities), остальные проходят. Записать все значения/неравенства и expected AND=uncertain, OR=accepted. Сохранить прежнюю ошибочную попытку в evidence, не выдавать её за покрытие.
2. **F-Q00-USAGE:** semantic-vectors.json:134–152, R-MINIMAL-OPTIONAL-OMITTED. usage отсутствует и объявлен optional, но DecisionsResponse.required в output.schema.json требует model/answers/usage; обязательны usage.input_tokens/output_tokens. Добавить валидный минимальный response с этими полями и отсутствующим cost/id/provider/confidence/probabilities/legend; отдельный missing-usage negative ожидает UPSTREAM_PROTOCOL. Исправить формулировку HTTP ok-minimal: отсутствуют только действительно optional поля.
3. **F-Q00-FIXTURE:** contract-vectors.json содержит input без state у primitive/boundary cases, без questions у structured case; expected_form_valid помещён внутрь input и является неизвестным контрактным ключом. V-SECRET-CANARIES помещает api_key внутрь args, не содержит questions и не задаёт fixture/config injection. R-WRONG-ID и ряд semantic cases содержат только строку expected без конкретного входа. PLAN не определяет сборку из фрагментов, поэтому actual test adapter и исходы нельзя однозначно восстановить.

## Требуемый результат / DoD

- Каждая positive/negative contract fixture содержит полный DecisionArgs; metadata/expected находятся вне input. Negative повреждает именованную границу при валидных остальных обязательных полях. Если предпочитаешь композицию, определить один явный base и точные patch/replace/remove правила с материализованным примером для каждой семьи; скрытое добавление обязательных полей запрещено.
- Каждый semantic response case задаёт полный prepared-request context (IDs/types/criteria) и полный response либо однозначный base + конкретный mutation recipe. Assessment cases задают question/policy/answer, status/value/reasons, где применимо. Разделить bad policy ID и bad type на конкретные входы. JSON non-finite отрицательный контроль описать как явный способ создания direct-call value, поскольку NaN/Infinity не являются JSON.
- Secret fixture: canary ключа принадлежит синтетическому config/transport error setup, valid args имеют state/questions. Отдельный unknown api_key argument — INVALID_ARGUMENT control, он не заменяет downstream leak oracle. Указать конкретный fixture upstream/sink failure с отражёнными canaries и ожидаемые разрешённые/запрещённые поверхности.
- Сохранить 26 AC map и 14 fields/146 slugs; исправить M3 и связать expected RED с исправленным вектором. Для оставшихся recipe-only cases дать конкретные входы/изменения. Команды Q01 остаются плановыми; actual adapters реализуются в Q01, но теперь без изобретения expected outcomes.
- Сдать отдельным коммитом поверх d108021: exact SHA/parent, owned paths, F1–F3 closure table с конкретными case IDs, команды/rc собственной fixture-проверки, сохранённые попытки, DEFERRED/NOT_RUN. PASS относится только к готовности плана; QA инструмента по-прежнему NOT_RUN.

## Предзадачный шаг и срок

До начала правок test подтверждает WIP=0 и узкий cleanup своих ненужных idle/detached дочерних сессий, сохранив QA worktree/ветку и чужое. Затем TL проверяет idle, выполняет /clear и выдаёт этот carrier одним самодостаточным work-order. Сейчас это подготовленная доработка, не разрешение пропустить clean-slate.

Timebox после отдельной выдачи: 45–60 минут активной работы; первая контрольная точка в пределах timebox. Календарный срок назначает TL при выдаче. Общий checkout — только краткие необходимые git metadata операции под lockctl delegate-mcp/main-checkout, без удержания при ожиданиях. Настоящие keys/configs/API/Keychain, push/merge/release/activation запрещены. Все данные синтетические; секреты/ПДн/внутренние сведения доступа не помещать в evidence.
