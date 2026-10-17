<timestamp>Friday, Oct 9, 2026, 8:51 AM (UTC+3)</timestamp>
<system_notification>
The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.

<task>
kind: subagent
status: success
task_id: 5493b3ac-a1bb-45b2-8c96-35536b9cc437
title: Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Тольк
tool_call_id: call_91f3e45bc08f4a2fb95e5dac978cb6ec
agent_id: 5493b3ac-a1bb-45b2-8c96-35536b9cc437
detail: <user_visible_high_level_summary>
Полностью прослежен старый и текущий Python request flow Steam sales history: точки входа, paging, блокировки, интервалы и обработка HTTP 429. Старый quarantine-flow фактически отключён; его 429-защита локальна и существенно слабее текущей.
</user_visible_high_level_summary>
<response>
Исследование выполнено строго в режиме чтения: ничего не запускалось, не собиралось, не тестировалось и не изменялось.

## Краткий вывод

В репозитории существуют три поколения Steam sales history:

1. **Самый старый legacy-flow** 
 `__quarantine/modules/myhist.py` → `libs/steam_req/myhistory.py`. 
 Сейчас принудительно отключён через `exit(...)`. Специальной общей или per-account защиты от 429 нет: HTTP 429 превращается в обычную ошибку, затем выполняется retry через 14 секунд, максимум три неуспешных ответа такого типа.

2. **Промежуточный старый sync** 
 `modules/sales_history_sync.py` → `libs/steam_req/listings.py`. 
 Каждому HTTP-запросу предшествует sleep 1 секунда; при 429 выполняется sleep 4 секунды и повторяется та же страница. Но попытка потребляет итерацию `max_pages`, поэтому это не полноценный бесконечный retry. Общих/per-account блокировок нет.

3. **Текущий NG-flow** 
 `aSalesHistorySync.py` / `cSalesHistoryBootstrap.py` → `src/superbot_ng/...`. 
 Page size 500; после каждого начатого запроса cooldown 8 секунд; запросы сериализуются по proxy-host; 429 немедленно откладывает конкретный аккаунт на случайные 2400–4800 секунд с сохранением resume checkpoint. Глобальной блокировки всех аккаунтов при 429 нет.

---

## 1. Точки входа и NG request flow

### Runtime daemon

Абсолютный путь:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aSalesHistorySync.py`

- `aSalesHistorySync.py:20-23`: инициализация и singleton-lock:
 - `init_sentry()`
 - `with FileLock("sales_history")`
 - `asyncio.run(run_daemon())`

Этот файловый lock глобально запрещает одновременный запуск daemon/bootstrap с тем же именем lock.

### Bootstrap/backfill

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/cSalesHistoryBootstrap.py`

- `cSalesHistoryBootstrap.py:30-36`: `run_bootstrap(force=...)` под тем же `FileLock("sales_history")`.

### Связный путь запроса

Runtime:

`aSalesHistorySync.py:20-23` 
→ `superbot_ng.entrypoints.sales_history.run_daemon` 
→ `workers/sales_history/daemon_coordinator.py:28-52` 
→ `daemon_coordinator_loop.py:16-48` 
→ account runner 
→ `use_cases/sales_history/sync_raw.py:23-53` 
→ `_sync_market_history_pages`, `sync_raw.py:99-129` 
→ `sync_market_history_page` 
→ `_fetch_market_history_page`, `sync_page.py:72-101` 
→ `AsyncSteamHistoryClient.fetch_myhistory_render`, `clients/steam/sales_history/retry.py:24-44` 
→ `_fetch_myhistory_attempt_with_transient_retry`, `retry.py:66-86` 
→ `_fetch_myhistory_attempt`, `fetch.py:20-31` 
→ `_request_myhistory_render`, `fetch.py:33-50` 
→ `http.get_text("/market/myhistory/render/", params=...)`, `fetch.py:41-45`.

Фактические параметры запроса определены в:

`src/superbot_ng/clients/steam/sales_history/fetch.py:110-117`

```python
return {
 "query": "",
 "start": int(start),
 "count": clamp_history_count(count),
 "norender": 1,
 "l": "english",
}
```

---

## 2. Paging и частота NG-циклов

`src/superbot_ng/use_cases/sales_history/constants.py:5-8`:

- `HISTORY_PAGE_SIZE = 500`
- `HISTORY_MAX_PAGES = 200000`
- `RUNTIME_RETRY_SECONDS = 30`

`src/superbot_ng/use_cases/sales_history/sync_raw.py:112-129`:

- цикл начинается с сохранённых `page_index/start`;
- после успешной страницы `start += HISTORY_PAGE_SIZE`;
- максимум 200 000 страниц;
- stop event проверяется перед каждой страницей.

То есть нормальная последовательность offset:

`0, 500, 1000, 1500, ...`

Page size дополнительно clamp-ится в диапазон 1..500:

`src/superbot_ng/clients/steam/sales_history/parser_ids.py:3-7`.

### Частота запросов

`src/superbot_ng/clients/steam/sales_history/constants.py:5`:

- `HISTORY_REQUEST_COOLDOWN_SECONDS = 8.0`

`src/superbot_ng/clients/steam/sales_history/fetch.py:40-50`:

```python
async with self.lock_registry.hold(self.session.proxy, stop_event=stop_event):
 request_started = True
 return await self.http.get_text(...)
finally:
 if request_started and await self._sleep_or_stop(
 HISTORY_REQUEST_COOLDOWN_SECONDS, stop_event
 ):
 raise ExpectedShutdown()
```

Существенная деталь: **8 секунд ждут после каждого начатого запроса**, включая 200, 429, 5xx и сетевое исключение. Sleep происходит в `finally`.

Однако lock освобождается до cooldown: `async with hold(...)` заканчивается перед входом в `finally`. Поэтому 8 секунд — per-task/account post-request delay, а не удержание общего proxy-lock на весь cooldown.

### Частота полного runtime sync

`src/superbot_ng/platform/settings/runtime.py:8-12`:

- успешный повтор аккаунта: `SALES_HISTORY_SYNC_INTERVAL_SEC = 900` — 15 минут;
- account concurrency: 12;
- raw concurrency: 12;
- marking concurrency: 4.

Интервал записывается после успешного завершения marking:

`src/superbot_ng/use_cases/sales_history/sync_marking.py:111-116`.

Это не fixed-rate цикл от старта: следующий `next_sync_at` назначается после успешного результата.

---

## 3. Общие и per-account блокировки

### Глобальная process-level блокировка

`aSalesHistorySync.py:21-23` и `cSalesHistoryBootstrap.py:34-36` используют один:

```python
FileLock("sales_history")
```

Daemon и bootstrap не должны работать одновременно.

### Общая блокировка по proxy-host

`src/superbot_ng/platform/proxy_lock/registry.py:14-18`:

- ключ proxy — часть `proxy.address` до `:` и затем до первой точки;
- без proxy ключ становится `"NoProxy"`.

`registry.py:35-58`:

- для реального proxy применяется `asyncio.Lock`;
- запросы разных аккаунтов, имеющих одинаковый вычисленный proxy-key, сериализуются;
- для `"NoProxy"` lock **не применяется** (`registry.py:43-46`).

Следовательно, это **не глобальная Steam-блокировка** и не строго per-account lock. Это in-process mutex по сокращённому proxy host.

### Per-account 429 block/defer

HTTP 429 приводит к deferred item именно данного login с сохранением `start` и `page_index`:

`src/superbot_ng/workers/sales_history/daemon_raw_errors.py:27-48`.

Checkpoint содержит абсолютный дедлайн:

- `retry_at_unix = time.time() + exc.retry_after_seconds`, строки 32-37.

После рестарта остаток задержки восстанавливается:

`src/superbot_ng/workers/sales_history/daemon_coordinator_state.py:87-104`.

Восстановленное значение ограничивается сверху 4800 сек и снизу нулём:

```python
remaining = min(
 max(loaded.retry_at_unix - now_unix, 0.0),
 float(STEAM_HISTORY_RATE_LIMIT_RETRY_MAX_SECONDS),
)
```

**Вывод:** 429 не ставит на паузу весь daemon и не помечает proxy глобально rate-limited. Он откладывает конкретную account work item. Другие аккаунты продолжают работу, ограниченные concurrency и кратковременным proxy-lock.

---

## 4. NG cooldown/retry после HTTP 429

`src/superbot_ng/clients/steam/sales_history/errors.py:7-10`:

- обычная response error: 3600 сек;
- 429: случайно 2400–4800 сек, то есть 40–80 минут;
- exhausted transient network error: 60 сек.

`src/superbot_ng/clients/steam/sales_history/retry.py:41-63`:

```python
if page_or_attempt.status_code == 429:
 await self._raise_after_rate_limit(page_or_attempt)
...
retry_after_seconds = random.randint(
 STEAM_HISTORY_RATE_LIMIT_RETRY_MIN_SECONDS,
 STEAM_HISTORY_RATE_LIMIT_RETRY_MAX_SECONDS,
)
```

Важные свойства:

- 429 определяется непосредственно по `status_code`;
- response body и headers сохраняются как artifact;
- `Retry-After` читается и логируется, но **не управляет cooldown**;
- фактическая задержка всегда выбирается случайно из 2400–4800;
- retry происходит с того же `start/page_index`, а не с начала истории;
- 429 немедленно выбрасывает defer и не расходует 5 обычных response attempts.

На сам HTTP-запрос также приходится обязательный post-request cooldown 8 сек до выброса defer, потому что `_request_myhistory_render` ждёт в `finally`.

### Прочие retries

`clients/steam/sales_history/constants.py:8-11`:

- response max attempts: 5;
- transient network max attempts: 6;
- transient интервалы: 0.1, 0.2, 0.3, 0.4, 0.5 сек.

С учётом обязательного cooldown каждый transient attempt также несёт 8 секунд post-request ожидания; короткие 0.1–0.5 добавляются после него.

Для не-429 HTTP 500/502/503/504 клиент делает до 5 последовательных response attempts, каждый минимум разделён 8-секундным post-request cooldown. После исчерпания — defer 3600 сек через `SteamHistoryResponseError`.

---

## 5. Промежуточный старый sync

Основной файл:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/modules/sales_history_sync.py`

### Paging

`modules/sales_history_sync.py:11-12`:

- `HISTORY_PAGE_BATCH_LIMIT = 500`
- `HISTORY_429_BACKOFF_SECONDS = 4`

`modules/sales_history_sync.py:191-205`:

- defaults: `count=500`, `max_pages=20`;
- count clamp: 1..500.

`modules/sales_history_sync.py:222-238`:

```python
page = fetch_myhistory_render(user.login, start=start, count=count)
if not page.get("success"):
 ...
 if "429" in str(page.get("error") or ""):
 time.sleep(4)
 continue
```

`start += count` находится только после успешно обработанной страницы, `modules/sales_history_sync.py:331`. Поэтому после 429 повторяется тот же offset.

Но `continue` относится к `for page_i in range(max_pages)`: каждая 429 consumes одну из 20 итераций. Если все 20 вызовов получают 429, цикл завершится с `stop_reason="max_pages"` и `incomplete_history_pass`, строки 332-352.

### Таймер до HTTP-запроса

`libs/steam_req/listings.py:347-364`:

```python
time.sleep(1)
count = ... max_value=500
...
res = client.get_market_myhistory_render_response(...)
```

То есть:

- 1 секунда **до каждого** request;
- после 429 дополнительный sleep 4 секунды в caller;
- перед следующим retry снова sleep 1 секунда.

Практический минимальный разрыв между получением 429 и следующим request — около **5 секунд**, плюс время обработки.

### Блокировки

В данном history path отсутствуют:

- global Steam 429 flag;
- proxy rate-limit cache;
- per-account lock;
- proxy mutex;
- persisted retry deadline.

Хотя `libs/steam_req/listings.py` импортирует proxy rate-limit функции, они используются для `sell_item` (`listings.py:371-388`), но не для `fetch_myhistory_render`.

`modules/sales_history_sync.py` не найден как production import/caller вне тестов. Это сильный признак, что файл оставлен как legacy/compatibility implementation, а актуальная точка входа уже NG.

---

## 6. Самый старый quarantine/legacy flow

### Отключённая точка входа

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/__quarantine/modules/myhist.py`

`__quarantine/modules/myhist.py:68-78`:

```python
def process_my_history(user: User):
 # Future bot rewrite will replace this legacy lots-flow function.
 exit(LEGACY_LOTS_HARD_STOP)
 ...
 new_history, new_total = getMyHistory(user, init_total)
```

Код после `exit` недостижим. Сообщение определено на строках 17-20:

`legacy db.lots flow stopped; future bot rewrite will replace process_my_history`

Иными словами, legacy processor физически присутствует для совместимости/истории, но штатно не читает Steam.

### Старый request flow, если убрать hard stop

`__quarantine/modules/myhist.py:78` 
→ `libs/steam_req/myhistory.py:113 getMyHistory` 
→ `libs/steam_req/myhistory.py:62 __fetchMyHistory` 
→ `SteamWebClient.get_market_myhistory_render_response`, строки 71-76 
→ `libs/clients/steam_web.py:365-380` 
→ `_get`, `steam_web.py:150-153`.

### Paging

`libs/steam_req/myhistory.py:62-69`:

- count clamp 1..500;
- запросу предшествует `time.sleep(1)`;
- необычная граница: если диапазон пересекает offset 1000, count уменьшается до `1000 - start`.

Начальный запрос в `getMyHistory`, строки 113-119:

- `start = 0`
- `count = 1`

После ответа размер следующего запроса вычисляется динамически:

`myhistory.py:141-150`

```python
count = nHist["total"] - initTotal - start - nHist["size"]
...
start += nHist["size"]
```

То есть это не фиксированные страницы по 500: сначала probe на 1 запись, затем запрос разницы total, clamp-нутый до 500.

### HTTP 429 и retries

`libs/steam_req/myhistory.py:77-81` возвращает:

```python
{"success": False, "error": f"Http error {res.code}"}
```

429 не имеет отдельной ветки. В `getMyHistory`, строки 121-129:

- `loadsFails = 3`;
- любая `success=False`, включая `"Http error 429"`, уменьшает счётчик;
- если попытки остались — `time.sleep(14)` и retry с тем же start/count;
- на третьей неудаче функция возвращает накопленную историю, а не сообщает явный rate-limit failure.

Перед следующим request снова выполняется sleep 1 секунда. Поэтому между 429 и retry фактически минимум около **15 секунд**.

Для необработанного исключения:

- `myhistory.py:157-159`: traceback и sleep 30 секунд;
- цикл не ограничен отдельным exception counter.

Для auth/SystemExit:

- `exitsFails = 5`, строки 114-115;
- повторные auth failures не имеют специального sleep, кроме pre-request sleep 1 сек;
- после пятого — `exit()`.

### Внешний legacy retry

Если недостижимый код `process_my_history` выбросил бы обычное исключение:

`__quarantine/modules/myhist.py:134-139` — outer loop ждёт 15 секунд.

---

## Уверенность и неоднозначности

**Высокая уверенность:**

- page sizes и лимиты: 500;
- старые интервалы 1/4/14/30 секунд;
- NG post-request cooldown 8 секунд;
- NG 429 defer 2400–4800 секунд;
- singleton lock, proxy mutex и per-login deferred queue;
- `Retry-After` только логируется;
- quarantine entry point принудительно отключён.

**Средняя уверенность:**

- `modules/sales_history_sync.py` фактически не используется production runtime: поиск не обнаружил callers/imports, но динамический импорт по строке или внешний потребитель за пределами репозитория исключить нельзя.
- Proxy lock задуман как общий на proxy, однако ключ берёт только префикс host до первой точки. Разные адреса с одинаковым префиксом могут неожиданно разделить lock; одинаковый реальный proxy с различающимися строковыми префиксами — не разделить.
- В текущем NG flow 8-секундный cooldown не удерживает proxy-lock. Поэтому он ограничивает частоту конкретной coroutine/account, но не гарантирует интервал 8 секунд между запросами разных аккаунтов через один proxy.

**Существенная неоднозначность терминологии:** 
Если под «старым Python-кодом» подразумевается только pre-NG реализация, релевантны разделы 5–6. Если требуется историческое сравнение с действующей защитой, разделы 1–4 показывают текущую замену и объясняют, куда мигрировала 429-защита.
</response>
</task>
</system_notification>
<user_query>Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. If you mention an agent or subagent in your response, link it with the `[Name](id)` Don't use generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](bc-id#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](bc-id#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](bc-id#desktop)` only when the agent used computer use. Don't repeat the same confirmation every time.</user_query>