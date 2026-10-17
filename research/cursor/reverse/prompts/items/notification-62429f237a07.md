<timestamp>Friday, Oct 9, 2026, 8:51 AM (UTC+3)</timestamp>
<system_notification>
The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.

<task>
kind: subagent
status: success
task_id: 579805b2-2a7f-47a6-8906-01b203d519ec
title: Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Тольк
tool_call_id: call_b19144b941cd4d6992ea33779cfaeb74
agent_id: 579805b2-2a7f-47a6-8906-01b203d519ec
detail: <user_visible_high_level_summary>
Исследован полный путь sales_history до Steam. Корневая причина 429 — lock сериализует только одновременную отправку по грубому proxy_key, но 8-секундная пауза выполняется уже после освобождения lock, поэтому до 12 аккаунтов могут отправить burst почти одновременно; полноценного shared rate limiter нет.
</user_visible_high_level_summary>
<response>
Ничего не запускал, не собирал, не тестировал и не изменял.

## Вывод

Наиболее вероятная и прямо доказуемая по коду причина HTTP 429: существующий `SteamProxyLocks` — это mutex, а не rate limiter.

Он исключает только одновременное выполнение `request.send()`, но 8-секундная задержка выполняется уже после освобождения mutex. Поэтому до 12 аккаунтов, использующих один proxy key, последовательно захватывают lock и отправляют запросы практически подряд. Между запросами разных аккаунтов нет гарантированного интервала.

Дополнительно ключ прокси вычисляется только по части адреса до первой точки. Например, все адреса `10.*` получают один ключ `"10"`: это одновременно объединяет unrelated proxies и всё равно не обеспечивает pacing.

## Точки входа

Daemon:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/main.rs:23` — Tokio `main`.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/main.rs:42-127` — конфигурация, process-wide file lock, список trading-аккаунтов, Redis/Postgres/Kafka/ClickHouse, запуск daemon.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/main.rs:46-54` — эксклюзивный lock запрещает второй daemon.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/main.rs:57-65` — все active trading logins.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/main.rs:112-125` — вызов `run_daemon`.

Bootstrap:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/tools/superbot_admin/src/main.rs:145-150` — тот же file lock, исключающий одновременную работу daemon.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/tools/superbot_admin/src/main.rs:178-192` — вызов `run_bootstrap`.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:37-77` — bootstrap scheduler.

## Account/page flow

Daemon:

1. `run_daemon` создаёт один общий для процесса `SteamProxyLocks`:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:36-42`
2. Каждую итерацию выбирается максимум `account_concurrency` due-аккаунтов:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:47-50`
3. Каждый аккаунт запускается отдельной Tokio task:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:62-71`
4. Цикл ждёт завершения всей выбранной пачки, прежде чем выбрать следующую:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:73-75`
5. Из Redis берутся cookies/proxy, создаётся отдельный `reqwest::Client` аккаунта, затем вызывается `sync_raw`:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:131-170`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:187-201`
6. `sync_raw` идёт по страницам последовательно:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/raw_sync.rs:54-59`
 - start увеличивается на 500: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/raw_sync.rs:127`
7. После успешного цикла следующий sync назначается через 900 секунд:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml:54`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs:91-106`

Bootstrap похож, но ограничивает число живых account tasks через `JoinSet`:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:56-75`
- Для каждого аккаунта выполняется тот же `sync_raw`: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:168-180`

## Конкретные лимиты и задержки

- Account concurrency: **12**
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml:55`
- Sync interval: **900 секунд**
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml:54`
- Page size: **500**
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/raw_sync.rs:16-17`
- Максимум страниц за account cycle: **500**, то есть теоретически 250 000 записей:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/raw_sync.rs:16-17`
- Client дополнительно clamp-ит count в `1..=500`:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:17`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:431-432`
- Номинальный cooldown: **8 секунд**:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:16`
- Но он расположен после lock scope:
 - lock/send: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:196-223`
 - sleep после освобождения guard: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:225-227`
- Transport retries: **6 попыток**, паузы **100/200/300/400/500 ms**:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:18-20`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:145-181`
- Не-429 HTTP response retries: **5**, но без отдельной задержки между response attempts, кроме общего post-request sleep:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:18`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:107-120`

## Полный HTTP path до Steam

1. Redis payload → `SteamSession`, содержащая login, currency, cookies и proxy:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:18-38`
2. Для каждого account cycle строится новый `reqwest::Client`:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:81-98`
3. Proxy — `Proxy::all(http://address)` плюс basic auth:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:420-428`
4. Client settings:
 - connect timeout 15 s;
 - read timeout 60 s;
 - total timeout 105 s;
 - max idle connections per host 2;
 - invalid TLS certificates accepted.
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:83-90`
5. Request:
 - `GET https://steamcommunity.com/market/myhistory/render/`
 - query: `query=""`, `start`, `count`, `norender=1`, `l=english`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:195-219`
6. Заголовки имитируют browser AJAX, cookies фильтруются по Steam domain/path:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:51-77`
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:80-103`
7. Никакого HTTP middleware, governor/token bucket или shared timing state нет. Есть лишь общий `HashMap<proxy_key, Mutex<()>>`:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:24-43`

## Почему текущий lock вызывает burst

Критическая последовательность:

- Account A захватывает proxy mutex и отправляет запрос.
- После получения response guard уничтожается.
- Account B немедленно получает mutex и отправляет запрос.
- Account A параллельно спит 8 секунд.
- Затем C, D … до 12 аккаунтов делают то же.

То есть 8 секунд ограничивают скорость одного account task, но не общую скорость через один Steam-visible proxy/IP. При 12 активных аккаунтах получается burst до 12 запросов почти подряд, а затем новый запрос примерно каждые 8 секунд от освободившихся tasks.

`proxy_key` дополнительно некорректен:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:41-48`
- Для IPv4 `10.1.1.1:port` возвращается `"10"`, что подтверждает тест:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:141-149`

Следствие: различные proxy IP одного первого октета необоснованно блокируют друг друга, а запросы внутри этой группы всё равно уходят burst-ом. Если адрес — hostname, ключ также только часть до первой точки.

## Текущее поведение 429

- 429 распознаётся здесь:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:270-275`
- Серверный `Retry-After` сохраняется в artifact, но не используется:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:467-479`
- Вместо него выбирается случайная задержка **2400–4800 секунд**, то есть 40–80 минут:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:271-274`
- 429 не ретраится внутри HTTP client; ошибка немедленно выходит:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:113-118`
 и `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:160-163`
- Page position и retry timestamp пишутся в checkpoint:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/raw_sync.rs:60-72`
- Daemon ставит `retry_until` только этого login:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:227-245`
 и `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs:110-114`
- Scheduler исключает login до `retry_until`, остальные аккаунты продолжаются:
 `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs:72-88`

Checkpoint `retry_at_unix` загружается, но нигде не участвует в scheduling/decision:

- запись: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/checkpoint.rs:89-100`
- загрузка: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/checkpoint.rs:166-180`
- поле результата: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/checkpoint.rs:205-217`

`retry_count` увеличивается, но не читается для выбора ступени cooldown:

- schema: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000001_sales_history_cursors.sql:8-16`
- increment: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs:110-114`
- reset только при success: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs:100-105`

Bootstrap хуже: 429 завершает account task ошибкой, а затем из-за `???` способен прекратить весь bootstrap; persistent per-account retry scheduling там отсутствует:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:60-75`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:168-181`

## Минимальный надёжный дизайн исправления

1. Заменить `SteamProxyLocks` на shared per-proxy limiter state:
 - ключ — полный нормализованный proxy endpoint/реальный egress identity, минимум `host:port`, а не первый DNS/IP segment;
 - значение — mutex с `next_allowed_at`;
 - перед каждым `send()` под mutex вычислить wait до `next_allowed_at`, cancellable sleep, затем отправить;
 - после выделения слота сразу установить `next_allowed_at = send_time + 8s`.
2. Важно: reservation/sleep должны происходить в shared limiter до отправки. Не держать глобальный mutex во время HTTP I/O; mutex нужен только на короткое обновление состояния. Так unrelated proxy keys не блокируют друг друга.
3. Account cooldown держать отдельно от shared proxy pacing:
 - первый 429 данного login: retry exactly через **30 минут от времени получения response**;
 - повторный 429 после этого сна: **1 час от времени нового response**;
 - последующие повторные 429 разумно оставлять на 1 час;
 - успех account cycle сбрасывает ступень.
4. Для этого `remember_retry` должен атомарно учитывать текущий `retry_count` и возвращать/назначать:
 - `retry_count == 0` → 1800 s;
 - `retry_count >= 1` → 3600 s.
 Timestamp следует вычислять сразу при разборе 429, а не после artifact I/O, чтобы контракт был именно «с момента ответа».
5. Не спать 30/60 минут внутри account task: записать `retry_until` и вернуть task scheduler-у. Это освобождает один из 12 concurrency slots и не задерживает unrelated accounts.
6. Возобновлять с checkpoint `(start, page_index)`, что уже поддерживается:
 - `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:172-199`
7. `Retry-After` можно сохранять для диагностики, но заданный контракт 30m/1h должен быть источником scheduling. Случайные 2400–4800 s удалить.
8. Bootstrap должен обрабатывать 429 per-account, а не обрушать весь запуск. Минимально — тот же account cooldown/resume scheduler; если bootstrap обязан завершаться одним процессом, его очередь должна отложить только конкретный login.

## Тесты, которые логично изменить/добавить

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_client.rs:547-611`
 - full endpoint key;
 - shared limiter гарантирует ≥8 секунд между reservation одного proxy;
 - разные proxy не блокируют друг друга;
 - 429 timestamp фиксируется в момент response;
 - удалить ожидания случайного `2400`.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/steam_session.rs:129-150`
 - заменить утверждение `proxy_key() == "10"` на полный нормализованный endpoint.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/daemon.rs:516-535`
 - первый 429 → 1800;
 - второй после retry → 3600;
 - дальнейшие → 3600;
 - success сбрасывает ступень;
 - один охлаждённый login не мешает due unrelated login.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/checkpoint.rs:362-385`
 - сохранение и resume той же страницы после 429;
 - согласованность checkpoint retry timestamp с DB `retry_until`.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/bootstrap.rs:259-264`
 - 429 одного аккаунта не прекращает остальные bootstrap tasks.
- Добавить тесты `CursorStore` для атомарной retry ladder; сейчас в `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/cursor.rs` тестов нет.
</response>
</task>
</system_notification>