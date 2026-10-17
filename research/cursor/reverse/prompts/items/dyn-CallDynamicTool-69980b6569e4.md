<!-- 38083b08-c794-4bbf-8868-e3cdfc302d4a CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать синхронизацию кошельков","subagent_type":"explore","model":"inherit","run_in_background":false,"prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Только read-only research: категорически не изменять файлы, не запускать/не собирать/не исполнять код, не запускать тесты. Исследуй модуль «синхронизация кошельков» торгового бота максимально тщательно (very thorough). Найди все относящиеся файлы, entrypoints, workers/use cases, модели, репозитории, внешние API, конфигурацию и тесты как спецификацию. Подготовь подробное самодостаточное описание бизнес-логики на русском: назначение, данные, полный поток, расписание/конкурентность, валюты и конвертации, хранение, retries/errors, граничные случаи, взаимодействие с другими модулями. Приводи точные пути и названия сущностей для проверки родительским агентом."}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Полностью исследованы Python-контур и production Rust-сервис синхронизации кошельков: расписание, конкурентность, Steam/Redis/PostgreSQL/Kafka/ClickHouse, retries, валютная агрегация и контрактные тесты. Подготовлена проверяемая карта файлов и подробное описание бизнес-потока.
</user_visible_high_level_summary>
<response>
Ниже — результат read-only исследования. Файлы не изменялись, код и тесты не запускались.

## 1. Назначение модуля

Модуль периодически получает баланс Steam Wallet для каждого активного аккаунта торгового бота и формирует исторические события для статистики.

Основной бизнес-поток:

1. Получить список активных логинов.
2. Получить актуальную авторизационную сессию, cookies и proxy каждого пользователя.
3. Через соответствующий proxy запросить Steam Store `/steamaccount/addfunds`.
4. Из HTML извлечь баланс и проверить валюту.
5. Сохранить текущее состояние и состояние retry в PostgreSQL.
6. Отправить историческое событие через Kafka.
7. Дождаться подтверждения видимости сообщения downstream-консьюмером.
8. Отметить статистику доставленной.
9. Kafka → ClickHouse injector → `wallet_stats_events`.
10. Из событий строятся дневные агрегаты кошельков, которые затем конвертируются в USD для статистических отчётов.

## 2. Два варианта реализации

В репозитории существуют две реализации одного контура.

### Production Rust-сервис

Именно он запускается контейнером:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/docker-compose.app.yml`
  - сервис `wallet_sync`
  - команда `/app/wallet-sync`
  - `restart: unless-stopped`
  - отдельный volume для lock-файла
  - сети `infra` и `steam_auth`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/main.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/daemon.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/config.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/session.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/store.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/kafka.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/model.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/lib.rs`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/Cargo.toml`
- общий парсер:
  `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/crates/steam_wallet/src/lib.rs`

### Python NG-реализация

Она описывает тот же контракт и подробно покрыта contract-тестами:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aWalletSync.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/entrypoints/wallet/runner.py`
- весь пакет:
  `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/`

Важно: Python entrypoint существует и тестируется как NG entrypoint, но production compose явно запускает Rust-бинарь.

## 3. Entrypoints и жизненный цикл

### Rust

`main.rs`:

- загружает Sentry;
- читает `config.toml`;
- открывает и эксклюзивно блокирует `wallet_sync.lock`;
- при уже запущенном экземпляре возвращает код `75`;
- подключает PostgreSQL, Redis auth/cache и Kafka writer;
- устанавливает обработку `SIGTERM`/Ctrl-C через `CancellationToken`;
- запускает `WalletDaemon::run`;
- классифицирует startup failures:
  - `config_invalid`;
  - `lock_open_failed`;
  - `postgres_connect_failed`;
  - `signal_listener_failed`;
  - `runtime_failed`.

### Python

`aWalletSync.py`:

- инициализирует Sentry;
- использует `FileLock("wallet_sync")`;
- запускает `run_wallet_daemon()` через `asyncio.run`;
- already-running также кодируется специальным exit code;
- корректно обрабатывает expected shutdown и `KeyboardInterrupt`.

`entrypoints/wallet/runner.py` создаёт:

- `AuthPostgresStore`;
- `WalletPostgresStore`;
- `AuthRedisCache`;
- `WalletRedisCache`;
- `WalletKafkaWriter`;
- `WalletDaemonRunner`.

Все ресурсы закрываются в `finally`.

## 4. Конфигурация

Основная production-конфигурация:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml`

Секция `[wallet_sync]`:

- `lock_file = "/run/superbot/wallet_sync.lock"`
- `interval_seconds = 900`
- `concurrency = 12`
- `currency_id = 8`
- `currency_code = "JPY"`
- `request_delay_seconds = 1`
- `proxy_cooldown_seconds = 600`
- `failure_retry_seconds = 30`
- `kafka_payload_max_bytes = 131072`

Python defaults находятся в:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/runtime.py`
  - интервал 900 секунд;
  - concurrency 12;
  - Kafka payload 128 KiB;
  - currency ID 8;
  - currency code JPY.
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/kafka.py`
  - topic `ch.wallet_stats_events.v1`;
  - 4 partitions.

Rust `WalletConfig::validate` требует положительные interval, concurrency, currency ID и payload size, а также непустые currency code, lock file, Kafka bootstrap и group ID.

## 5. Расписание и типы итераций

Существуют два типа итераций:

- `full` — полный проход по всем активным аккаунтам;
- `retry` — проход только по аккаунтам с наступившим retry.

Python scheduler:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/wallet/scheduler.py`

Ключевые правила:

- если полного завершённого прохода ещё не было, full запускается немедленно;
- если `next_run_at` полного прохода наступил, full имеет приоритет перед retries;
- иначе выбираются due retries;
- retry batch ограничен `1000` логинами;
- при отсутствии due retries новая итерация не создаётся;
- daemon спит до минимального из:
  - времени следующего full;
  - ближайшего retry.

Full schedule считается от момента завершения итерации, а не от начала:

`next_run_at = completed_at + interval`.

Retry-итерация не изменяет расписание full.

При старте:

1. незавершённые `running` итерации переводятся в `failed`;
2. отправляются оставшиеся pending stats;
3. завершаются восстановленные итерации, у которых обработаны все пользователи и больше нет недоставленной статистики;
4. только затем планируется новая работа.

## 6. Формирование roster

Полный список логинов поступает из auth-модуля.

Python:

- `load_active_user_logins`
- `ActiveLoginReader`
- `AuthPostgresStore`

Relevant files:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/use_cases/users/`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/auth/`

Full-итерация вызывает `WalletRosterMixin.sync_roster`:

- bulk-upsert всех текущих логинов в `wallet_sync_state`;
- помечает их `active = TRUE`;
- обновляет `roster_seen_at`;
- после upsert деактивирует записи, не замеченные в текущем roster snapshot.

Retry-итерация roster не синхронизирует и cookie/session cache не обрезает.

В Rust аналогичные операции находятся в `WalletStore::active_logins`, `sync_roster` и `WalletSessions::prune`.

## 7. Обработка одного аккаунта

Python orchestration:

- `workers/wallet/login_sync.py`
- `workers/wallet/fetch_event.py`

Шаги:

1. Зафиксировать `observed_at`.
2. Загрузить runtime snapshot пользователя:
   - auth data;
   - cookies;
   - proxy;
   - state version.
3. Через `SteamCookieJarRegistry` переиспользовать или обновить cookie jar.
4. Создать `AsyncSteamWalletClient`.
5. Получить страницу Steam Add Funds.
6. Распарсить баланс и валюту.
7. Создать `WalletStatsEvent`.
8. В транзакции PostgreSQL записать success и увеличить счётчики итерации.
9. Вернуть event для Kafka batch.

Rust делает то же в `WalletDaemon::sync_one`, но live auth читает непосредственно из Redis через `AuthCache`.

### Временные поля

У события два времени:

- `bucket_at` — время старта итерации, одинаковое для её событий;
- `observed_at` — фактическое время наблюдения конкретного аккаунта.

Это позволяет агрегировать единый snapshot итерации, сохраняя фактическую свежесть каждой записи.

## 8. Steam API и proxy concurrency

Внешний endpoint:

`GET https://store.steampowered.com/steamaccount/addfunds`

Python client:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/clients/steam/wallet/client.py`

Свойства:

- используется proxy пользователя;
- перед каждым запросом задержка 1 секунда;
- запрос выполняется под per-proxy async lock;
- аккаунты с одним proxy не обращаются к Steam одновременно;
- разные proxy могут работать параллельно;
- cookies берутся из auth snapshot;
- accepted HTTP status — только `200`;
- `429` создаёт distributed cooldown marker в Redis.

Redis cooldown:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/redis/wallet/cache.py`

Ключ:

`wallet:addfunds:cooldown:<proxy_key>`

Если proxy отсутствует, используется `NoProxy`.

Python TTL при 429 — 60 секунд (`WALLET_RATE_LIMIT_RETRY_SECONDS`). Production Rust использует конфигурационный `proxy_cooldown_seconds = 600`; это заметное различие между реализациями.

Marker записывается до освобождения proxy lock. Пока marker активен, HTTP-запрос не выполняется.

## 9. Парсинг баланса и валюта

Парсер получает:

- HTML Add Funds page;
- ожидаемый код валюты, сейчас `JPY`.

Результат:

- `wallet_minor`;
- `currency_code`.

`wallet_minor` всегда хранится в сотых долях денежной единицы. Поэтому тестовый Steam balance `¥1,234` становится `123400`, несмотря на то что JPY обычно отображается без десятичных знаков.

Парсер:

- находит валюту в `input_currency`;
- поддерживает desktop `header_wallet_balance`;
- поддерживает responsive wallet menu;
- игнорирует посторонние цифры внутри HTML-тегов;
- проверяет соответствие ожидаемой валюте;
- возвращает parse error при несовпадении/невалидной странице.

Сущности:

- Python `WalletParseResult`;
- Python `WalletStatsEvent`;
- Rust `WalletEvent`;
- native Rust parser `steam_wallet`.

Файлы:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/domain/wallet/models.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/wallet/codec.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/crates/steam_wallet/src/lib.rs`

## 10. Конкурентность

Внутри итерации максимум 12 account workers.

Python использует `run_bounded_workers`; Rust — `buffer_unordered(concurrency)`.

Гарантии:

- результаты восстанавливаются в исходном roster order;
- завершение workers вне порядка не меняет порядок Kafka rows;
- ошибка конкретного аккаунта обычно превращается в failure record и не отменяет других workers;
- системная ошибка хранилища/Kafka/инфраструктуры продолжает распространяться и срывает итерацию;
- shutdown после частичной обработки не допускает commit batch в Kafka.

Помимо global concurrency действует per-proxy сериализация запросов.

На уровне процесса гарантирован singleton через lock-файл.

## 11. PostgreSQL

Миграции:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000007_wallet_sync.sql`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/postgres/000012_wallet_due_scheduler.sql`

### `wallet_sync_iterations`

Хранит:

- `id`;
- `kind`: `full`/`retry`;
- `started_at`, `completed_at`;
- status: `running`/`completed`/`failed`;
- expected/processed/success/failed counts;
- `stats_synced_at`;
- `next_run_at`;
- `last_error`.

### `wallet_sync_state`

Одна строка на login:

- `active`;
- `roster_seen_at`;
- последний `wallet_minor`;
- `currency_id`;
- `last_success_at`;
- `next_attempt_at`;
- consecutive `retry_count`;
- `last_error`;
- текущий `iteration_id`;
- `stats_bucket_at`;
- `stats_observed_at`;
- `stats_synced_at`.

На success:

- баланс и валюта обновляются;
- retry count сбрасывается в 0;
- ошибка очищается;
- следующий normal attempt ставится через 900 секунд;
- stats event сначала остаётся pending;
- iteration processed/success увеличиваются.

На failure:

- баланс не затирается;
- `retry_count += 1`;
- сохраняется ошибка;
- вычисляется `next_attempt_at`;
- processed/failed итерации увеличиваются.

Репозиторные компоненты:

- `WalletPostgresStore`
- `WalletRosterMixin`
- `WalletIterationMixin`
- `WalletRetryScheduleMixin`
- `WalletSyncResultMixin`
- `WalletStatsMixin`

Каталог:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/wallet/`

## 12. Kafka и гарантия доставки

Topic:

`ch.wallet_stats_events.v1`

Событие имеет topic version 1 и row из шести полей:

1. bucket time;
2. observed time;
3. login;
4. wallet minor;
5. currency ID;
6. iteration ID.

Envelope:

- `v` — schema version;
- `b` — batch ID;
- `r` — rows.

Файлы:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/clients/kafka/wallet/wallet_writer.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/clients/kafka/wallet/payload.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/wallet/envelope.py`

Producer:

- `acks="all"`;
- zstd compression;
- payload максимум 128 KiB;
- oversized batch режется на chunks;
- row order сохраняется;
- chunk IDs имеют суффикс `-0001`, `-0002`, …;
- одна строка, которая сама не помещается, вызывает ошибку;
- пустой список — terminal no-op.

Критически важно: запись не считается доставленной сразу после producer ack. `KafkaVisibilityWaiter` ждёт, пока committed offset injector consumer окажется после отправленного offset. Только после этого PostgreSQL получает `stats_synced_at`.

Если visibility wait упал:

- соответствующая страница не помечается synced;
- следующий daemon cycle повторно отправит pending событие;
- downstream рассчитан на идемпотентность/замещение.

## 13. Crash recovery и pending backlog

Success сначала сохраняется в PostgreSQL, затем событие отправляется Kafka. Поэтому падение между этими операциями не теряет данные.

`flush_pending_stats`:

- читает pending rows страницами по 1000;
- отправляет страницу;
- ждёт Kafka visibility;
- bulk-помечает только подтверждённую страницу;
- повторяет до пустого результата.

Batch IDs:

`wallet-pending-<unix timestamp>-p000001`

Если daemon упал после PostgreSQL success, но до Kafka confirmation:

- при рестарте iteration `running` станет `failed`;
- pending event восстановится из `wallet_sync_state`;
- после подтверждения Kafka `complete_ready_iterations` может завершить старую итерацию, если `processed_count >= expected_count`.

Ограничение модели: `wallet_sync_state` содержит только одно текущее pending событие на login. Новая успешная запись того же login заменяет предыдущие event-поля. Нормальный daemon защищает от этого, всегда flush-ая pending до новой работы, но это не полноценный append-only outbox.

## 14. Retry и ошибки

Категории:

- отсутствующая/невалидная auth session;
- transport timeout/connect/read/protocol errors;
- HTTP status кроме 200;
- HTTP 429 / активный proxy cooldown;
- HTML parse error;
- неожиданная account-level ошибка;
- iteration/system-level ошибка.

Python defaults:

- controlled/unexpected failure retry — 30 секунд;
- rate limit defer — 60 секунд.

Rust:

- `failure_retry_seconds = 30`;
- proxy cooldown/retry согласно production config — 600 секунд.

Retry count означает число последовательных failures и сбрасывается после success. Экспоненциального backoff нет: задержки фиксированы по категории.

Python `WalletAnomalyObserver` отделяет controlled failures от unexpected и iteration failures, применяет threshold/cooldown перед повторной отправкой в observability. Тесты отдельно требуют, чтобы обычный 429 не отправлялся в Sentry как unexpected exception.

Если iteration loop получает непредусмотренную ошибку:

- ошибка логируется/наблюдается;
- Python daemon делает паузу 30 секунд;
- затем снова начинает цикл с pending recovery.

В Rust runtime error поднимается до process exit, после чего container restart policy запускает сервис заново.

## 15. ClickHouse и статистика

Raw table:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000003_wallet_stats_events.sql`

`superbot.wallet_stats_events`:

- `ReplacingMergeTree(observed_at)`;
- partition по месяцу;
- primary key `(login, bucket_at)`;
- order `(login, bucket_at, iteration_id)`.

Это позволяет повторной доставке одного snapshot заменить старую версию по `observed_at`.

Daily aggregation:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000011_wallet_daily_without_final.sql`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000013_wallet_daily_two_day_window.sql`

Refresh каждые 15 минут. Для каждого `(period_date, login)` выбирается последний wallet через `argMax(..., observed_at)`, затем балансы суммируются по валюте.

Бизнес-день сдвинут на один час:

`period_date = toDate(bucket_at - INTERVAL 1 HOUR)`

Текущая версия пересчитывает ограниченное двухдневное окно — предыдущий и текущий статистический день.

Источник статистики:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/clickhouse/stats/summary.py`

## 16. Конвертация валют

Синхронизатор сам баланс не конвертирует. Он сохраняет:

- сумму в minor units исходной валюты;
- `currency_id`.

USD-конвертация выполняется позже:

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/use_cases/stats/wallet_conversion.py`

`StatsUsdSummaryReader.fetch_wallet_daily_snapshot`:

- получает daily snapshots по всем валютам;
- для каждой currency загружает `inverse_conversion_rate`;
- считает `Decimal(wallet_minor) * inverse_rate`;
- округляет до целого minor unit по `ROUND_HALF_UP`;
- складывает wallet total и day difference;
- возвращает currency ID `1` — USD.

Для USD rate равен 1. При отсутствии курса выбрасывается `StatsCurrencyRateMissing`; silent fallback отсутствует.

Связанные rate repository/ports:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/postgres/currency/rates.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/ports/currency/rates.py`

## 17. Граничные случаи

Зафиксированные поведением и тестами случаи:

- пустой roster всё равно допускает full iteration с expected count 0;
- empty retry не создаёт iteration;
- full due всегда приоритетнее retries;
- missing full schedule означает немедленный full;
- inactive login не выбирается для retry;
- retry roster ограничен 1000 строками и сортируется по `next_attempt_at, login`;
- shutdown во время workers не публикует частичный Kafka batch;
- account-level failure не отменяет остальные аккаунты;
- system/store failure не подавляется;
- worker completion order не влияет на event order;
- пустой Kafka event list — no-op;
- недоставленная Kafka page не помечается synced;
- marker rate limit предотвращает HTTP-запрос;
- marker устанавливается до release proxy lock;
- перезапуск инвалидирует незавершённые running iterations;
- повторная доставка raw events предполагается безопасной благодаря batch visibility и ClickHouse replacement semantics;
- отрицательный wallet запрещён PostgreSQL constraint;
- topic codec проверяет точное число полей, типы и диапазоны Int64/Int32/UInt64.

## 18. Тесты как спецификация

Основные contract suites:

### Основной flow

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_ng_contracts.py`

Проверяет:

- парсинг JPY и responsive HTML;
- minor-unit semantics;
- ClickHouse codec;
- PostgreSQL success до Kafka handoff;
- отсутствие partial commit при shutdown;
- сохранение roster order;
- pending flush;
- sleep scheduling;
- singleton/thin entrypoint.

### Scheduler

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_scheduler_contracts.py`

Проверяет:

- full/retry schema;
- due index shape;
- full priority;
- retry только failed active users;
- отсутствие пустой retry iteration;
- wake minimum;
- отсутствие roster sync в retry;
- retry не двигает full schedule.

### Failure semantics

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_failure_contracts.py`

Проверяет:

- consecutive retry count;
- изоляцию user errors;
- recovery pending после iteration error;
- propagation system errors;
- 429 без Sentry noise;
- observer threshold/cooldown;
- marker ordering;
- HTTP skip при active cooldown.

### Kafka backlog/delivery

`/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_backlog_contracts.py`

Проверяет:

- exact envelope bytes;
- chunking и порядок;
- malformed/oversize validation;
- visibility по committed offset;
- stop после visibility error;
- lifecycle producer/admin;
- page-by-page pending acknowledgement;
- bounded reads и bulk marks;
- bulk roster upsert/deactivate.

Дополнительно runtime inventory и отсутствие legacy imports проверяются в:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/runtime/test_runtime_entrypoints_inventory_contracts.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/runtime/test_ng_no_legacy_imports.py`

## 19. Взаимодействие с другими модулями

- **Auth**: предоставляет active logins, live cookies, proxy и state version.
- **Proxy lock registry**: сериализует Steam requests по proxy.
- **Redis**:
  - live auth snapshots;
  - distributed rate-limit cooldown.
- **PostgreSQL**:
  - roster;
  - iteration lifecycle;
  - current wallet state;
  - retry schedule;
  - recoverable pending handoff.
- **Kafka**: транспорт raw wallet events.
- **ClickHouse injector**: декодирует envelope и пишет `wallet_stats_events`.
- **Stats**: строит daily wallet snapshots и day-over-day difference.
- **Currency sync/rates**: предоставляет курсы для USD conversion.
- **Telegram stats**: downstream-потребитель итоговых агрегатов.
- **Sentry/observer**: startup, unexpected, repeated и system anomalies.

## 20. Наиболее важные архитектурные выводы

1. Источник истины для оперативного состояния и восстановления — PostgreSQL `wallet_sync_state`; ClickHouse хранит исторические события.
2. Доставка построена как PostgreSQL-first recoverable handoff, а не как атомарная транзакция PostgreSQL+Kafka.
3. Full schedule и retry schedule независимы; retries не откладывают регулярный полный snapshot.
4. Баланс собирается только в ожидаемой валюте JPY, но schema и статистика поддерживают несколько currency IDs.
5. Ограничение нагрузки двухуровневое: global account concurrency и per-proxy lock/cooldown.
6. Production runtime — Rust, тогда как Python NG-контур и contract tests служат подробной исполняемой спецификацией той же логики.
7. Между Python и Rust есть заметное расхождение cooldown: 60 секунд в Python client против 600 секунд в production `config.toml`.
</response>

Agent ID: c73f7fc7-468a-4af5-bd3a-276b18c6050f (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](c73f7fc7-468a-4af5-bd3a-276b18c6050f)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](c73f7fc7-468a-4af5-bd3a-276b18c6050f#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](c73f7fc7-468a-4af5-bd3a-276b18c6050f#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](c73f7fc7-468a-4af5-bd3a-276b18c6050f#desktop)` only when the agent used computer use)