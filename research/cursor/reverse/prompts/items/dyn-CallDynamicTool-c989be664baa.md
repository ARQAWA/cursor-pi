<!-- 38083b08-c794-4bbf-8868-e3cdfc302d4a CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать загрузку ClickHouse","subagent_type":"explore","model":"inherit","run_in_background":false,"prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Только read-only research: категорически не изменять файлы, не запускать/не собирать/не исполнять код, не запускать тесты. Исследуй модуль «загрузка аналитики в ClickHouse» / ClickHouse injector максимально тщательно (very thorough). Найди все файлы, entrypoints, consumer, codecs, batch/flush/commit, Kafka topics, таблицы и миграции, retry/rebalance/shutdown, dead-letter/ошибки, конфигурацию и тесты как спецификацию. Опиши на русском полностью самодостаточную бизнес-логику: какие аналитические потоки загружаются, формат событий, маршрутизация, гарантии доставки/дедупликации, offsets, обработка сбоев, связь с sales history и wallet. Приводи точные пути/сущности для проверки родительским агентом."}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Полностью прослежены оба аналитических потока — sales history и wallet — от Kafka-конвертов до ClickHouse-таблиц и производных daily/facts витрин. Зафиксированы фактические гарантии: terminal drop с commit при ошибках данных/insert, синхронный retry commit, ReplacingMergeTree-дедупликация и специальная блокировка повторного marked sales payload.
</user_visible_high_level_summary>
<response>
Исследование выполнено строго read-only, без запуска кода, сборки или тестов.

## Итоговая архитектура

В production используется Rust-сервис:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/clickhouse_injector/src/main.rs`
- crate: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/clickhouse_injector/Cargo.toml`
- Docker собирает бинарник `/app/clickhouse-injector`: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/Dockerfile`
- Compose запускает его как `clickhouse_injector`: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/docker-compose.app.yml`

Параллельно в репозитории сохранена практически эквивалентная Python-реализация, являющаяся важной исполняемой спецификацией:

- legacy entrypoint: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/aClickHouseInjector.py`
- async entrypoint: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/entrypoints/clickhouse_injector/runner.py`
- consumer loop: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/service.py`
- codec/router: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/codec.py`
- flush: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/flush.py`
- commit/failure isolation: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/commit.py`
- poison-progress guard: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/progress_guard.py`
- Sentry payload archive: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/failure.py`
- buffer types: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/clickhouse_injector/buffer.py`

## Аналитические потоки

### 1. Sales history

Kafka:

- topic `ch.sales_history_events.v2`
- 16 partitions по Python-конфигурации
- producer key — `login`, поэтому события аккаунта маршрутизируются стабильно в одну partition
- producer: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/clients/kafka/sales_history/payload.py`
- Rust producer contract: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/sales_history/src/kafka.rs`

Конверт строго:

```json
{"v":2,"b":"batch-id","r":[...]}
```

- `v` — версия, строго `2`
- `b` — непустой batch ID
- `r` — непустой массив строк в Rust injector; Python native codec задаёт фактический контракт
- допускается разбиение большого batch на `batch-id-0001`, `-0002` и т. д.
- реализация chunking: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/sales_history/envelope.py`

Строка содержит ровно 14 полей:

1. `login`
2. `event_id`
3. `event_type`: `1=BUY`, `2=SELL`
4. `time_event`
5. `time_event_fraction`
6. `appid`
7. `hashname`
8. `buy_price`
9. `listing_price`
10. `sell_price`
11. `transaction_id`
12. `profit`
13. `source_currency_id`
14. `state_version`: `1` или `2`

Полная доменная валидация и преобразование:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/domain/sales_history/events.py`
- native codec wrapper: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/sales_history/native.py`
- output — `JSONEachRow`, `event_type` преобразуется в `"BUY"`/`"SELL"`.

Назначение:

- `superbot.sales_history_events`
- insert contract: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/repositories/clickhouse/sales_history/insert_sql.py`
- таблица: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000002_sales_history_events.sql`

Таблица — `ReplacingMergeTree(state_version)`, сортировка заканчивается на `(time_event_fraction, event_id)`. Логическая замена версий определяется одинаковым `ORDER BY`-ключом; `state_version` выбирает актуальную запись во время merge/`FINAL`.

Связь с аналитикой продаж:

- materialized view читает только SELL (`event_type=2`)
- требует непустой `transaction_id`
- учитывает `appid IN (753, 440)`
- метрики: `753_profit` и `440_profit`
- `profit` становится `amount_minor`
- группировка сохраняет валюту `source_currency_id → currency_id`
- бизнес-день смещён на один час: `time_event UTC - INTERVAL 1 HOUR`

Файлы:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000005_stats_sales_facts_mv.sql`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000007_stats_440_profit_metric.sql`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000010_stats_sales_currency.sql`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000012_stats_sales_daily_currency_key.sql`

### 2. Wallet snapshots

Kafka:

- topic `ch.wallet_stats_events.v1`
- 4 partitions
- producer key — `batch_id`
- producer: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/clients/kafka/wallet/payload.py`
- Rust producer: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/wallet_sync/src/kafka.rs`

Конверт:

```json
{"v":1,"b":"batch-id","r":[...]}
```

Строка содержит ровно 6 полей:

1. `bucket_at`
2. `observed_at`
3. `login`
4. `wallet_minor`
5. `currency_id`
6. `iteration_id`

Контракты:

- модель: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/domain/wallet/models.py`
- envelope/chunking: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/wallet/envelope.py`
- ClickHouse codec: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/pipelines/wallet/codec.py`

Python codec проверяет datetime, непустой login и числовые диапазоны. Rust injector проверяет структуру и integer/string-типы, но менее строго валидирует диапазоны и datetime.

Назначение:

- `superbot.wallet_stats_events`
- таблица: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000003_wallet_stats_events.sql`
- `ReplacingMergeTree(observed_at)`
- логический ключ сортировки: `(login, bucket_at, iteration_id)`

Wallet daily:

- по каждому `period_date, login` выбираются `wallet_minor` и `currency_id` через `argMax(..., observed_at)`
- затем суммы строятся по `period_date, currency_id`
- бизнес-день также смещён на час
- текущая версия refresh view пересчитывает сегодня и предыдущий день каждые 15 минут
- итог: `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse/000013_wallet_daily_two_day_window.sql`

## Buffer, flush и offsets

Отдельный buffer на каждый topic. Условия flush:

- 1000 Kafka messages;
- 2 MiB сырых payload;
- возраст первого сообщения 2 секунды;
- либо принудительно при shutdown/invalid value.

Offsets вычисляются независимо для каждой `(topic, partition)` как:

`max(processed offset) + 1`

Sales flush не коммитит pending wallet offset и наоборот.

Kafka consumer:

- group `superbot-clickhouse-injector`
- `enable.auto.commit=false`
- `auto.offset.reset=earliest`
- подписан на оба topic
- production Rust consumer выполняет sync commit.

## Реальные гарантии доставки

Это не полноценный at-least-once pipeline. Фактическая политика ближе к **terminal drop-and-commit**:

1. Успешный insert → commit Kafka offset.
2. Невалидный payload → ошибка фиксируется, offset всё равно коммитится.
3. ClickHouse insert исчерпал HTTP-возможность → ошибка фиксируется, offset всё равно коммитится.
4. Kafka value отсутствует/не bytes → сначала принудительно flush предыдущего buffer той же темы, затем invalid offset коммитится.
5. Ошибка batch encode → batch изолируется по одному Kafka message:
   - валидные сообщения вставляются;
   - невалидные логируются;
   - затем коммитятся offsets всего исходного batch.
6. Ошибка commit → тот же точный набор offsets повторяется каждые 10 секунд до успеха или shutdown.

Следствие: события могут быть безвозвратно потеряны при malformed payload или окончательной ошибке ClickHouse. Отдельного Kafka DLQ нет.

Дубликаты возможны, если ClickHouse принял insert, но Kafka commit не состоялся и процесс перезапустился. Они сглаживаются движками `ReplacingMergeTree`, но:

- дедупликация ClickHouse асинхронна;
- без `FINAL` физические/видимые дубликаты могут временно сохраняться;
- уникальность определяется `ORDER BY`, не `batch_id`;
- `batch_id` не сохраняется в ClickHouse и не служит idempotency key.

## Специальный progress guard

Для sales payload, где **все строки имеют `state_version == 2`**, вычисляется SHA-256 от массива `rows`, без `batch_id`.

Если такой payload ранее был rejected из-за encode/insert failure и те же rows встречаются снова:

- injector не кодирует их;
- не пишет в ClickHouse;
- не коммитит offset;
- периодически сообщает `repeated_marked_payload`;
- фактически ждёт вмешательства оператора или shutdown.

Хранится только до 1024 fingerprints и только в памяти процесса. После рестарта память guard теряется. Для wallet такого механизма нет.

## Retry, rebalance и shutdown

Retry:

- Kafka consume error: пауза 1 секунда и повтор.
- Kafka offset commit: 10 секунд, без лимита до остановки.
- Python ClickHouse client повторяет только transient transport errors (`ReadError`, `ReadTimeout`, `RemoteProtocolError`) с линейной задержкой; настройки находятся в `/src/superbot_ng/platform/settings/clickhouse.py`.
- Rust ClickHouse client сам insert не повторяет и после ошибки коммитит offset.

Rebalance:

- специального rebalance listener/partition revocation flush нет ни в Rust, ни в Python.
- Это важный пробел: buffer хранится локально, а offsets вручную коммитятся после обработки; явной координации pending buffer с revoke нет.

Shutdown:

- Rust слушает SIGINT и SIGTERM через `CancellationToken`.
- После stop выполняет force flush всех непустых topic buffers.
- Однако commit retry прекращается при cancellation, поэтому shutdown-flush может записать данные в ClickHouse и не закрепить offset; после рестарта вероятна повторная доставка.
- Python устанавливает async stop handlers, force-flush выполняется после выхода из loop, затем закрываются consumer, ClickHouse HTTP client и logging.
- singleton Rust обеспечивается `lock_file`; Python legacy — `FileLock`.

## Ошибки и dead-letter

Kafka DLQ или отдельной ClickHouse reject-таблицы нет.

Python failure path:

- отправляет исключение в Sentry;
- прикладывает `kafka-payloads.tar`;
- внутри — точные бинарные payload и `manifest.json` с topic/partition/offset/size;
- сбой создания attachment или самого Sentry подавляется и не мешает commit.

Rust:

- формирует структурированный `FailureContext`;
- метит recovery как `terminal_drop_and_commit`, `retry`, `wait_for_operator` и т. п.;
- payload attachment в показанной Rust реализации отсутствует.

Ключевой файл Python:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/workers/clickhouse_injector/failure.py`

## Конфигурация

Rust runtime читает `/app/config.toml`, затем локальный `config.toml`:

- ClickHouse URL/database/user/password
- Kafka bootstrap servers
- consumer group
- singleton lock file
- optional Sentry

Основной файл:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/config.toml`

Python defaults:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/kafka.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/clickhouse.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/src/superbot_ng/platform/settings/runtime.py`

Инфраструктура:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/docker-compose.infra.yml`
- ClickHouse 26.3.9.8, HTTP 8123 наружу как localhost:18123
- Kafka 4.2.0 KRaft, internal `kafka:9094`, local `127.0.0.1:29092`
- Kafka log cleaner отключён.

## Миграции и downstream-таблицы

Полный порядок:

1. `000001_init_database.sql`
2. `000002_sales_history_events.sql`
3. `000003_wallet_stats_events.sql`
4. `000004_stats_foundation.sql`
5. `000005_stats_sales_facts_mv.sql`
6. `000006_stats_daily_refreshable_mv.sql`
7. `000007_stats_440_profit_metric.sql`
8. `000008_drop_stats_telegram_state.sql`
9. `000009_stats_refresh_offset.sql`
10. `000010_stats_sales_currency.sql`
11. `000011_wallet_daily_without_final.sql`
12. `000012_stats_sales_daily_currency_key.sql`
13. `000013_wallet_daily_two_day_window.sql`

Каталог:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/migrations/clickhouse`

Мигратор:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/_scripts/clickhouse_migrate.py`

Основные сущности:

- `superbot.sales_history_events`
- `superbot.wallet_stats_events`
- `superbot.stats_sales_facts`
- `superbot.stats_sales_daily`
- `superbot.stats_wallet_daily`
- `superbot.stats_sales_facts_mv`
- `superbot.stats_sales_daily_refresh_mv`
- `superbot.stats_wallet_daily_refresh_mv`

## Тесты как спецификация

Главный детальный контракт:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/clickhouse_injector/test_offset_commit_contracts.py`

Он фиксирует:

- next-offset semantics;
- независимость offsets разных topics;
- flush перед terminal commit invalid value;
- commit после ClickHouse failure;
- покомпонентную изоляцию bad payload;
- один Sentry event на bad message;
- payload archive;
- commit пустого encoded batch;
- marked fingerprint без batch ID;
- блокировку повторного marked payload без encode/commit;
- retry ровно тех же offsets.

Дополнительные спецификации:

- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/infra/test_clickhouse_infra_contracts.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/runtime/test_ng_kafka_visibility_shutdown_contracts.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/runtime/test_runtime_entrypoints_inventory_contracts.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/sales_history/test_sales_history_wire_contracts.py`
- `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/tests/contracts/wallet/test_wallet_ng_contracts.py`
- встроенные Rust tests в `/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/rust/services/clickhouse_injector/src/main.rs`

Главные операционные выводы: DLQ отсутствует; insert failure приводит к потере с commit; rebalance специально не обработан; дедупликация опирается на `ReplacingMergeTree`, а не на batch ID; единственный механизм остановки poison-progress действует только для повторных sales rows `state_version=2` и только в памяти процесса.
</response>

Agent ID: 7d5b3903-67da-4fd2-bcdf-3533cb0a1e47 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](7d5b3903-67da-4fd2-bcdf-3533cb0a1e47)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](7d5b3903-67da-4fd2-bcdf-3533cb0a1e47#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](7d5b3903-67da-4fd2-bcdf-3533cb0a1e47#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](7d5b3903-67da-4fd2-bcdf-3533cb0a1e47#desktop)` only when the agent used computer use)