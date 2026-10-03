# Decision — состояние работ и разрешений

Обновлено: 2026-10-03. Владелец состояния: tl. **Единственный источник текущих статусов.**

## Разрешения

| Разрешение | Состояние | Доказательство |
|---|---|---|
| Подготовка дерева | DONE | Документация подготовлена по запросу владельца |
| GO-IMPLEMENT / старт dev/test | **GO** | operator-web `14115228-44f6-4438-afe9-962178843ab8`, 2026-10-03: «Приступайте к реализации задачи /opt/art/p/delegate-mcp/docs/README.md - команда (tl, dev, test)»; полный scope дерева, включая S1–S7 и park main после Q01 PASS |
| Live scope Q02 | **GO, WAIT_DEPENDENCIES** | Аппрув полного дерева тем же поручением: до трёх синтетических платных POST без retries, только после Q01/G1 и отдельной выдачи Q02 |
| npm release / activation | **NONE — HOLD** | Вне текущего этапа, отдельное поручение |

Разрешение стартовать — прямое поручение владельца выше. Текущий статус эпика: **IN_PROGRESS / D02_COMPONENT_PASS / Q00_REWORK**; runtime QA и live — **NOT_RUN**. Публикация npm, tag/GitHub Release, release workflow и активация MCP не разрешены.

## Листья

| ID | Роль | Статус | Выдан | Candidate / evidence |
|---|---|---|---|---|
| G0 | tl | PASS | 2026-10-03 | GO + 13/13 baseline bytes; dev WIP=0, cleanup `c52f5ee6-197c-487f-a54d-85c706e208dd`; idle и /clear подтверждены |
| D01 | dev | COMPONENT_PASS | 2026-10-03 16:14 MSK; `c8b5c9e1-ae29-43fc-adda-8a7aaf299709` | candidate `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`; author 295/295, component PASS, TL static review разрешает D02/Q00; independent QA NOT_RUN |
| D02 | dev | COMPONENT_PASS | 2026-10-03 17:00 MSK; `25045684-1d29-4e89-a62c-6a61a9113c67` | candidate `b5314e7cf634bff703a9b1fddda33ccd3f6cf7b9`; author 528/528, TL static review разрешает D03; independent QA NOT_RUN |
| D03 | dev | READY | нет | predecessor D02 `b5314e7c`; ожидает cleanup/idle/clear |
| D04 | dev | WAIT_DEPENDENCIES | нет | — |
| D05 | dev | WAIT_DEPENDENCIES | нет | — |
| D06 | dev | WAIT_DEPENDENCIES | нет | — |
| D07 | dev | WAIT_DEPENDENCIES | нет | — |
| Q00 | test | R1_IN_PROGRESS | 2026-10-03 17:03 MSK; `5f3bf707-0058-4600-9144-7f6cbb104c4a` | QA `d108021b2b4e62f28a4c80394b4022d887fb63bc`; TL findings F-Q00-AND/USAGE/FIXTURE, [REWORK r1](08-independent-test-plan.REWORK-r1.md) |
| Q01 | test | WAIT_DEPENDENCIES | нет | — |
| G1 | tl | WAIT_DEPENDENCIES | нет | — |
| Q02 | test | WAIT_DEPENDENCIES | нет | — |
| G2 | tl | WAIT_DEPENDENCIES | нет | — |

## Раскладка ролей

| Роль | Активный исполнительный лист | Очередь после GO |
|---|---|---|
| tl | диспетч D03 / доработка Q00 | review/диспетч → G1 → G2 |
| dev | cleanup перед D03 | D03 → D04 → D05 → D06 → D07 |
| test | Q00 r1 | Q00 r1 → Q01 после D07 → Q02 после G1 |

При G0 MCP list_peers и закрывающие сообщения подтвердили dev/test idle в резерве; чужие задачи не вытесняются. dev подтвердил WIP=0 и cleanup сообщением `c52f5ee6-197c-487f-a54d-85c706e208dd` (служебные дочерние удалены, основная/чужие сохранены, checkout чистый, аренды отсутствуют). Live get_status=idle и /clear перед D01 выполнены, rc=0. Актуальные исполнительные листы — в раскладке выше.

Re-resolve G0: локальный main и live origin/main совпадают — `595dce8f280045d0134e49060282b13c6293c0a0`; baseline `d622cba5644b844344baac5a6f17a84ab43a9a9e` является предком. Все 13 SHA256 baseline совпали; дельта — только docs/README.md и docs/decision/tasks/. SPEC v0.2 и input/output schema не менялись.

## Журнал

- 2026-10-03: создано дерево из 13 clean-slate листьев, baseline и S1–S7, локальная матрица приёмки и ограниченный live-план. Код и конфигурация не изменялись. Подготовлен пакет на аппрув владельцу; до его явного решения HOLD.
- Проверки подготовки документов: 13 узлов DAG без циклов, владельцы 7 dev / 3 test / 3 tl, 126 относительных ссылок, 13 SHA256 baseline, все листы HOLD; secretlint только новых документов и diff whitespace — PASS. Это не runtime QA инструмента; build/test/live — NOT_RUN.

- 2026-10-03: прямое GO владельца `14115228-44f6-4438-afe9-962178843ab8` снимает approval HOLD полного дерева. main/remote и 13 baseline bytes проверены чтением, runtime прогоны TL не выполнялись. Убраны устаревшие копии текущего HOLD из листьев: статусы остаются только здесь.
- G0 PASS: доступность/WIP и clean-slate dev подтверждены; test idle в резерве, Q00 ожидает D01. Первая контрольная точка D01 ≤90 минут после выдачи, timebox 2–3 часа активной работы.
- 2026-10-03 16:14 MSK: D01 выдан dev через MCP `c8b5c9e1-ae29-43fc-adda-8a7aaf299709` (router queued=true), после idle/cleanup/clear. Predecessor G0 `9c268a425fbea852045c05f0ea19b86db37ba929`; worktree назначен /opt/art/p/delegate-mcp-wt/dev-decision, ветка feat/decision-v0.2 (создание подтверждает dev при сдаче). Контроль до 17:45 MSK, целевая сдача до 19:15 MSK; timebox 2–3 часа активной работы. Диспетч/очередь роутера не является component PASS или QA ACCEPT. Q00 выдаётся test после принятого пакета D01.

- D01 получен сообщением dev `7b9ee01f-c145-4340-9f26-80ffc46710b6`: component PASS, source `e4e68eb7d1f3a76752f3eaa03eccc42bf3749ad5`, parent `9c268a425fbea852045c05f0ea19b86db37ba929`, feat/decision-v0.2, /opt/art/p/delegate-mcp-wt/dev-decision; checkout чистый. TL сверил SHA/parent и diff: ровно шесть owned files, только schemas + tests/fixtures; канон, зависимости и legacy не менялись. Прочитан committed evidence `test/decision/fixtures/README.md` и критические JSON/strict-key/provider/safe-validator участки. Дополнительное delegate-чтение — только сжатие для review; его неподтверждённые предположения о nullable отклонены по исходнику и fixture matrix. Runtime прогоны TL не выполнялись.
- Авторские команды build (два entry) → typecheck → focused suite 295/295, lint, focused test typecheck, secretlint, whitespace/commit — rc=0 по committed evidence; Node v26.3.1. D01 component принят как вход следующих листьев, **QA ACCEPT/DONE не заявлен**. Фактический Node20, ordinary server bundle, full legacy/package/live — NOT_RUN, закрываются D06/D07/Q01/Q02.
- S1 закреплён в _shared/interfaces.md; D06 обязан явно опубликовать embedded JSON declarations и включить модуль в обычный bundle. D03 обязан применять semantic relations/очистку неизвестных upstream полей; safe validators сохраняют исходные данные, не нормализуют их.
- Отменён старый контроль D01. dev/test отправлены отдельные cleanup перед D02/Q00 (`eaf201cb-b668-441e-82da-ae215cdbc1b2` / `9591f7b0-614d-4c3c-9814-87e295630a6e`); до WIP=0/idle/clear следующий исполнительный лист не выдаётся.

- 2026-10-03 17:00 MSK: cleanup dev `84fedb41-1d57-4052-9b21-ba5545c19efd`, test `32e9d69e-259b-4db8-aefd-45672d245bf7`; WIP=0, lease=0, сохранены основные/чужие сессии и чистый D01 worktree. get_status=idle и /clear выполнены для каждой руки до нового листа.
- D02 выдан dev `25045684-1d29-4e89-a62c-6a61a9113c67`, router queued=true. Scope только конфиг/S2, predecessor e4e68eb7, контроль до 18:25 MSK, целевая сдача до 20:00 MSK (2–3 часа активной работы).
- Q00 подготовлен к выдаче последним действием этого цикла в ответ на cleanup test: id `5f3bf707-0058-4600-9144-7f6cbb104c4a`, replyTo `32e9d69e-259b-4db8-aefd-45672d245bf7`. Только независимые vectors/plan, без runtime acceptance. Source e4e68eb7; назначены review/decision-q00 и /opt/art/p/delegate-mcp-wt/test-decision-q00 (создание подтверждает test). Контроль до 18:25 MSK, целевая сдача до 19:00 MSK (1–2 часа). Receipt сверяется по истории/пакету test, prepared не является PASS.

- 2026-10-03: Q00 выдача подтверждена фактической сдачей test `bf677b40-a4bf-48ce-9a0c-95c5d42ce53e`, replyTo 5f3bf707. QA d108021, parent e4e68eb7, review/decision-q00, isolated /opt/art/p/delegate-mcp-wt/test-decision-q00, чистый checkout, ровно пять test/decision-qa paths. Заявленная готовность плана не принята TL: статический review обнаружил F-Q00-AND (все три порога проходят при expected uncertain), F-Q00-USAGE (обязательный usage объявлен отсутствующим в valid response), F-Q00-FIXTURE (неполные input/response fragments и metadata внутри args без правил материализации). Carrier: 08-independent-test-plan.REWORK-r1.md. План — REWORK_REQUIRED; runtime/Q01/live — NOT_RUN. Собственные runtime прогоны TL не выполнялись.
- test требуется новый предзадачный cleanup/WIP перед Q00 r1, затем idle/clear и отдельная выдача. D02 продолжается у dev; его активную работу не прерывать, blocker не сообщён. Контроль D02 до 18:25 MSK сохраняется.

- D02 сдан dev `cf93f855-8920-4a23-9465-63b6690b70fb`: component PASS, source b5314e7cf634bff703a9b1fddda33ccd3f6cf7b9, parent e4e68eb7, clean feat/decision-v0.2 / dev-decision. TL сверил identity и пять owned paths, прочитал полный src/decision/config.ts, diff existing loader + D01 dist fixture, committed D02-CONFIG.md и именованные fixture controls. Конкретных blocking defects статическим review не выявлено. D02 принят как вход D03; independent QA ACCEPT/DONE не заявлен.
- По авторскому evidence: build три entry, typecheck, focused D02+legacy-config+D01 528/528 (212+21+295), lint, focused test typecheck, secretlint/whitespace rc=0. Сохранены first focused rc=1 (D01 dist fixture копировал один файл при shared tsup chunks) и secretlint rc=1 (synthetic BasicAuth literal); final rc=0. Изменение D01 fixture сохраняет complete dist layout и прежние behavioral assertions; Q01 проверяет установочный пакет отдельно.
- S2 экспорты закреплены в _shared/interfaces.md. Ready config с ключом — только память; D03/D06 не сериализуют config и не передают ключ в body/envelope/logs. AppConfig.decision optional только для программных конструкторов, loader всегда возвращает DecisionSetup. Применение mandatory provider rules к request — D03, MCP inventory — D06, actual Node20/full legacy/package/live — NOT_RUN.
- dev перед D03 требуется новый cleanup/WIP → live idle → /clear → отдельная выдача 03-decision-core.md. D03 predecessor b5314e7c; один активный лист. Q00 r1 ожидает clean-slate test, не является зависимостью D03. Старый контроль D02/Q00 читает это актуальное состояние, не требует повторного D02 прогона.

- test cleanup `412e2618-db8d-4f37-a26f-7b4b5bcef94c` подтвердил WIP=0/clean QA d108021/lease=0, дочерних сессий нет. Live get_status=idle и /clear выполнены перед Q00 r1. Финальная выдача текущего цикла: id e97427a6-55a1-4717-8213-df29f6e5483a / replyTo 412e2618; carrier 08-independent-test-plan.REWORK-r1.md; timebox 45–60 минут, сдача/контроль до 18:15 MSK. Receipt и новый SHA подтверждает ответ test; до него r1 не PASS.
- Ответ dev по D02 `cf93f855-8920-4a23-9465-63b6690b70fb` подготовлен (component как вход D03, 528/528 author, независимая QA NOT_RUN, требуется cleanup/WIP). Доставить отдельным финальным send(to=dev, replyTo=cf93f855...) в ближайшем следующем цикле: текущий терминальный ответ принадлежит cleanup test 412e2618. Ни один peer reply не дублировать, inbox не менять. До cleanup/clear dev не начинает D03.

- 2026-10-03 17:24 MSK: статус освежён по живым history/screen. Ответ по D02 доставлен `fed9ba75-1bea-4e45-a78f-ed30231faa66`, replyTo cf93f855; dev выполняет назначенный предзадачный cleanup перед D03. Q00 r1 work-order `e97427a6-55a1-4717-8213-df29f6e5483a` доставлен, test работает над исправлением fixtures, контроль до 18:15 MSK. D03 ещё не выдан/не начат, QA verdict r1 ожидается. Дублирования D02 ответа нет.
