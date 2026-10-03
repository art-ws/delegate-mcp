# Decision — состояние работ и разрешений

Обновлено: 2026-10-03. Владелец состояния: tl. **Единственный источник текущих статусов.**

## Разрешения

| Разрешение | Состояние | Доказательство |
|---|---|---|
| Подготовка дерева | DONE | Документация подготовлена по запросу владельца |
| GO-IMPLEMENT / старт dev/test | **GO** | operator-web `14115228-44f6-4438-afe9-962178843ab8`, 2026-10-03: «Приступайте к реализации задачи /opt/art/p/delegate-mcp/docs/README.md - команда (tl, dev, test)»; полный scope дерева, включая S1–S7 и park main после Q01 PASS |
| Live scope Q02 | **GO, WAIT_DEPENDENCIES** | Аппрув полного дерева тем же поручением: до трёх синтетических платных POST без retries, только после Q01/G1 и отдельной выдачи Q02 |
| npm release / activation | **NONE — HOLD** | Вне текущего этапа, отдельное поручение |

Разрешение стартовать — прямое поручение владельца выше. Текущий статус эпика: **GO / READY_D01**; runtime QA и live — **NOT_RUN**. Публикация npm, tag/GitHub Release, release workflow и активация MCP не разрешены.

## Листья

| ID | Роль | Статус | Выдан | Candidate / evidence |
|---|---|---|---|---|
| G0 | tl | PASS | 2026-10-03 | GO + 13/13 baseline bytes; dev WIP=0, cleanup `c52f5ee6-197c-487f-a54d-85c706e208dd`; idle и /clear подтверждены |
| D01 | dev | READY | нет | predecessor main `595dce8f280045d0134e49060282b13c6293c0a0` |
| D02 | dev | WAIT_DEPENDENCIES | нет | — |
| D03 | dev | WAIT_DEPENDENCIES | нет | — |
| D04 | dev | WAIT_DEPENDENCIES | нет | — |
| D05 | dev | WAIT_DEPENDENCIES | нет | — |
| D06 | dev | WAIT_DEPENDENCIES | нет | — |
| D07 | dev | WAIT_DEPENDENCIES | нет | — |
| Q00 | test | WAIT_DEPENDENCIES | нет | — |
| Q01 | test | WAIT_DEPENDENCIES | нет | — |
| G1 | tl | WAIT_DEPENDENCIES | нет | — |
| Q02 | test | WAIT_DEPENDENCIES | нет | — |
| G2 | tl | WAIT_DEPENDENCIES | нет | — |

## Раскладка ролей

| Роль | Активный исполнительный лист | Очередь после GO |
|---|---|---|
| tl | диспетч D01 | review/диспетч → G1 → G2 |
| dev | нет; clean-slate готов | D01 → D02 → D03 → D04 → D05 → D06 → D07 |
| test | нет | Q00 после D01 → Q01 после D07 → Q02 после G1 |

MCP list_peers и последние закрывающие сообщения подтверждают dev/test idle в резерве; чужие задачи не вытесняются. dev подтвердил WIP=0 и cleanup сообщением `c52f5ee6-197c-487f-a54d-85c706e208dd` (служебные дочерние удалены, основная/чужие сохранены, checkout чистый, аренды отсутствуют). Live get_status=idle и /clear перед D01 выполнены, rc=0. test получает Q00 после D01, до того исполнительного листа нет.

Re-resolve G0: локальный main и live origin/main совпадают — `595dce8f280045d0134e49060282b13c6293c0a0`; baseline `d622cba5644b844344baac5a6f17a84ab43a9a9e` является предком. Все 13 SHA256 baseline совпали; дельта — только docs/README.md и docs/decision/tasks/. SPEC v0.2 и input/output schema не менялись.

## Журнал

- 2026-10-03: создано дерево из 13 clean-slate листьев, baseline и S1–S7, локальная матрица приёмки и ограниченный live-план. Код и конфигурация не изменялись. Подготовлен пакет на аппрув владельцу; до его явного решения HOLD.
- Проверки подготовки документов: 13 узлов DAG без циклов, владельцы 7 dev / 3 test / 3 tl, 126 относительных ссылок, 13 SHA256 baseline, все листы HOLD; secretlint только новых документов и diff whitespace — PASS. Это не runtime QA инструмента; build/test/live — NOT_RUN.

- 2026-10-03: прямое GO владельца `14115228-44f6-4438-afe9-962178843ab8` снимает approval HOLD полного дерева. main/remote и 13 baseline bytes проверены чтением, runtime прогоны TL не выполнялись. Убраны устаревшие копии текущего HOLD из листьев: статусы остаются только здесь.
- G0 PASS: доступность/WIP и clean-slate dev подтверждены; test idle в резерве, Q00 ожидает D01. Первая контрольная точка D01 ≤90 минут после выдачи, timebox 2–3 часа активной работы.
