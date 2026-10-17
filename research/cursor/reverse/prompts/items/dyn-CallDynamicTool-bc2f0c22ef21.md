<!-- 38083b08-c794-4bbf-8868-e3cdfc302d4a CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать историю продаж","subagent_type":"explore","model":"inherit","run_in_background":false,"prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Только read-only research: категорически не изменять файлы, не запускать/не собирать/не исполнять код, не запускать тесты. Исследуй модуль «история продаж» торгового бота максимально тщательно (very thorough). Найди все относящиеся файлы, входные точки, модели, зависимости, вызовы, конфигурацию, фоновые процессы и тесты как спецификацию. Подготовь подробное самодостаточное описание бизнес-логики на русском: данные на входе/выходе, полный поток, состояния, фильтры, дедупликация, ошибки, граничные случаи, взаимодействие с БД/API и другими модулями. Приводи точные пути и названия сущностей в своем исследовательском ответе для проверки родительским агентом."}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Провёл read-only исследование Python- и Rust-реализаций, хранилищ, Kafka/Steam интеграций, фонового планировщика, конфигурации и контрактных тестов истории продаж. Файлы не изменялись, код и тесты не запускались.
</user_visible_high_level_summary>
<response>
Ниже — результат статического read-only исследования. Файлы не изменялись, код, сборка и тесты не запускались.

## 1. Назначение модуля

Модуль «история продаж» выполняет два последовательных этапа:

1. Raw sync:
   - получает историю операций Steam Community Market для каждого аккаунта;
   - разбирает покупки и продажи;
   - превращает их в нормализованные события;
   - отправляет события в Kafka;
   - сохраняет прогресс и точки возобновления.

2. Marking:
   - после попадания raw-событий в ClickHouse сопоставляет продажи с покупками;
   - вычисляет `buy_price`, `sell_price`, `profit`, `transaction_id`;
   - отправляет в Kafka обновлённые версии событий;
   - только после завершения marking фиксирует основной cursor аккаунта.

Таким образом, Postgres управляет прогрессом, Steam является источником, Kafka — транспортом, ClickHouse — фактическим event store и источником для marking/аналитики.

## 2. Основные входные точки

### Постоянный daemon

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aSalesHistorySync.py`
  - `main()`
  - захватывает `FileLock("sales_history")`;
  - вызывает `superbot_ng.entrypoints.sales_history.run_daemon`;
  - инициализирует Sentry;
  - обрабатывает `AlreadyRunning`, `ExpectedShutdown`, `KeyboardInterrupt`;
  - тот же lock исключает одновременную работу daemon и bootstrap.

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/entrypoints/sales_history/daemon.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/sales_history/daemon.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/sales_history/daemon_runner.py`

### Ручной bootstrap/backfill

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/cSalesHistoryBootstrap.py`
  - `--force` очищает историю и cursors перед полным rebuild;
  - вызывает `run_bootstrap(force=...)`;
  - использует тот же `FileLock("sales_history")`.

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/entrypoints/sales_history/bootstrap.py`
- вспомогательные компоненты:
  - `bootstrap_raw.py`
  - `bootstrap_user.py`
  - `bootstrap_queue.py`
  - `bootstrap_runner.py`
  - `bootstrap_pipeline.py`
  - `bootstrap_pipeline_start.py`
  - `bootstrap_pipeline_tasks.py`
  - `bootstrap_errors.py`
  - `bootstrap_connect_errors.py`
  - `bootstrap_response_errors.py`
  - `bootstrap_types.py`

### Production service

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/docker-compose.app.yml`
  - сервис `sales_hist`;
  - команда `/app/sales-history`;
  - `restart: unless-stopped`;
  - read-only root filesystem;
  - persistent volumes:
    - `/var/lib/superbot/sales-history` — checkpoints;
    - `/var/log/superbot` — Steam response artifacts;
    - `/run/superbot` — runtime lock/state.

### Rust-реализация

Отдельный production-oriented сервис находится в:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/`
  - `src/main.rs`
  - `src/bootstrap.rs`
  - `src/daemon.rs`
  - `src/raw_sync.rs`
  - `src/steam_client.rs`
  - `src/steam_session.rs`
  - `src/codec.rs`
  - `src/model.rs`
  - `src/cursor.rs`
  - `src/checkpoint.rs`
  - `src/kafka.rs`
  - `src/clickhouse.rs`
  - `src/marking.rs`
  - `src/marking_runtime.rs`
  - `src/visibility.rs`
  - `src/config.rs`

Python-контрактные тесты и native regression-тесты показывают, что wire format и marking должны оставаться идентичными между Python/native/Rust путями.

## 3. Центральные use cases

Главный публичный фасад:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/use_cases/sales_history/sync.py`
  - `market_history_sync(...)`
  - `sync_user_once(...)`
  - `sync_user_raw_once(...)`
  - `finish_sales_history_marking(...)`

Полный аккаунтный цикл реализован в:

- `use_cases/sales_history/sync_user.py`
  - `sync_user_raw_once()`:
    1. вызывает `start_raw_cycle`;
    2. определяет предыдущий cursor;
    3. при первом sync использует bootstrap cutoff;
    4. запускает raw history sync;
    5. вызывает `finish_raw_cycle`.
  - `sync_user_once()`:
    1. выполняет raw;
    2. если raw вернул строковый terminal result — завершает аккаунт;
    3. иначе получает `SalesHistoryMarkingJob`;
    4. выполняет marking;
    5. возвращает `"synced"`.

## 4. Входные данные

Для одного аккаунта используются:

- `NgSteamUser`:
  - `login`;
  - `currency_id`;
  - Steam-сессионные/auth данные косвенно через auth cache и cookie registry.
- `CookieJar`.
- предыдущий `SalesHistoryCursor`;
- optional filesystem checkpoint;
- `stop_event`;
- настройки Kafka, Postgres, ClickHouse, Redis/proxy/auth;
- первый bootstrap ограничен:
  - `BOOTSTRAP_CUTOFF_TS = 2026-01-01 UTC`.

Константы:

- `/src/superbot_ng/use_cases/sales_history/constants.py`
  - `HISTORY_PAGE_SIZE = 500`;
  - `HISTORY_MAX_PAGES = 200000`;
  - `RUNTIME_RETRY_SECONDS = 30`;
  - `AUTH_REQUIRED_STOP_REASON = "auth_required"`.

## 5. Получение данных из Steam

Клиентские файлы:

- `/src/superbot_ng/clients/steam/sales_history/client.py`
- `/src/superbot_ng/clients/steam/sales_history/fetch.py`
- `/src/superbot_ng/clients/steam/sales_history/retry.py`
- `/src/superbot_ng/clients/steam/sales_history/parser.py`
- `/src/superbot_ng/clients/steam/sales_history/parser_myhistory.py`
- `/src/superbot_ng/clients/steam/sales_history/parser_ids.py`
- `/src/superbot_ng/clients/steam/sales_history/errors.py`
- `/src/superbot_ng/clients/steam/sales_history/artifacts.py`
- `/src/superbot_ng/clients/steam/sales_history/sentry_policy.py`
- `/src/superbot_ng/clients/steam/sales_history/constants.py`

`fetch_myhistory_render(start, count, stop_event)` обращается к Steam `myhistory/render`, по 500 записей.

Параметры страницы:
- `start`: смещение;
- `count`: ограничивается максимумом `HISTORY_PAGE_BATCH_LIMIT = 500`.

Парсер:
- разбирает JSON ответа;
- извлекает `events`, `listings`, `assets`;
- строит стабильный `_id` через `unique_history_id(time_event, time_event_fraction, listingid)`;
- разрешает `market_hash_name` через listing asset или fallback asset;
- URL-encode имени выполняется `urllib.parse.quote`;
- типичный default asset context — app `753`, context `6`.

Ответ, похожий на Steam login page, классифицируется как необходимость повторной авторизации, а не нормальная пустая история.

## 6. Raw flow по страницам

Основная реализация:

- `/src/superbot_ng/use_cases/sales_history/sync_raw.py`
- `/src/superbot_ng/use_cases/sales_history/sync_page.py`
- `/src/superbot_ng/use_cases/sales_history/sync_page_context.py`
- `/src/superbot_ng/use_cases/sales_history/sync_page_progress.py`
- `/src/superbot_ng/use_cases/sales_history/sync_page_send.py`
- `/src/superbot_ng/use_cases/sales_history/sync_page_logs.py`

Алгоритм:

1. Создаётся `RawSyncState`:
   - новый: `start=0`, `page_index=0`, пустой `MarketHistoryState`;
   - resumed: продолжает с checkpoint offset и page index.

2. Если resumed-state уже имеет `stop_reason`, запрос к Steam не выполняется: возвращается готовый успешный результат.

3. Открывается `AsyncSteamHistoryClient`.

4. На каждой странице:
   - проверяется `stop_event`;
   - запрашивается Steam;
   - при `success=false` возвращается unsuccessful `SyncResult`;
   - первая запись первой обработанной страницы формирует новый cursor;
   - страница кодируется `SalesHistoryPageTranscoder`;
   - encoded chunks отправляются в Kafka;
   - только после Kafka ack вызывается `commit_page_progress`;
   - вычисляется stop reason;
   - увеличиваются processed count и offset.

5. Если достигнут `HISTORY_MAX_PAGES`, результат:
   - `success=False`;
   - `stop_reason="max_pages"`.

## 7. Условия остановки и фильтрация

Синхронизация прекращается при одном из условий:

- пустая/неполная страница;
- встречен предыдущий cursor `(time_event, time_event_fraction)`;
- достигнут `time_cutoff` при первичном bootstrap;
- Steam вернул ошибочный page payload;
- auth required;
- достигнут max pages;
- остановка процесса;
- rate limit переводит работу в deferred state, а не завершает цикл.

Точный выбор stop reason находится в:
- `/src/superbot_ng/use_cases/sales_history/sync_page_logs.py`, `page_stop_reason(...)`.

Фильтрация предыдущих записей производится во время page encoding: `previous_cursor_key` передаётся в `SalesHistoryPageEncodeRequest`. Это предотвращает повторную отправку уже зафиксированного хвоста истории, хотя семантика хранения остаётся дополнительно идемпотентной.

## 8. Модели и состояния

### `SalesHistoryEvent`

Файл:
- `/src/superbot_ng/domain/sales_history/events.py`

Поля:
- `login`;
- `event_id`;
- `event_type`: только `1` BUY или `2` SELL;
- `time_event`, `time_event_fraction`: UInt32;
- `appid`: UInt32;
- `hashname`;
- `buy_price`, `listing_price`, `sell_price`: Int64;
- `transaction_id`;
- `profit`: Int64;
- `source_currency_id`: положительный Int32;
- `state_version`: только 1 или 2.

Wire row содержит строго 14 полей. Extra fields запрещены Pydantic-моделью.

Ключ события:
- `(time_event, time_event_fraction, event_id)`.

Market key:
- `(appid, hashname)`.

### `SalesHistoryCursor`

Файл:
- `/src/superbot_ng/domain/sales_history/cursor.py`

Содержит:
- login;
- latest event ID;
- timestamp;
- timestamp fraction.

### Результаты и envelope

- `/src/superbot_ng/domain/sales_history/results.py`
- `/src/superbot_ng/domain/sales_history/envelopes.py`
- `/src/superbot_ng/domain/sales_history/constants.py`

`SyncResult` несёт:
- `success`;
- число обработанных событий;
- новый cursor;
- affected sell keys;
- stop reason;
- raw Kafka checkpoint.

### Runtime state

- `/src/superbot_ng/use_cases/sales_history/sync_state.py`

Сущности:
- `MarketHistoryState`;
- `RawSyncState`;
- `SalesHistoryRawResumeState`;
- `SalesHistoryRawWorkItem`;
- `SalesHistoryRawDeferredItem`;
- `SalesHistoryMarkingJob`;
- `SalesHistoryRawRateLimitDefer`.

`MarketHistoryState` агрегирует:
- `processed`;
- candidate cursor;
- affected market keys;
- stop reason;
- последний Kafka checkpoint.

## 9. Кодирование и Kafka

Pipeline:

- `/src/superbot_ng/pipelines/sales_history/types.py`
- `/src/superbot_ng/pipelines/sales_history/events.py`
- `/src/superbot_ng/pipelines/sales_history/envelope.py`
- `/src/superbot_ng/pipelines/sales_history/codec.py`
- `/src/superbot_ng/pipelines/sales_history/native.py`
- `/src/superbot_ng/pipelines/sales_history/transcoding.py`
- `/src/superbot_ng/pipelines/sales_history/checkpoint_codec.py`
- `/src/superbot_ng/pipelines/sales_history/checkpoint_records.py`
- `/src/superbot_ng/pipelines/sales_history/sync_meta.py`

`SalesHistoryPageTranscoder`:
- переносит CPU-heavy native encoding в `ThreadPoolExecutor`;
- формирует chunks с ограничением по размеру payload;
- возвращает encoded chunks, число строк и affected sell keys;
- имеет явный `aclose()`.

Kafka:
- `/src/superbot_ng/clients/kafka/sales_history/sales_history_writer.py`
- `/src/superbot_ng/clients/kafka/sales_history/payload.py`
- `/src/superbot_ng/clients/kafka/sales_history/operations.py`
- `/src/superbot_ng/clients/kafka/sales_history/types.py`

Writer возвращает `KafkaSendCheckpoint`, отражающий подтверждённый Kafka handoff. Отправка stop-aware и имеет retry/backpressure поведение.

Kafka topic provisioning:
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/_scripts/kafka_topics.py`.

## 10. ClickHouse ingestion и дедупликация

Запись Kafka → ClickHouse выполняет отдельный процесс:

- `/src/superbot_ng/workers/clickhouse_injector/service.py`
- `/src/superbot_ng/workers/clickhouse_injector/codec.py`
- `/src/superbot_ng/workers/clickhouse_injector/flush.py`
- `/src/superbot_ng/workers/clickhouse_injector/commit.py`

Это принципиально: sales-history producer не пишет raw события напрямую в ClickHouse.

Таблица:

- `/migrations/clickhouse/000002_sales_history_events.sql`

`superbot.sales_history_events` использует:

- `ReplacingMergeTree(state_version)`;
- partition по месяцу события;
- sort key:
  - login,
  - event type,
  - appid,
  - hashname hash,
  - event time,
  - fraction,
  - event ID.

Дедупликация/версионирование:
- одно логическое событие повторно публикуется с тем же ключом;
- более новая `state_version` заменяет старую;
- raw и marked варианты тем самым являются версиями одной записи;
- физическое схлопывание ReplacingMergeTree асинхронно, поэтому marking queries должны учитывать latest-state semantics.

ClickHouse repository:
- `/src/superbot_ng/repositories/clickhouse/sales_history/events.py`
- `/src/superbot_ng/repositories/clickhouse/sales_history/insert_sql.py`.

## 11. Marking продаж

Оркестрация:

- `/src/superbot_ng/use_cases/sales_history/marking.py`
- `/src/superbot_ng/use_cases/sales_history/sync_marking.py`
- `/src/superbot_ng/use_cases/sales_history/marking_queries.py`
- `/src/superbot_ng/use_cases/sales_history/marking_rows.py`
- `/src/superbot_ng/use_cases/sales_history/marking_buy_candidates.py`
- `/src/superbot_ng/use_cases/sales_history/marking_writer.py`
- `/src/superbot_ng/use_cases/sales_history/marking_control.py`

Marking запускается только после raw Kafka handoff и ожидания видимости raw событий в ClickHouse через:
- `KafkaVisibilityWaiter`;
- checkpoint/offset target из `pipelines/sales_history/sync_meta.py`.

### App 753

- `/src/superbot_ng/use_cases/sales_history/marking_753.py`

Алгоритм:
1. загрузить unmarked SELL;
2. сгруппировать потребность по `(appid, hashname)`;
3. загрузить подходящие BUY candidates;
4. native-функцией `mark_sales_history_753` сопоставить покупки и продажи;
5. сформировать marked chunks;
6. отправить их в Kafka;
7. дождаться видимости;
8. повторять до отсутствия unmarked sells.

Счётчики:
- `marked_sells`;
- `matched_pairs`;
- `unmatched_sells`.

Сопоставление ограничено тем же market key. Порядок и точные правила native marking закреплены regression-тестами.

### App 440

- `/src/superbot_ng/use_cases/sales_history/marking_440.py`

Отдельная политика для app 440:
1. сначала загружаются unmarked SELL;
2. если их нет, BUY query вообще не выполняется;
3. затем загружаются BUY;
4. вызывается `mark_sales_history_440`;
5. применяется `settings.TF2_MANUAL_SALE_HASHNAMES`.

Счётчики:
- `marked_440_buys`;
- `marked_440_sells`;
- `full_profit_440_sells`;
- `marked_sells`;
- `unmatched_sells`.

Marked chunks ограничены 5000 строками и Kafka max payload bytes.

## 12. Cursor, commit и crash consistency

Postgres schema:

- `/migrations/postgres/000001_sales_history_cursors.sql`
- `/migrations/postgres/000002_sales_history_sync_meta.sql`

`sales_history_cursors`:
- один ряд на login;
- latest event cursor;
- `last_synced_at`;
- `next_sync_at`;
- `retry_until`;
- `retry_count`;
- `sync_meta JSONB`.

Репозиторий:
- `/src/superbot_ng/repositories/postgres/sales_history/cursor_store.py`
- `cursor_roster.py`
- `cursor_meta.py`
- `cursor_retry.py`
- `cursor_json.py`.

Жизненный цикл:
- `/src/superbot_ng/use_cases/sales_history/sync_cycle.py`
- `/src/superbot_ng/use_cases/sales_history/sync_user_meta.py`.

Порядок commit принципиален:

1. Сохраняется `previous_cursor`.
2. `sync_meta` переводится в raw-running.
3. Raw страницы отправляются в Kafka.
4. После ack сохраняются page checkpoints.
5. Raw завершение записывается как raw-sent.
6. Выполняется marking.
7. Marked сообщения становятся видимы в ClickHouse.
8. Только после этого основной cursor окончательно продвигается и checkpoint удаляется.

Если marking падает, checkpoint сохраняется. Это предотвращает потерю raw данных и преждевременное продвижение cursor.

`sync_meta` обновляется атомарным shallow JSON merge, что отдельно закреплено repository contracts.

## 13. Filesystem checkpoints

Файлы:

- `/src/superbot_ng/repositories/filesystem/sales_history/checkpoint_store.py`
- `checkpoint_file.py`
- `checkpoint_mapping.py`
- `/src/superbot_ng/ports/sales_history/checkpoints.py`
- `/src/superbot_ng/use_cases/sales_history/checkpoint_state.py`

Checkpoint содержит:
- `cycle_id`;
- base cursor;
- page progress;
- resume state;
- Kafka checkpoint;
- rate-limit deadline;
- итог raw stage.

Свойства:
- append/replay model;
- частично записанный хвост игнорируется и обрезается;
- полностью повреждённый checkpoint отвергается с безопасным fallback;
- несовпадение `cycle_id` или base cursor удаляет stale checkpoint;
- checkpoint пишется после Kafka ack;
- file permissions проверяются тестами;
- raw-done checkpoint позволяет после рестарта не делать повторный Steam request.

## 14. Фоновая координация

Файлы:

- `/src/superbot_ng/workers/sales_history/daemon_coordinator.py`
- `daemon_coordinator_loop.py`
- `daemon_coordinator_state.py`
- `daemon_pipeline.py`
- `daemon_pipeline_state.py`
- `daemon_raw.py`
- `daemon_raw_errors.py`
- `daemon_marking.py`
- `daemon_schedule.py`
- `daemon_compat.py`

Основные свойства:
- continuous coordinator выбирает due logins из Postgres;
- ограничивает число одновременных account slots;
- контракт фиксирует максимум 12;
- raw и marking разделены очередью;
- slot аккаунта удерживается до marking commit и удаления checkpoint;
- deferred 429 освобождает слот для другого аккаунта;
- marking worker продолжает жить после ошибки отдельного аккаунта;
- shutdown отменяет account и marking tasks;
- аккаунты без auth snapshot откладываются без фиктивного Postgres retry;
- отсутствие proxy приводит к skip/defer, а не небезопасному прямому запросу.

## 15. Rate limiting, retries и ошибки

### HTTP 429

Steam `429` преобразуется в:
- `SteamHistoryRateLimitDefer`;
- затем `SalesHistoryRawRateLimitDefer`.

Сохраняются:
- login;
- retry delay;
- точная `SalesHistoryRawResumeState`;
- artifact path;
- `Retry-After`.

Coordinator:
- сохраняет absolute retry deadline;
- восстанавливает оставшееся время после рестарта;
- повторный 429 заменяет старый deadline, не создавая duplicate deferred item;
- cookie jar сохраняется между defer/retry и следует актуальной auth version.

### Network/HTTP/response errors

- retry выполняется для контролируемых transient ошибок;
- request cooldown применяется и после network error;
- cooldown stop-aware;
- cooldown независим между аккаунтами;
- malformed/unexpected response shape может отправляться в Sentry;
- ожидаемые controlled response errors обычно не отправляются.

### Артефакты ответов

`artifacts.py` сохраняет полное тело проблемного Steam-ответа и очищает старые файлы. Это важно для:
- login page вместо JSON;
- серии 5xx;
- malformed body;
- диагностики 429.

Sentry policy:
- одинаковый auth-required report отправляется только после порога повторений;
- тесты фиксируют порог 5;
- пять одинаковых 5xx artifacts capture-ятся;
- смешанные 5xx не считаются одной повторяющейся ошибкой.

## 16. Выходные данные

На уровне raw:
- `SyncResult`;
- Kafka envelopes/chunks;
- filesystem checkpoint;
- обновлённый `sync_meta`;
- affected `(appid, hashname)` sell keys;
- candidate cursor.

На уровне полного аккаунтного цикла:
- строковый статус вроде `"synced"` или terminal reason;
- окончательно продвинутый Postgres cursor;
- versioned события в ClickHouse.

Marked event содержит:
- исходную идентичность события;
- цены покупки/листинга/продажи;
- transaction ID;
- profit;
- повышенный `state_version`.

## 17. Взаимодействие с другими модулями

- Auth:
  - `/src/superbot_ng/repositories/redis/auth/`
  - `/src/superbot_ng/clients/steam/`
  - загружает актуальные cookies/auth snapshot.

- Users:
  - `/src/superbot_ng/use_cases/users/`
  - `try_load_ng_steam_user_snapshot`.

- Proxy locking:
  - Steam request выполняется через инфраструктуру proxy lock;
  - cooldown начинается после получения lock.

- ClickHouse injector:
  - единственный write path из Kafka в таблицу истории.

- Stats:
  - читает продажи из ClickHouse:
    - `/src/superbot_ng/repositories/clickhouse/stats/sales_bootstrap_facts_sql.py`
    - `/src/superbot_ng/use_cases/stats/rollups.py`
    - migrations `000005`, `000007`, `000010`.
  - сам sales-history daemon намеренно не связан с Mongo или stats write path.

- Seller:
  - история и прибыль используются торговой аналитикой, но непосредственный seller workflow не является частью sales-history sync.

## 18. Конфигурация

Основные настройки находятся в:

- `/src/superbot_ng/platform/settings/__init__.py`
- `/src/superbot_ng/platform/settings/runtime.py`
- `/src/superbot_ng/platform/settings/kafka.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/libs/settings.py`
- `/rust/services/sales_history/src/config.rs`

Значимые параметры:
- Kafka brokers/topic/max payload bytes;
- raw/marking queue limits;
- coordinator concurrency;
- ClickHouse/Postgres endpoints;
- checkpoint/artifact directories;
- Steam request cooldown/retry;
- `TF2_MANUAL_SALE_HASHNAMES`;
- observability/Sentry;
- runtime lock paths.

## 19. Тесты как спецификация

Главная директория:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/sales_history/`

Особенно важны:

- `test_sales_history_sync_loop.py`
  - cursor commit только после Kafka handoff и marking;
  - enum filtering;
  - hashname-hash predicate;
  - skip marking при отсутствии новых строк.

- `test_sales_history_checkpoint_contracts.py`
  - replay page deltas;
  - восстановление rate-limit;
  - partial-tail recovery;
  - corruption fallback;
  - Kafka ack before checkpoint;
  - raw-done no-refetch;
  - cycle mismatch invalidation.

- `test_sales_history_continuous_coordinator_contracts.py`
  - concurrency cap 12;
  - 429 slot release;
  - deadline restore;
  - marking-before-delete;
  - failure checkpoint retention;
  - worker isolation;
  - cookie/auth continuity.

- `test_ng_steam_history_response_artifacts.py`
  - полное сохранение response body;
  - retries;
  - login-page detection;
  - cooldown;
  - 429 defer;
  - Sentry thresholds/policies.

- `test_native_codec_regression_contracts.py`
  - byte-exact envelopes;
  - порядок rows;
  - marking counters;
  - ClickHouse encoding.

- `test_sales_history_wire_contracts.py`
  - строго 14 полей;
  - только v2/current shape;
  - integer ranges;
  - запрет extra envelope fields.

- `test_sales_history_repository_contracts.py`
  - атомарность `sync_meta`.

- `test_sales_history_bootstrap_script.py`
  - manual async bootstrap;
  - отсутствие Mongo/stats coupling;
  - `--force`;
  - 429 resume;
  - non-force только для отсутствующих cursors.

- `test_phase1_history_sync_contracts.py`
  - Kafka → injector как единственный ClickHouse write path;
  - прямые зависимости NG stack;
  - enum names;
  - transient ClickHouse read retries.

- `test_sales_history_runtime_harness_contracts.py`
  - тонкая runtime wrapper;
  - continuous coordinator wiring;
  - no DB lease, используется file lock.

## 20. Существенные граничные случаи

- Пустая история: cursor не строится, marking/visibility может быть пропущен.
- Первая синхронизация: ограничивается датой 2026-01-01.
- Повторная синхронизация: останавливается на предыдущем cursor.
- Одинаковые timestamp/fraction: `event_id` остаётся частью полного event key.
- Не найден hashname: parser пытается fallback asset; невозможность разрешения влияет на нормализацию/фильтрацию.
- Повторная Kafka доставка: компенсируется стабильным event ID и `ReplacingMergeTree(state_version)`.
- Crash после Kafka ack: page checkpoint позволяет продолжить без потери прогресса.
- Crash после raw, до marking: raw-done checkpoint исключает повторный Steam fetch.
- Crash во время marking: cursor не продвигается, checkpoint остаётся.
- Stale checkpoint: отбрасывается по cycle/base cursor mismatch.
- Частично записанный checkpoint: валидный префикс replay-ится.
- 429: worker не спит, аккаунт откладывается и освобождает slot.
- Auth invalidation: контролируемый stop/defer с повторным получением auth snapshot.
- Max pages: считается неуспехом, а не молчаливо завершённой синхронизацией.
- Shutdown: код систематически проверяет `stop_event` и выбрасывает `ExpectedShutdown`.

## 21. Legacy и совместимость

Кроме NG-реализации существуют:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/modules/sales_history_sync.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/modules/sales_history_transactions.py`
- quarantined/old файлы под `__quarantine`.

Текущие архитектурные контракты явно закрепляют NG direct stack и Kafka/injector path. Legacy modules следует считать историческим/compatibility кодом, а не основным production flow.
</response>

Agent ID: ef8840e5-4218-4e69-9446-0cd436b242c0 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](ef8840e5-4218-4e69-9446-0cd436b242c0)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](ef8840e5-4218-4e69-9446-0cd436b242c0#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](ef8840e5-4218-4e69-9446-0cd436b242c0#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](ef8840e5-4218-4e69-9446-0cd436b242c0#desktop)` only when the agent used computer use)