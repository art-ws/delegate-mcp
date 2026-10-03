# Q00 — узкий REWORK r3

Владелец test, P1; статусы/выдача только [PROGRESS.md](PROGRESS.md). Исходный [Q00](08-independent-test-plan.md), предыдущий [r2 carrier](08-independent-test-plan.REWORK-r2.md). Канон: [SPEC §6/8](../SPEC.md), [input](../input.schema.json), [output](../output.schema.json), [_shared/interfaces S2/S4](_shared/interfaces.md), [context](_shared/context.md), [acceptance](_shared/acceptance.md), [baseline](baseline.json).

Продолжить только после отдельной выдачи от QA `0de2036ccb1664fe43052dd93908342f595e7b6c`, parent `93e54d9db217150bd51e20ccc64a8d512c0c084a`, review/decision-q00, /opt/art/p/delegate-mcp-wt/test-decision-q00. Только test/decision-qa/; отдельный commit, все предыдущие попытки сохранить.

## Принятые исправления r2

Identity/clean/four owned paths подтверждены TL. Response family теперь имеет согласованный yes/no baseline; valid minimal и unknown-extras cases корректны, negatives изолированы, usage input/output/cost разделены. Policy-ID использует form-valid rule под отсутствующим внешним ID и отдельный положительный контроль. Key/context surfaces в основной декларации разделены, transport/sink failures выделены отдельно. Эти части не переделывать.

## Остаток

1. **F-Q00-R3-SETUP**, contract-vectors.json:1474, PLAN M6. Resolver предлагает `loadDecisionSetup(raw, {env: env_mapping})`, где raw содержит providers и decision. Закреплённый S2 принимает только decision-блок и обязательные opts `{env,home,legacyMetricsFile}`; runtime guard отвергает providers/decision как неизвестные поля. S2 не резолвит legacy provider key. Такой рецепт до transport не доходит.

   Задать точные данные и шаги: `loadDecisionSetup(fixture_setup.config.decision, {env: fixture_setup.env_mapping, home: <synthetic absolute home>, legacyMetricsFile: <synthetic absolute legacy sink>})`, затем проверить `status===ready` и передать setup.config в harness. Метаданные synthetic home/legacy sink определить в fixture; decision.metrics_file отсутствует, настоящие файлы/ENV не читать. Legacy providers[] — отдельная synthetic startup/spy fixture; не утверждать, что S2 loader резолвит её reference. Исправить PLAN/M6/resolver согласованно. Допустим другой точный ready-config factory по S2, если он полностью описан, но не нужен новый public API.

   В oracle также осталось «scan every forbidden surface for both exact canaries», хотя request body запрещён только для key и разрешён для context. Записать per-canary проверки без двусмысленного общего сканирования: key отсутствует в request body/публичных outputs/sinks, context присутствует в state body и штатном dry_run request, оба отсутствуют в отражённых safe errors/штатных logs/stderr; legacy transport/sinks имеют zero calls. Разрешённые Authorization/harness memory не сканировать как утечку. В PLAN и fixture не должно быть противоположных указаний.

   Для event_sink recipe задать конкретный успешный response, совпадающий с canary args (вопрос q типа noul), например `{model:"typesafe/jev-1.13",answers:{q:{type:"noul",noul:0.9}},usage:{input_tokens:1,output_tokens:0}}`. Transport failure ожидает NETWORK_ERROR/isError=true; successful transport + sink write failure сохраняет decision/isError=false, safe warning в stderr, без утечки. В обеих фазах отдельный actual transport capture проверяет один POST и Bearer canary только в Authorization; не засчитывать zero-transport как leak proof. Это plan-only будущих Q01 adapters, не разрешение runtime прогона.

2. **F-Q00-R3-NOUL-REASON**, semantic-vectors.json A-NOUL-BETWEEN. Expected содержит uncertain/null/reasons=[], тогда как опубликованный S4 закрепляет Noul middle reason ambiguous_probability (SPEC §6 допускает этот стабильный код). Для полного assessment equality использовать reasons=["ambiguous_probability"]. Границы .2/.8, значение .5, status/value не менять; источник reason — закреплённый интерфейс, не чтение текущей авторской функции.

## Сдача

Обновить static consistency checker так, чтобы эти конкретные расхождения обнаруживались: точный S2 input/options, per-canary surfaces без запрета штатной передачи context, Noul middle reason. Выполнить только собственные fixture checks/whitespace, сохранить commands/rc; не запускать runtime/build/test приложения. Сохранить 26 AC, 14 provider fields/146 slugs, M1–M6, 18 response cases, исправленный AND и исторические попытки. Сдать полный SHA/parent, owned diff, clean worktree, closure обоих findings, attempts и NOT_RUN.

Перед новым раундом: WIP=0/узкий cleanup → live idle/clear TL → отдельный work-order. Timebox 15–25 активных минут; календарный срок TL назначает при выдаче. Настоящие configs/keys/Keychain/ENV/API, runtime fixes, dependency/canon/tasks changes, push/merge/release/activation запрещены. Shared git metadata — краткий lockctl, не удерживать lease при ожиданиях. Q01 и live NOT_RUN; dev D04 продолжается независимо.
