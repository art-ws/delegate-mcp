# Q02 — Ограниченный реальный smoke Jev

**Ответственный:** test. **Приоритет:** P1 после GO в очереди этого эпика. **Зависимости:** [G1](10-integration-review.md).
**Срок:** 1–2 часа после Q01/G1 и аппрува, включающего live scope; первая контрольная точка ≤90 минут после выдачи, если timebox короче — сдача в его пределах. Календарный срок назначает tl при диспетче.

**Разрешения и факт выдачи — только в [PROGRESS.md](PROGRESS.md); сам файл не является диспетчем.** Полный clean-slate контекст: [SPEC v0.2](../SPEC.md), [контекст](_shared/context.md), [швы](_shared/interfaces.md), [приёмка](_shared/acceptance.md), [состояние/аппрув](PROGRESS.md), [baseline](baseline.json).

## Gate аппрува
Текущее разрешение и зависимости этого листа фиксируются в PROGRESS.md. Аппрув полного дерева включает предложенный ниже ограниченный smoke на проверенном main SHA; если владелец одобрит только локальную часть, выполнять этот лист нельзя до расширения scope. Наличие OPENROUTER_API_KEY само по себе не снимает HOLD. До разрешения live scope ключ не читается, OpenRouter POST не отправляется.

## Предложенный live-план
Не более **трёх POST без retries**, payload каждого ≤32 KiB, timeout ≤30s. Первый: alias с Choice/Noul/Score и простыми текстовыми критериями. Второй: pinned typesafe/jev-1.13, structured guidance, Choice 255 options + отдельный Choice 1 option, Score 10 + Score 1, Noul without criteria; проверить форму/границы, не бизнес-точность заранее выбранной метки. Третий — только если владелец включил required privacy policy: подтвердить удовлетворение или честный refusal, без retry/downgrade. Если ограничивающие параметры не поддержаны, это finding для tl, не обход маршрутизации.

Реальный ключ приходит только ENV child процесса по приватному launch-указателю tl, в git/stdout/argv/logs/ответы не попадает. Тариф/доступность могут измениться; количество POST ограничено локально, hard monetary cap задаётся владельцем на ключе OpenRouter при необходимости. Smoke не обещает точную верхнюю стоимость по байтам; если условия оплаты не одобрены — NOT_RUN.

## DoD / evidence
На exact main source/installed artifact: actual requested/resolved model, provider, response validation, input/output tokens, cost if present, attempt count and elapsed time; output sanitized. Три primitives и эмпирическая поддержка 255/10/1 boundaries. Допуски response проверены, не расширены ради green. Не объявлять калибровку probabilities/quality, latency SLA или privacy guarantee сверх реально проверенного. PASS/FAIL/NOT_RUN по каждой live-строке. При провайдерском отказе дальнейший план выбирает tl, не сам тестер.
