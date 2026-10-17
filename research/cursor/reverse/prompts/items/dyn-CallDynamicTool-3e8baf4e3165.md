<!-- 704ada44-4cb2-422b-9af3-5b380ba360a9 CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать синхронизацию кошельков","prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Пользователь просит исключительно статическое исследование, без запуска, сборки или исполнения кода и без изменений в репозитории. Исследуй модуль синхронизации кошельков (wallet sync) максимально подробно для самостоятельного русскоязычного отчёта о бизнес-логике: назначение, какие аккаунты/кошельки выбираются, Steam API/client и авторизация, итерации/снимки/события балансов и инвентаря если применимо, планирование, очереди/Kafka, Redis/Postgres, дедупликация/идемпотентность, ошибки/retry/backoff, конкурентность, состояние и восстановление, валюты и расчёты, выходные данные и потребители. Просмотри релевантные Python/Rust/migrations/tests/docs/config файлы через чтение/поиск. Ничего не запускай и не редактируй. В финале верни подробный структурированный конспект с точными путями файлов, различиями legacy/NG и неопределённостями.","subagent_type":"generalPurpose","model":"inherit","run_in_background":false}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Статически сопоставлены Rust runtime, Python NG-контуры и legacy-реализация wallet sync: выбор trading-аккаунтов, auth/cookies, Steam addfunds, планирование, PostgreSQL state, Redis cooldown, Kafka/ClickHouse, retries, recovery, валюты, потребители и ключевые расхождения. Код не запускался и репозиторий не изменялся.
</user_visible_high_level_summary>
<response>
# Wallet sync: статический отчёт

Исследование выполнено только чтением и поиском по файлам. Код не запускался, не собирался и не изменялся.

## 1. Назначение

Wallet sync периодически получает текущий баланс Steam Wallet для торговых аккаунтов и формирует временной ряд:

1. выбирает активные аккаунты с ролью `trading`;
2. получает актуальные cookies/proxy из auth-кэша;
3. запрашивает HTML-страницу Steam Add Funds;
4. извлекает валюту и баланс;
5. преобразует сумму в minor units;
6. сохраняет результат в PostgreSQL;
7. публикует snapshot в Kafka;
8. ClickHouse injector записывает snapshot в ClickHouse;
9. статистический слой строит дневные агрегаты и показывает баланс в Telegram.

Wallet sync не синхронизирует предметы, assets или inventory. Inventory используется отдельным seller-контуром.

Главные текущие файлы:

- `rust/services/wallet_sync/src/main.rs`
- `rust/services/wallet_sync/src/daemon.rs`
- `rust/services/wallet_sync/src/store.rs`
- `rust/services/wallet_sync/src/session.rs`
- `rust/services/wallet_sync/src/kafka.rs`
- `rust/services/wallet_sync/src/model.rs`
- `rust/crates/steam_wallet/src/lib.rs`

Параллельная Python NG-реализация:

- `src/superbot_ng/workers/wallet/daemon.py`
- `src/superbot_ng/workers/wallet/scheduler.py`
- `src/superbot_ng/workers/wallet/iteration.py`
- `src/superbot_ng/workers/wallet/login_sync.py`
- `src/superbot_ng/clients/steam/wallet/client.py`

## 2. Какой runtime фактически используется

В репозитории присутствуют три слоя.

### Rust production runtime

`Dockerfile` собирает и устанавливает бинарник:

- `rust/services/wallet_sync`
- `/app/wallet-sync`

`docker-compose.app.yml` запускает:

```text
/app/wallet-sync
```

Сервис имеет собственный volume для lock-файла и подключается к сетям PostgreSQL/Redis/Kafka/Steam Auth.

### Python NG

`src/superbot_ng` содержит полноценную Python-реализацию того же процесса. Её оболочка находится в `aWalletSync.py`, но `Makefile` запрещает прямой запуск этого legacy-style файла и направляет production-запуск через Compose.

Python NG выглядит как контрактный/переходный слой: он уже использует PostgreSQL, Redis, Kafka и ClickHouse, но production image собирает Rust runtime.

### Старый legacy-контур

Старые компоненты находятся в:

- `libs/steam_req/addfunds.py`
- `libs/clients/steam_web.py`
- `models/mongo.py`
- `modules/stats.py`
- `libs/settings.py`

Они используют MongoDB/Memcache и старую модель `db.wallets`. Активный production runtime к ним не подключается. Контракт `tests/contracts/wallet/test_wallet_ng_contracts.py` прямо проверяет отсутствие legacy-импортов.

## 3. Выбор аккаунтов

### Full iteration

Rust:

```text
SELECT login
FROM auth.credentials
WHERE active = TRUE
  AND runtime_role = 'trading'
ORDER BY login
```

Файл: `rust/services/wallet_sync/src/store.rs`.

Python:

- `src/superbot_ng/repositories/postgres/auth/credentials.py`
- `src/superbot_ng/use_cases/users/roster.py`

Python использует тот же фильтр:

```text
active = true
runtime_role = 'trading'
```

Таким образом:

- inactive аккаунты исключаются;
- аккаунты с ролью `currency` исключаются;
- порядок стабилен по `login`;
- выбор не зависит от текущего баланса, proxy или наличия inventory;
- все trading-аккаунты участвуют в full iteration, даже если их auth snapshot временно недоступен.

### Retry iteration

Retry-итерация выбирает только записи из `wallet_sync_state`, у которых:

- `active = TRUE`;
- `last_error IS NOT NULL`;
- `next_attempt_at <= now()`.

Ограничение — максимум 1000 логинов за retry iteration.

Файлы:

- `rust/services/wallet_sync/src/store.rs`
- `src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py`
- `migrations/postgres/000012_wallet_due_scheduler.sql`

Retry не перечитывает полный roster и не удаляет локальные cookie jars.

## 4. Auth и Steam authorization

Wallet sync сам не выполняет логин Steam по паролю и не вызывает Steam Web API.

Auth выполняется отдельным auth service. Wallet sync получает готовый runtime snapshot из Redis:

```text
auth:live:<login>
```

Payload содержит:

- `login`;
- `steamid`;
- `currencyid`;
- `state_version`;
- cookies;
- proxy и proxy credentials.

Rust auth-модель:

- `rust/services/auth/src/domain.rs`
- `rust/services/auth/src/redis_cache.rs`
- `rust/services/auth/src/postgres.rs`

Схема auth:

- `migrations/postgres/000003_auth_schema.sql`
- `migrations/postgres/000006_auth_next_auth_at.sql`
- `migrations/postgres/000008_currency_sync.sql`

В PostgreSQL auth есть:

- `auth.credentials`;
- `auth.refresh_tokens`;
- `auth.proxies`;
- `auth.live_data`.

Wallet sync использует именно live session, а не password/shared secret/identity secret.

### Отличие Rust и Python NG

Rust напрямую читает Redis payload:

- `rust/services/wallet_sync/src/daemon.rs`

Python NG использует:

- `src/superbot_ng/use_cases/users/runtime_user.py`
- `src/superbot_ng/repositories/redis/auth/cache.py`

Python дополнительно требует, чтобы `steamLoginSecure` имел TTL выше `AUTH_TTL_THRESHOLD_SEC = 400`. Если snapshot отсутствует или слишком скоро истекает, Python ждёт и повторяет чтение с паузой 30 секунд.

Rust не выполняет отдельную TTL-проверку в wallet sync; он полагается на то, что auth service записывает в Redis только актуальный payload с expiration.

### Cookie jars

Python:

- `src/superbot_ng/clients/steam/runtime_cookies.py`
- `src/superbot_ng/platform/http/cookies.py`

Rust:

- `rust/services/wallet_sync/src/session.rs`

В обоих вариантах cookie jar переиспользуется для одного login, пока не изменился `state_version`. При изменении auth snapshot создаётся новый jar.

Full iteration удаляет jars аккаунтов, исчезнувших из текущего roster.

## 5. Steam request

Используется HTML endpoint:

```text
GET https://store.steampowered.com/steamaccount/addfunds
```

Это не Steam Web API, а authenticated HTML page.

### Rust

Файл: `rust/services/wallet_sync/src/session.rs`.

Настройки HTTP:

- proxy;
- cookies;
- User-Agent;
- `Accept`;
- `Accept-Language`;
- connect timeout 15 секунд;
- read timeout 60 секунд;
- общий timeout 105 секунд;
- `danger_accept_invalid_certs(true)`.

Перед HTTP-запросом:

1. проверяется наличие cookies для Steam Store;
2. проверяется Redis cooldown proxy;
3. берётся локальный proxy lock;
4. выполняется configured delay;
5. отправляется запрос.

### Python NG

Файлы:

- `src/superbot_ng/clients/steam/wallet/client.py`
- `src/superbot_ng/platform/http/client.py`
- `src/superbot_ng/platform/http/proxy.py`

Используется `httpx.AsyncClient`, proxy и `CookieJar`.

Настройки:

- delay перед запросом: 1 секунда;
- connect timeout: 15 секунд;
- read timeout: 60 секунд;
- write timeout: 30 секунд;
- pool timeout: 5 секунд;
- TLS verification отключён.

## 6. Proxy concurrency и rate limit

Proxy key строится не по полному адресу, а по первой части hostname. Например, proxy `11.22.33.44:8080` превращается примерно в `11`.

Это используется для:

- локальной сериализации запросов;
- Redis cooldown key;
- меток observability.

### Локальные locks

Rust:

- `WalletProxyLocks` в `rust/services/wallet_sync/src/session.rs`.

Python:

- `AsyncProxyLockRegistry` в `src/superbot_ng/platform/proxy_lock/registry.py`.

Запросы через один proxy не выполняются одновременно внутри процесса.

### Redis cooldown

Ключ:

```text
wallet:addfunds:cooldown:<proxy_key>
```

Python:

- `src/superbot_ng/repositories/redis/wallet/cache.py`

Rust создаёт тот же формат ключа в `rust/services/wallet_sync/src/session.rs`.

При HTTP 429 cooldown записывается до освобождения proxy.

Различия:

- Rust использует `proxy_cooldown_seconds = 600` и минимум 600 секунд;
- Rust также учитывает `Retry-After` в секундах или HTTP-date;
- Python использует фиксированный `WALLET_RATE_LIMIT_RETRY_SECONDS = 60`;
- Python не извлекает `Retry-After`.

Rust-реализация в этом отношении строже и дольше блокирует proxy.

## 7. Извлечение баланса

### Rust parser

Файл: `rust/crates/steam_wallet/src/lib.rs`.

Проверяется:

1. страница выглядит как авторизованная;
2. найдена ожидаемая валюта;
3. найден wallet balance;
4. сумма преобразована в minor units.

Поддерживаются маркеры:

- `logged_in`;
- `account_pulldown`;
- `input_currency`;
- `header_wallet_balance`;
- `responsive_menu_user_wallet`.

HTML tags удаляются до извлечения числа, поэтому цифры в attributes не должны попасть в баланс.

Пример:

```text
¥ 15,569.81 -> 1,556,981
```

Алгоритм всегда масштабирует сумму до двух знаков minor units.

### Python NG parser

Python вызывает native parser:

- `src/superbot_ng/pipelines/wallet/codec.py`
- `native/superbot_native/src/lib.rs`

Native-функция возвращает:

```text
(wallet_minor, currency_code)
```

В `WalletStatsEvent` фактически используется configured `currency_id`, а не `currency_id` из auth payload.

### Legacy parser

Файл: `libs/steam_req/addfunds.py`.

Он:

- проверяет авторизацию;
- извлекает валюту из `<input>`;
- извлекает баланс из старого `header_wallet_balance` или старого account block;
- возвращает wallet в minor units.

Legacy получает ожидаемый код через `get_currency_meta(settings.MARKET_CURRENCY_ID)`.

## 8. Валюта и расчёты

Production config:

```text
currency_id = 8
currency_code = "JPY"
```

Файл: `config.toml`.

Python defaults:

- `WALLET_CURRENCY_ID = 8`;
- `WALLET_CURRENCY_CODE = "JPY"`.

Файл: `src/superbot_ng/platform/settings/runtime.py`.

Баланс хранится в minor units:

- PostgreSQL `BIGINT`;
- ClickHouse `Int64`;
- событие Kafka содержит `wallet_minor`.

В базе есть ограничение:

```text
wallet_minor IS NULL OR wallet_minor >= 0
```

Файл: `migrations/postgres/000007_wallet_sync.sql`.

Wallet sync не конвертирует JPY в USD. Он сохраняет исходную валюту. Конвертация выполняется позднее:

- `src/superbot_ng/use_cases/stats/wallet_conversion.py`
- `src/superbot_ng/repositories/clickhouse/stats/summary.py`

Для USD:

```text
wallet_usd_minor = round(wallet_minor * inverse_conversion_rate)
```

Используется `Decimal` и `ROUND_HALF_UP`.

Источник курсов:

- PostgreSQL `currency_rates`;
- `migrations/postgres/000008_currency_sync.sql`.

Если курс отсутствует, выбрасывается `StatsCurrencyRateMissing`.

### Важное ограничение

`currencyid` из Redis auth payload не используется как выбор валюты wallet event. Валюта определяется конфигурацией wallet sync и проверкой HTML-страницы Steam.

То есть account с auth payload, где указана другая валюта, не отбирается отдельно; ошибка возникнет только если Steam page не соответствует configured `JPY`.

## 9. Iteration, snapshot и event model

Основной объект:

```text
WalletStatsEvent
```

Файл: `src/superbot_ng/domain/wallet/models.py`.

Поля:

- `bucket_at`;
- `observed_at`;
- `login`;
- `wallet_minor`;
- `currency_id`;
- `iteration_id`.

Rust-аналог находится в `rust/services/wallet_sync/src/model.rs`.

### Временные поля

- `bucket_at` — время начала iteration;
- `observed_at` — фактическое время получения баланса;
- `iteration_id` — идентификатор логической попытки обработки.

Для full iteration все аккаунты получают один `bucket_at`, даже если обрабатываются параллельно.

Для retry iteration используется новый bucket времени retry iteration.

Событие — это snapshot, а не delta. Разница между днями вычисляется позже на уровне агрегатов.

Inventory snapshot, список предметов, asset IDs и trade events в wallet event отсутствуют.

## 10. Планирование

Настройки production:

- interval: 900 секунд;
- concurrency: 12;
- per-account failure retry: 30 секунд;
- request delay: 1 секунда;
- Kafka payload limit: 131072 байт.

Планировщик:

- `rust/services/wallet_sync/src/daemon.rs`
- `src/superbot_ng/workers/wallet/scheduler.py`

Правила:

1. Если full iteration ещё ни разу не завершалась — full запускается сразу.
2. Если наступил `next_run_at` full iteration — full имеет приоритет над retry.
3. Иначе выбирается ближайший due retry.
4. Если работы нет, процесс спит до ближайшего full/retry времени.
5. Full iteration планирует следующую full iteration через 900 секунд после завершения.
6. Retry iteration не двигает full schedule.

Миграция, добавившая `kind = full/retry`:

- `migrations/postgres/000012_wallet_due_scheduler.sql`.

## 11. Конкурентность

Внутри iteration:

- Rust использует `buffer_unordered(concurrency)`;
- Python использует `run_bounded_workers`.

Результаты затем сортируются обратно в порядок roster. Это проверяется в:

- `tests/contracts/wallet/test_wallet_ng_contracts.py`.

Таким образом:

- сетевые запросы выполняются параллельно;
- Kafka rows сохраняют стабильный порядок логинов;
- один сбой аккаунта не должен отменять обработку остальных аккаунтов;
- инфраструктурная ошибка PostgreSQL/Kafka уже может прервать всю iteration.

Дополнительные уровни:

- wallet daemon singleton через lock-файл;
- PostgreSQL pool ограничен максимумом 4 соединения;
- proxy requests сериализуются по proxy key;
- Python Kafka writer дополнительно использует глобальный visibility lock.

## 12. PostgreSQL state

Схема определена в:

- `migrations/postgres/000007_wallet_sync.sql`
- `migrations/postgres/000012_wallet_due_scheduler.sql`

### `wallet_sync_iterations`

Хранит:

- `id`;
- `started_at`;
- `completed_at`;
- `status`;
- `expected_count`;
- `processed_count`;
- `success_count`;
- `failed_count`;
- `stats_synced_at`;
- `next_run_at`;
- `last_error`;
- `kind`.

Статусы:

```text
running
completed
failed
```

### `wallet_sync_state`

Одна строка на login:

- `active`;
- `roster_seen_at`;
- текущий `wallet_minor`;
- `currency_id`;
- `last_success_at`;
- `next_attempt_at`;
- `retry_count`;
- `last_error`;
- `iteration_id`;
- `stats_bucket_at`;
- `stats_observed_at`;
- `stats_synced_at`.

Основные операции:

- `sync_roster`;
- `begin_iteration`;
- `record_success`;
- `record_failure`;
- `pending_stats_events`;
- `mark_stats_synced`;
- `complete_iteration`.

Python реализация разделена на mixins:

- `store_roster.py`;
- `store_iterations.py`;
- `store_retry_schedule.py`;
- `store_sync_results.py`;
- `store_stats.py`.

Rust аналог объединён в `rust/services/wallet_sync/src/store.rs`.

### Success

Успех одной записи в транзакции:

1. обновляет balance и timestamps аккаунта;
2. сбрасывает `retry_count`;
3. удаляет `last_error`;
4. устанавливает `stats_synced_at = NULL`;
5. увеличивает success/processed counters iteration.

### Failure

Ошибка:

1. записывается в `last_error`;
2. увеличивается `retry_count`;
3. устанавливается `next_attempt_at`;
4. увеличивается `failed_count` и `processed_count`.

Предыдущий успешный баланс не очищается. Поэтому при ошибке старое значение продолжает существовать в PostgreSQL, но новый ClickHouse snapshot не создаётся.

## 13. Kafka

Topic:

```text
ch.wallet_stats_events.v1
```

Настройки:

- 4 partitions;
- retention 24 часа;
- retention size 64 MiB;
- cleanup policy `delete`;
- replication factor 1.

Файлы:

- `src/superbot_ng/platform/settings/kafka.py`
- `_scripts/kafka_topics.py`
- `src/superbot_ng/clients/kafka/wallet/wallet_writer.py`
- `rust/services/wallet_sync/src/kafka.rs`

Producer:

- `acks=all`;
- compression `zstd`;
- linger 20 ms;
- batch size 64 KiB;
- ключ Kafka — `batch_id`.

Envelope:

```json
{"v":1,"b":"wallet-7","r":[...]}
```

Одна row содержит 6 полей:

```text
bucket_at
observed_at
login
wallet_minor
currency_id
iteration_id
```

Большие batches разбиваются на chunk IDs:

```text
wallet-7-0001
wallet-7-0002
```

Ограничение payload — 128 KiB.

## 14. Kafka visibility и порядок записи

Wallet sync не считает отправку завершённой сразу после producer acknowledgement.

После отправки он ждёт, пока consumer group ClickHouse injector закоммитит offset выше отправленного offset.

Python:

- `src/superbot_ng/clients/kafka/visibility/waiter.py`
- `src/superbot_ng/clients/kafka/visibility/admin.py`

Rust:

- `rust/services/wallet_sync/src/kafka.rs`

Последовательность:

1. отправить chunk;
2. дождаться visibility;
3. отправить следующий chunk;
4. после visibility всех chunks пометить PostgreSQL rows как synced;
5. завершить iteration.

`stats_synced_at` выставляется только после visibility. Это позволяет восстановить backlog после падения.

## 15. ClickHouse injector

Consumer:

- `rust/services/clickhouse_injector/src/main.rs`
- `src/superbot_ng/workers/clickhouse_injector/service.py`

Он читает:

- `ch.sales_history_events.v2`;
- `ch.wallet_stats_events.v1`.

Для wallet:

1. валидирует envelope;
2. проверяет version `1`;
3. проверяет 6 полей row;
4. преобразует rows в JSONEachRow;
5. пишет в `superbot.wallet_stats_events`;
6. коммитит Kafka offsets.

Buffer flush происходит при:

- 1000 сообщений;
- 2 MiB;
- возрасте buffer 2 секунды;
- shutdown.

### Существенная особенность обработки ошибки

Если ClickHouse INSERT завершился ошибкой, injector фиксирует ошибку в observability, но затем всё равно коммитит Kafka offsets.

Следовательно, для wallet-потока ошибка ClickHouse может привести к потере сообщений после их удаления из Kafka consumer backlog.

Progress guard для повторных rejected payloads применяется только к sales payloads с `state_version = 2`, а не к wallet payloads.

Это один из важных рисков текущей схемы.

## 16. ClickHouse storage и дневные агрегаты

Таблица:

- `migrations/clickhouse/000003_wallet_stats_events.sql`

```text
superbot.wallet_stats_events
```

Поля:

- `bucket_at`;
- `observed_at`;
- `event_date`;
- `login`;
- `wallet_minor`;
- `currency_id`;
- `iteration_id`.

Engine:

```text
ReplacingMergeTree(observed_at)
```

Ключ сортировки:

```text
login, bucket_at, iteration_id
```

Дневной aggregate:

- `migrations/clickhouse/000006_stats_daily_refreshable_mv.sql`
- `migrations/clickhouse/000011_wallet_daily_without_final.sql`
- `migrations/clickhouse/000013_wallet_daily_two_day_window.sql`

Агрегация:

1. для каждого login и дня выбирается запись с максимальным `observed_at`;
2. затем балансы суммируются по `currency_id`;
3. результат записывается в `stats_wallet_daily`;
4. MV обновляется каждые 15 минут;
5. используется двухдневное окно: текущий и предыдущий день.

`period_date` вычисляется через:

```text
toDate(bucket_at - INTERVAL 1 HOUR)
```

Это отражает бизнес-границу статистического дня.

## 17. Потребители результата

### NG statistics

Файлы:

- `src/superbot_ng/repositories/clickhouse/stats/summary.py`
- `src/superbot_ng/use_cases/stats/wallet_conversion.py`
- `src/superbot_ng/use_cases/stats/snapshot.py`
- `src/superbot_ng/entrypoints/stats/telegram_sender.py`

Запрос выбирает текущий и предыдущий день из:

```text
superbot.stats_wallet_daily FINAL
```

Если значения за предыдущий день нет, delta считается равной нулю.

Затем:

- balances по валютам конвертируются в USD;
- считается текущий wallet total;
- считается day difference;
- результат попадает в Telegram snapshot.

### Legacy statistics

Файлы:

- `modules/stats.py`
- `modules/stats_rollup.py`
- `models/mongo.py`

Legacy слой суммирует:

```text
db.wallets.wallet
```

по active Mongo-документам и использует старую stats rollup модель.

Он является историческим reference-контуром и не соответствует текущему Rust production pipeline.

## 18. Ошибки и retry

### Ошибки аккаунта

Обрабатываются без остановки других аккаунтов:

- отсутствующий Redis auth payload;
- невалидные cookies;
- HTTP status не 200;
- HTTP 429;
- network/timeout;
- неправильная валюта;
- не найден wallet balance;
- parse error.

Python:

- `src/superbot_ng/workers/wallet/failures.py`
- `src/superbot_ng/workers/wallet/observer.py`

Rust:

- `rust/services/wallet_sync/src/daemon.rs`
- `rust/services/wallet_sync/src/session.rs`

### Backoff аккаунта

Backoff в основном фиксированный:

- обычная ошибка: 30 секунд;
- Python 429: 60 секунд;
- Rust 429: минимум 600 секунд либо `Retry-After`.

Экспоненциального per-account backoff нет.

### Системные ошибки

Ошибки PostgreSQL, Kafka visibility или других инфраструктурных операций могут прервать iteration.

Различие:

- Python daemon ловит ошибку iteration, отправляет observability event и ждёт 30 секунд;
- Rust daemon возвращает ошибку наверх, процесс завершается, а Docker `restart: unless-stopped` должен перезапустить контейнер.

### Observability

Rust отправляет failure events в Sentry через:

- `superbot-observability`;
- `rust/services/wallet_sync/src/main.rs`;
- `rust/services/wallet_sync/src/daemon.rs`.

Python использует `WalletAnomalyObserver`:

- неожиданные ошибки отправляются сразу;
- controlled failure отправляется после 5 повторов;
- одинаковый fingerprint ограничивается cooldown 600 секунд;
- cookies/passwords в tags не передаются.

## 19. Восстановление после перезапуска

При старте:

1. lock исключает второй экземпляр;
2. все `running` iterations помечаются `failed`;
3. pending stats отправляются в Kafka до новой iteration;
4. готовые iterations переводятся в `completed`;
5. далее запускается full или retry.

Файлы:

- `rust/services/wallet_sync/src/main.rs`
- `rust/services/wallet_sync/src/daemon.rs`
- `src/superbot_ng/workers/wallet/daemon.py`
- `src/superbot_ng/workers/wallet/pending.py`

Pending event определяется как состояние, где:

- `stats_synced_at IS NULL`;
- есть `stats_observed_at`;
- есть balance/currency/iteration.

После успешной Kafka visibility выполняется bulk update `stats_synced_at`.

Это даёт защиту от потери PostgreSQL snapshot при падении между отправкой и подтверждением.

Однако полная exactly-once семантика отсутствует: если Kafka/ClickHouse уже приняли сообщение, а процесс упал до `mark_stats_synced`, оно может быть отправлено повторно.

## 20. Дедупликация и идемпотентность

Есть следующие механизмы:

- login — primary key в `wallet_sync_state`;
- roster upsert использует `DISTINCT`;
- Python `mark_stats_synced` удаляет дубли `(login, iteration_id)` из входного списка;
- SQL обновляет только rows с `stats_synced_at IS NULL`;
- batch/chunk IDs стабильны внутри iteration;
- ClickHouse использует `ReplacingMergeTree`.

Но отсутствует:

- уникальный batch ID в ClickHouse;
- отдельная таблица обработанных Kafka batches;
- durable idempotency key на уровне injector;
- транзакция между Kafka и PostgreSQL.

Поэтому возможны повторные Kafka/ClickHouse rows после crash window. `ReplacingMergeTree` может устранить часть одинаковых записей, но batch ID в storage не сохраняется.

## 21. Legacy vs NG/Rust

### Legacy

- MongoDB `db.wallets`;
- Memcache cooldown;
- старый `SteamWebClient`;
- старые regex parser;
- баланс хранится в wallet documents;
- Telegram statistics считает Mongo aggregate;
- scheduler хранит `next_sync_at`, `retry_until`, `retry_count` в Mongo.

Источники:

- `libs/steam_req/addfunds.py`
- `libs/clients/steam_web.py`
- `models/mongo.py`
- `modules/stats.py`
- `libs/settings.py`

### Python NG

- PostgreSQL wallet state;
- Redis auth и cooldown;
- Kafka envelope;
- ClickHouse events;
- iteration/full/retry модель;
- native parser;
- более модульная обработка ошибок;
- тестовые контракты для visibility/backlog/recovery.

### Rust

- текущий production binary;
- почти та же PostgreSQL schema и бизнес-логика, что у Python NG;
- собственный parser crate;
- собственная Kafka visibility реализация;
- собственная lock/session/runtime модель;
- конфигурация через `config.toml`;
- системные ошибки приводят к завершению процесса и container restart.

Главные функциональные расхождения Rust/Python:

1. Rust обрабатывает `Retry-After`, Python использует фиксированные 60 секунд.
2. Rust минимально блокирует proxy на 600 секунд, Python — на 60.
3. Python ждёт auth snapshot с достаточным TTL, Rust сразу получает payload или фиксирует ошибку.
4. Rust явно проверяет наличие Store cookies до запроса.
5. Python использует `WalletAnomalyObserver` с threshold controlled failures; Rust отправляет failure context непосредственно.
6. Python daemon продолжает работу после iteration-level exception; Rust завершается.
7. Python Kafka visibility использует async admin client; Rust — committed offsets через `BaseConsumer`.

## 22. Тестовые контракты

Релевантные тесты:

- `tests/contracts/wallet/test_wallet_ng_contracts.py`
- `tests/contracts/wallet/test_wallet_failure_contracts.py`
- `tests/contracts/wallet/test_wallet_scheduler_contracts.py`
- `tests/contracts/wallet/test_wallet_backlog_contracts.py`

Они документируют:

- parser и minor units;
- JPY snapshots;
- порядок PostgreSQL → Kafka → completion;
- отсутствие commit при shutdown;
- стабильный порядок rows при конкурентной обработке;
- pending backlog recovery;
- full/retry scheduler priority;
- rate-limit cooldown;
- Kafka visibility;
- chunking envelope;
- ограничение payload;
- обработку failure без отмены соседних аккаунтов;
- отсутствие legacy imports в NG runtime.

## 23. Неопределённости и риски

1. В workspace отсутствуют релевантные Markdown-документы с описанием wallet sync. Тесты ссылаются на `.ai` документацию, но соответствующие файлы в доступном дереве не обнаружены.
2. Python NG и Rust реализуют близкую логику, но production Compose однозначно запускает Rust. Статус Python NG как активно используемого runtime из самого кода не подтверждается.
3. Ошибка ClickHouse INSERT приводит к commit Kafka offset, поэтому возможна потеря wallet snapshots.
4. Batch ID не сохраняется в ClickHouse, поэтому нет полной дедупликации по Kafka envelope.
5. `currencyid` auth snapshot не является источником истины для wallet event; фактически используется глобальная конфигурация `JPY`.
6. Proxy lock key обрезается до первой части hostname. Разные proxy могут получить одинаковый lock/cooldown key.
7. При падении full iteration до обработки части аккаунтов необработанные аккаунты не получают отдельный failure state и могут ждать следующей full schedule.
8. Kafka topic имеет replication factor 1, поэтому отказ единственной Kafka replica не покрывается репликацией.
9. Историческая Mongo-модель и текущая PostgreSQL/ClickHouse-модель могут показывать разные данные, если legacy stats-код запускается отдельно.
10. Wallet sync не является inventory sync: предметы, assets, trade offers и inventory snapshots находятся вне этого бизнес-процесса.
</response>

Agent ID: 88392845-15df-4dd5-abfc-05f3bf3ea589 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](88392845-15df-4dd5-abfc-05f3bf3ea589)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](88392845-15df-4dd5-abfc-05f3bf3ea589#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](88392845-15df-4dd5-abfc-05f3bf3ea589#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](88392845-15df-4dd5-abfc-05f3bf3ea589#desktop)` only when the agent used computer use)