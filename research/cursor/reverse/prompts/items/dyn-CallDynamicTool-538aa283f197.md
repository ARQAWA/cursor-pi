<!-- 704ada44-4cb2-422b-9af3-5b380ba360a9 CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать загрузку ClickHouse","prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Пользователь просит исключительно статическое исследование, без запуска, сборки или исполнения кода и без изменений в репозитории. Исследуй модуль загрузки аналитики в ClickHouse (clickhouse injector/stats ingestion) максимально подробно для самостоятельного русскоязычного отчёта о бизнес-логике: источники событий (sales history, wallet, возможно другие), Kafka topics/envelopes, consumer groups, декодирование/валидация/chunking/buffering/flush, ClickHouse таблицы/движки/ключи/версии/идемпотентность, offset commit semantics, visibility/checkpoints, retry/failure/progress guards, конфигурация, materialized views и аналитические потребители, recovery и конкурентность. Просмотри Python/Rust/migrations/tests/config файлы через чтение/поиск. Ничего не запускай и не редактируй. В финале верни подробный структурированный конспект с точными путями, с отдельным описанием бизнес-смысла и технического транспорта, различиями реализаций и неопределённостями.","subagent_type":"generalPurpose","model":"inherit","run_in_background":false}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Статически исследованы Python/Rust injector, Kafka producers/visibility, ClickHouse migrations/views, источники sales history и wallet, checkpoints, recovery, аналитические consumers и тестовые контракты. Выявлены ключевые различия активной Rust-реализации и Python-стека, а также риски terminal commit после ошибок и конфигурационная неопределённость ClickHouse URL.
</user_visible_high_level_summary>
<response>
# Отчёт: загрузка аналитики в ClickHouse

Исследование выполнено исключительно статически: код не запускался, не собирался и не изменялся.

## 1. Архитектура потока

Основной транспорт:

```text
Steam sales history ─┐
                     ├─ Kafka ─ clickhouse-injector ─ ClickHouse raw tables
Wallet Steam page ───┘                                  │
                                                        ├─ sales facts
                                                        ├─ daily rollups
                                                        └─ stats Telegram/API readers
```

Ключевые компоненты:

- Injector:
  - Python: `src/superbot_ng/workers/clickhouse_injector/`
  - Rust: `rust/services/clickhouse_injector/src/main.rs`
- Kafka producers:
  - Sales: `src/superbot_ng/clients/kafka/sales_history/`
  - Wallet: `src/superbot_ng/clients/kafka/wallet/`
  - Rust-аналоги: `rust/services/sales_history/src/kafka.rs`, `rust/services/wallet_sync/src/kafka.rs`
- ClickHouse schema:
  - `migrations/clickhouse/000002_sales_history_events.sql`
  - `migrations/clickhouse/000003_wallet_stats_events.sql`
  - `migrations/clickhouse/000004_stats_foundation.sql`
  - последующие migrations `000005`–`000013`
- Аналитические readers:
  - Python: `src/superbot_ng/repositories/clickhouse/stats/`
  - Rust: `rust/services/stats_telegram/src/daemon.rs`

---

# 2. Источники бизнес-событий

## 2.1. Sales history

Источник — история рынка Steam, получаемая постранично.

Основной код:

- `src/superbot_ng/use_cases/sales_history/sync_raw.py`
- `src/superbot_ng/use_cases/sales_history/sync_page.py`
- `rust/services/sales_history/src/raw_sync.rs`
- `rust/services/sales_history/src/steam_client.rs`

Параметры:

- размер страницы: `500` событий;
- Python допускает до `200000` страниц: `src/superbot_ng/use_cases/sales_history/constants.py`;
- Rust ограничен `500` страницами: `rust/services/sales_history/src/raw_sync.rs`;
- периодическая синхронизация аккаунтов — каждые `900` секунд;
- конкурентность аккаунтов — `12`.

Каждое событие содержит:

1. login;
2. event ID;
3. тип BUY/SELL;
4. timestamp события;
5. долю timestamp;
6. appid;
7. hashname товара;
8. buy price;
9. listing price;
10. sell price;
11. transaction ID;
12. profit;
13. source currency ID;
14. state version.

Модель описана в:

- `src/superbot_ng/domain/sales_history/events.py`
- `rust/services/sales_history/src/model.rs`

### Бизнес-смысл

Raw sales history — это не окончательная прибыль. Сначала события поступают в ClickHouse в необработанном или частично обработанном виде:

- BUY обычно содержит цену покупки;
- SELL может ещё не иметь transaction ID и profit;
- последующий marking сопоставляет SELL с BUY;
- после marking SELL получает `transaction_id`, `profit` и `state_version = 2`.

## 2.2. Marking sales history

Marking выполняется повторной записью тех же логических событий с более высокой версией.

### App 753

Код:

- `src/superbot_ng/use_cases/sales_history/marking_753.py`
- `rust/services/sales_history/src/marking.rs`

Логика:

- выбираются необработанные SELL;
- для каждого товара формируется потребность в BUY;
- выбираются BUY-кандидаты с положительной ценой;
- BUY сортируются по цене покупки по убыванию;
- SELL сопоставляется с подходящим BUY;
- создаётся `transaction_id = buy_event_id + sell_event_id`;
- `profit = sell_price - buy_price`.

Размер marking-окна:

- `10000` строк;
- Kafka marking chunks — до `5000` строк.

### App 440

Код:

- `src/superbot_ng/use_cases/sales_history/marking_440.py`
- `rust/services/sales_history/src/marking.rs`

Для 440:

- BUY и SELL не сопоставляются попарно;
- BUY получает transaction ID собственного события и profit `0`;
- SELL получает собственный transaction ID;
- для whitelist-товаров profit равен `sell_price`;
- для остальных profit равен `0`.

Whitelist задаётся в:

- `src/superbot_ng/platform/settings/tf2.py`;
- Rust-реализация имеет собственный список в `rust/services/sales_history/src/daemon.rs`.

Наблюдается потенциальная зона рассинхронизации: список TF2 hashname присутствует и в Python, и отдельно в Rust.

## 2.3. Wallet

Источник — Steam wallet balance через страницу add-funds.

Код:

- Python:
  - `src/superbot_ng/workers/wallet/fetch_event.py`
  - `src/superbot_ng/workers/wallet/iteration.py`
  - `src/superbot_ng/pipelines/wallet/codec.py`
- Rust:
  - `rust/services/wallet_sync/src/daemon.rs`
  - `rust/services/wallet_sync/src/model.rs`

Событие содержит:

- `bucket_at` — временной bucket итерации;
- `observed_at` — момент фактического наблюдения;
- login;
- wallet balance в minor units;
- currency ID;
- iteration ID.

Wallet balance сначала фиксируется в PostgreSQL:

- `migrations/postgres/000007_wallet_sync.sql`;
- `src/superbot_ng/repositories/postgres/wallet/`.

Затем отправляется в Kafka. После подтверждения Kafka visibility PostgreSQL-состояние помечается как synced.

### Бизнес-смысл

В ClickHouse хранится не каждая попытка запроса как бизнес-факт, а последняя известная величина кошелька пользователя для конкретного bucket. Дневной rollup затем:

1. выбирает последнее наблюдение каждого login;
2. складывает balances;
3. группирует по currency ID.

---

# 3. Kafka topics и envelopes

## 3.1. Topics

Настройки:

`src/superbot_ng/platform/settings/kafka.py`

```text
ch.sales_history_events.v2
ch.wallet_stats_events.v1
```

Параметры:

| Topic | Версия | Partition count | Retention |
|---|---:|---:|---:|
| `ch.sales_history_events.v2` | 2 | 16 | 1 день / 256 MB |
| `ch.wallet_stats_events.v1` | 1 | 4 | 1 день / 64 MB |

Конфигурация topics:

- `_scripts/kafka_topics.py`
- `docker-compose.infra.yml`

Replication factor равен `1`, Kafka — single-node KRaft.

## 3.2. Sales envelope

Формат:

```json
{
  "v": 2,
  "b": "batch-id",
  "r": [
    [
      "login",
      "event-id",
      1,
      123,
      0,
      753,
      "hashname",
      100,
      0,
      0,
      "",
      0,
      8,
      1
    ]
  ]
}
```

- `v = 2`;
- `b` — batch ID;
- `r` — массив 14-польных строк;
- BUY = `1`;
- SELL = `2`;
- raw state version = `1`;
- marked state version = `2`.

Проверки:

- envelope должен иметь ровно `v`, `b`, `r`;
- версия должна быть `2`;
- rows не должен быть пустым;
- каждая строка должна иметь ровно 14 полей;
- числовые поля проверяются на диапазоны ClickHouse;
- пустые или неизвестные поля запрещаются.

Python:

- `src/superbot_ng/domain/sales_history/envelopes.py`
- `src/superbot_ng/domain/sales_history/events.py`
- native codec: `src/superbot_ng/pipelines/sales_history/native.py`

Rust:

- `rust/services/sales_history/src/codec.rs`
- `rust/services/sales_history/src/model.rs`

## 3.3. Wallet envelope

Формат:

```json
{
  "v": 1,
  "b": "wallet-iteration",
  "r": [
    [
      "2026-05-11 10:00:00.000",
      "2026-05-11 10:00:00.001",
      "login",
      123400,
      8,
      7
    ]
  ]
}
```

Row содержит 6 полей:

1. bucket timestamp;
2. observed timestamp;
3. login;
4. wallet minor units;
5. currency ID;
6. iteration ID.

Проверки Python:

- `src/superbot_ng/pipelines/wallet/codec.py`

Проверки Rust:

- `rust/services/clickhouse_injector/src/main.rs`
- `rust/services/wallet_sync/src/model.rs`

## 3.4. Kafka keys

Sales:

- key = login;
- `src/superbot_ng/clients/kafka/sales_history/payload.py`.

Wallet:

- key = batch ID;
- `src/superbot_ng/clients/kafka/wallet/payload.py`.

Это влияет на partitioning, но injector buffers сообщения отдельно по topic и не выполняет собственную межпартиционную упорядоченную обработку.

---

# 4. Chunking и producer buffering

## 4.1. Sales chunking

Sales payload limit:

```text
512 KiB
```

Настройка:

- `src/superbot_ng/platform/settings/runtime.py`
- `config.toml`
- `rust/services/sales_history/src/kafka.rs`

Chunking учитывает размер полного JSON envelope, включая суффиксированный batch ID:

```text
batch-id-0001
batch-id-0002
```

Если одна строка больше максимального размера, отправка завершается ошибкой.

Raw history:

- page encoder: `src/superbot_ng/pipelines/sales_history/envelope.py`;
- native implementation: `_superbot_native`;
- Rust: `rust/services/sales_history/src/codec.rs`.

Marking дополнительно ограничивает размер chunk по количеству строк:

```text
5000 rows per chunk
```

## 4.2. Wallet chunking

Wallet payload limit:

```text
128 KiB
```

Chunking:

- `src/superbot_ng/pipelines/wallet/envelope.py`;
- `rust/services/wallet_sync/src/model.rs`.

При невозможности вместить даже одну строку выдаётся ошибка.

## 4.3. Injector buffering

На каждый topic создаётся отдельный buffer:

- Python: `src/superbot_ng/pipelines/clickhouse_injector/buffer.py`;
- Rust: `Buffer` в `rust/services/clickhouse_injector/src/main.rs`.

Flush происходит при любом условии:

```text
1000 Kafka messages
2 MiB raw Kafka payloads
2 секунды с первого сообщения
```

Важное свойство: sales и wallet buffers независимы. Flush sales не коммитит offset wallet.

При остановке выполняется принудительный flush всех buffers.

---

# 5. ClickHouse injector

## 5.1. Consumer group

Используется одна consumer group:

```text
superbot-clickhouse-injector
```

Настройки:

- auto commit выключен;
- `auto.offset.reset = earliest`;
- max poll records — `1000` в Python;
- topics — sales и wallet.

Python:

- `src/superbot_ng/workers/clickhouse_injector/service.py`.

Rust:

- `rust/services/clickhouse_injector/src/main.rs`.

Одновременно запускается только один локальный экземпляр благодаря lock file:

- Python entrypoint: `aClickHouseInjector.py`;
- Rust lock: `config.toml`, `/run/superbot/clickhouse_injector.lock`;
- контейнер: `docker-compose.app.yml`.

## 5.2. Decode

Injector преобразует Kafka envelope в `JSONEachRow` для ClickHouse.

Sales row преобразуется примерно в:

```json
{
  "login": "u",
  "event_id": "e",
  "event_type": "BUY",
  "time_event": 1,
  "time_event_fraction": 0,
  "appid": 753,
  "hashname": "A",
  "buy_price": 10,
  "listing_price": 0,
  "sell_price": 0,
  "transaction_id": "",
  "profit": 0,
  "source_currency_id": 8,
  "state_version": 1
}
```

Insert SQL:

- `src/superbot_ng/repositories/clickhouse/sales_history/insert_sql.py`;
- Rust inline SQL в `rust/services/clickhouse_injector/src/main.rs`.

Protocol:

```text
HTTP POST
FORMAT JSONEachRow
```

Python HTTP client:

- timeout connect `2s`;
- read/write `30s`;
- transient retry — до 3 попыток;
- retry sleep — `0.25 * attempt`.

Код:

`src/superbot_ng/repositories/clickhouse/sales_history/events.py`.

Rust injector:

- timeout connect `2s`;
- общий timeout `30s`;
- в отличие от Python, явный retry ClickHouse HTTP-запросов в injector отсутствует.

## 5.3. Validation behavior

Если batch decode не удался:

1. batch разбирается по одному Kafka message;
2. валидные сообщения записываются;
3. ошибочные сообщения отправляются в Sentry;
4. offsets всего исходного batch коммитятся.

Если ClickHouse insert не удался:

1. ошибка фиксируется;
2. marked payload fingerprint запоминается;
3. Kafka offsets всё равно коммитятся.

---

# 6. Offset commit semantics

## 6.1. Общий принцип

Для каждого `(topic, partition)` коммитится максимальный offset сообщения плюс единица.

Python:

`src/superbot_ng/workers/clickhouse_injector/commit.py`

Rust:

`offsets()` в `rust/services/clickhouse_injector/src/main.rs`.

Пример:

```text
sales partition 0: offsets 4, 6 -> commit 7
sales partition 1: offset 8 -> commit 9
```

## 6.2. Когда offset коммитится

Offset коммитится после:

- успешного ClickHouse insert;
- пустого encoded batch;
- ошибки decode;
- ошибки ClickHouse insert;
- невалидного Kafka value.

То есть semantics — не классический at-least-once с бесконечным retry. Фактически:

```text
attempt insert
record failure
commit Kafka offset
```

Это означает terminal drop при ряде ошибок.

Rust прямо маркирует recovery action как:

```text
terminal_drop_and_commit
```

## 6.3. Retry commit

Сам Kafka commit retry-ится бесконечно, пока:

- commit не удастся;
- не будет остановки процесса.

Интервал retry:

```text
10 секунд
```

Python использует `consumer.commit(offsets)`.

Rust использует synchronous commit:

```text
CommitMode::Sync
```

## 6.4. Невалидный Kafka value

Если Kafka message payload отсутствует или имеет неправильный тип:

1. текущий buffer того же topic force-flush;
2. ошибка фиксируется;
3. invalid message коммитится;
4. offsets невалидного сообщения не пересекаются с offsets другого topic.

---

# 7. Progress guard и blocked marked payloads

Особая логика применяется к sales payloads, в которых все строки имеют:

- 14 полей;
- `state_version = 2`.

Для такого payload вычисляется SHA-256 только массива rows, без batch ID.

Код:

- Python: `src/superbot_ng/workers/clickhouse_injector/progress_guard.py`;
- Rust: `marked_fingerprint()` в injector.

Если marked payload ранее был отклонён из-за ClickHouse или encode error:

- повтор этого же логического payload, даже с другим batch ID, считается повторным blocker;
- injector пишет ошибку `repeated_marked_payload`;
- ждёт остановки оператора;
- не кодирует и не коммитит offset этого сообщения.

Fingerprint cache:

```text
1024 entries
```

Это guard против бесконечного продвижения поверх невалидной marked-версии. Он также означает, что состояние guard:

- in-memory;
- теряется после рестарта;
- ограничено 1024 fingerprints;
- не является долговременным DLQ или persistent quarantine.

---

# 8. ClickHouse raw tables

## 8.1. `sales_history_events`

Файл:

`migrations/clickhouse/000002_sales_history_events.sql`

Движок:

```text
ReplacingMergeTree(state_version)
```

Основные поля:

- login;
- event ID;
- enum BUY/SELL;
- event timestamp;
- appid;
- hashname;
- prices;
- transaction ID;
- profit;
- source currency ID;
- state version.

Партиционирование:

```text
toYYYYMM(event_date)
```

Primary key:

```text
(login, event_type, appid, hashname_hash, time_event)
```

ORDER BY дополнительно включает:

```text
time_event_fraction, event_id
```

### Идемпотентность

Идемпотентность достигается не Kafka batch ID, а `ReplacingMergeTree` и `state_version`.

Практический смысл:

- raw row с version 1;
- marked row с той же логической сущностью и version 2;
- запросы marking используют `FINAL`;
- более новая state version должна вытеснить старую после merge/FINAL.

Однако:

- Kafka может доставить duplicate envelopes;
- ClickHouse insert не использует explicit deduplication token;
- физическое удаление дублей зависит от ReplacingMergeTree merge или `FINAL`;
- batch ID не записывается в таблицу и не участвует в дедупликации.

## 8.2. `wallet_stats_events`

Файл:

`migrations/clickhouse/000003_wallet_stats_events.sql`

Движок:

```text
ReplacingMergeTree(observed_at)
```

Primary key:

```text
(login, bucket_at)
```

ORDER BY:

```text
(login, bucket_at, iteration_id)
```

Партиционирование:

```text
toYYYYMM(event_date)
```

### Идемпотентность

Для одного login и bucket более позднее `observed_at` должно заменить более раннее наблюдение.

`iteration_id` входит в ORDER BY, но не в primary key. Это позволяет хранить несколько физических версий, которые затем схлопываются через ReplacingMergeTree/`FINAL` либо через `argMax`.

---

# 9. Materialized views и rollups

## 9.1. `stats_sales_facts`

Файл:

`migrations/clickhouse/000004_stats_foundation.sql`

Движок:

```text
ReplacingMergeTree(state_version)
```

Ключ:

```text
(metric, event_date, login, event_id)
```

## 9.2. Sales facts MV

Файлы:

- `000005_stats_sales_facts_mv.sql`;
- переработка в `000007_stats_440_profit_metric.sql`;
- currency extension в `000010_stats_sales_currency.sql`.

MV выбирает только:

- SELL;
- непустой `transaction_id`;
- appid `753` или `440`.

Metric:

```text
appid = 753 -> 753_profit
appid = 440 -> 440_profit
```

Amount:

```text
profit
```

Не `sell_price`.

Дата:

```text
toDate(time_event UTC - 1 hour)
```

Это реализует бизнес-день с границей в 01:00 UTC.

`source_currency_id` переходит в `currency_id`.

### Важное следствие

Raw SELL без transaction ID не попадает в sales facts. Поэтому статистика считается только по marked transactions.

## 9.3. Daily sales rollup

Таблица:

```text
stats_sales_daily
```

MV:

```text
stats_sales_daily_refresh_mv
```

Текущая версия:

`migrations/clickhouse/000012_stats_sales_daily_currency_key.sql`

Refresh:

```text
каждые 15 минут
```

Группировка:

```text
metric, period_date, currency_id
```

Сохраняются:

- сумма amount;
- количество source rows;
- максимальный source event timestamp;
- built_at;
- state_version.

MV читает `stats_sales_facts FINAL`.

Окно пересчёта:

```text
от stats_today - 1 день
до stats_today включительно
```

Это позволяет исправлять запоздалые marked events и учитывать границу бизнес-дня.

## 9.4. Wallet daily rollup

Таблица:

```text
stats_wallet_daily
```

MV:

```text
stats_wallet_daily_refresh_mv
```

Текущая версия:

`migrations/clickhouse/000013_wallet_daily_two_day_window.sql`

Refresh:

```text
каждые 15 минут
```

Алгоритм:

1. выбрать wallet events за окно двух соседних статистических дней;
2. для каждой пары `(period_date, login)` взять:
   - `argMax(wallet_minor, observed_at)`;
   - `argMax(currency_id, observed_at)`;
   - `max(observed_at)`;
3. сложить значения по `(period_date, currency_id)`.

В отличие от ранней версии `000006`, текущая `000013` не использует `FINAL` на raw wallet table. Это компенсируется `argMax` по `observed_at`, но физические дубли всё равно могут существовать до merge.

---

# 10. Аналитические потребители

## 10.1. Python readers

Код:

- `src/superbot_ng/repositories/clickhouse/stats/summary.py`
- `src/superbot_ng/repositories/clickhouse/stats/summary_sales.py`

Sales reader читает только:

```text
stats_sales_daily FINAL
```

Raw tables напрямую не читаются.

Wallet reader читает только:

```text
stats_wallet_daily FINAL
```

Дневная разница wallet:

```text
today wallet - previous day wallet
```

Если предыдущего дня нет, difference равна нулю.

## 10.2. Currency conversion

Суммы хранятся в исходной валюте, а конвертация выполняется на чтении.

Python:

- `src/superbot_ng/use_cases/stats/wallet_conversion.py`
- `src/superbot_ng/use_cases/stats/summary.py`

Rust:

- `rust/services/stats_telegram/src/daemon.rs`.

Currency rates берутся из PostgreSQL `currency_rates`.

Бизнес-метрики:

- общий amount;
- profit 753;
- profit 440;
- wallet total;
- wallet day delta.

## 10.3. Telegram

Rust consumer:

`rust/services/stats_telegram/src/daemon.rs`

Периодический запуск:

- минуты `10`, `25`, `40`, `55` каждого часа;
- статистический день = UTC время минус 1 час;
- live message редактируется;
- предыдущий день архивируется.

Состояние Telegram находится в PostgreSQL:

`migrations/postgres/000011_stats_telegram_state.sql`

Старое ClickHouse state удалено:

`migrations/clickhouse/000008_drop_stats_telegram_state.sql`

---

# 11. Visibility и checkpoints

## 11.1. Kafka visibility

После отправки Kafka producer получает:

- topic;
- partition;
- produced offset;
- batch ID;
- row count.

Далее producer проверяет committed offset consumer group `superbot-clickhouse-injector`.

Условие visibility:

```text
committed_offset > produced_offset
```

Это означает, что injector не только получил message, но и закоммитил offset после обработки.

Python:

- `src/superbot_ng/clients/kafka/visibility/waiter.py`
- `src/superbot_ng/clients/kafka/visibility/admin.py`

Rust:

- `rust/services/sales_history/src/visibility.rs`
- `rust/services/wallet_sync/src/kafka.rs`

### Почему visibility важна

Sales marking нельзя безопасно выполнять сразу после отправки raw events. Сначала raw rows должны быть:

1. опубликованы Kafka;
2. прочитаны injector;
3. записаны ClickHouse;
4. offset injector должен быть committed.

Только после этого marking читает raw данные из ClickHouse.

## 11.2. Sales checkpoints

Python filesystem checkpoints:

- `src/superbot_ng/repositories/filesystem/sales_history/checkpoint_store.py`;
- `src/superbot_ng/pipelines/sales_history/checkpoint_codec.py`;
- каталог из `config.toml`: `/var/lib/superbot/sales-history/checkpoints`.

Rust:

- `rust/services/sales_history/src/checkpoint.rs`.

Checkpoint хранит:

- cycle ID;
- базовый cursor;
- текущую страницу;
- start offset;
- page index;
- rows;
- новый cursor;
- affected sell keys;
- raw Kafka checkpoint;
- phase;
- stop reason;
- rate-limit retry timestamp.

Файлы append-only JSONL, с fsync.

При незавершённом последнем JSONL line он отбрасывается при recovery.

## 11.3. Sync phases

Основные фазы:

```text
raw_running
raw_sent
raw_visible
marking
marked_sent
failed
```

Cursor в PostgreSQL обновляется только после:

- raw visibility;
- marking;
- отправки marked events;
- marked visibility.

Это предотвращает продвижение курсора при незавершённой аналитической загрузке.

---

# 12. Recovery, retry и конкурентность

## 12.1. Sales recovery

При падении после отправки raw Kafka:

- checkpoint указывает последний обработанный page;
- при рестарте raw ingestion продолжает с сохранённой страницы;
- cursor не считается завершённым, пока marking не завершён;
- повторная отправка возможна, но ClickHouse рассчитан на replacement по state version.

При rate limit:

- checkpoint сохраняет `retry_at`;
- login откладывается;
- обычный retry может занимать до одного часа в Rust runtime;
- Python constants также содержат короткий runtime retry `30s`, но фактические ветки зависят от coordinator.

## 12.2. Wallet recovery

Wallet PostgreSQL state содержит:

- iteration ID;
- stats observed;
- stats synced;
- retry count;
- next attempt;
- last error.

Перед новой итерацией pending wallet events повторно отправляются:

- Python: `src/superbot_ng/workers/wallet/pending.py`;
- Rust: `flush_pending()` в `rust/services/wallet_sync/src/daemon.rs`.

Порядок:

1. получить pending;
2. отправить Kafka;
3. дождаться injector committed offset;
4. пометить PostgreSQL rows как synced.

## 12.3. ClickHouse recovery

Есть два разных класса поведения:

### Ошибка Kafka commit

Retry бесконечный с интервалом 10 секунд. Сообщения остаются логически не подтверждёнными.

### Ошибка decode или ClickHouse insert

Обычно:

1. ошибка фиксируется;
2. payload считается обработанным для Kafka;
3. offset коммитится.

Это предотвращает остановку всей очереди на одной плохой записи, но допускает потерю аналитических данных. Исключение — повторный marked payload, который блокирует progress guard до ручной остановки.

## 12.4. Конкурентность

- Sales account sync: 12;
- sales raw workers: 12;
- marking workers: 4;
- transcode workers: 2;
- wallet sync workers: 12;
- ClickHouse HTTP connection pool: до 16 connections Python;
- Kafka injector — один процесс через lock file.

Raw и marking разделены фазами:

```text
raw ingestion -> Kafka visibility -> marking -> Kafka visibility -> cursor commit
```

---

# 13. Различия Python и Rust

## 13.1. Injector

### Python

Файлы:

- `src/superbot_ng/workers/clickhouse_injector/service.py`
- `codec.py`
- `flush.py`
- `commit.py`
- `progress_guard.py`

Особенности:

- использует `aiokafka`;
- decode sales выполняется через `_superbot_native` в thread;
- wallet decode реализован Python;
- ClickHouse HTTP имеет retry transient network errors;
- ошибки сохраняются с tar-архивом Kafka payloads;
- offsets коммитятся через async Kafka API.

### Rust

Файл:

`rust/services/clickhouse_injector/src/main.rs`

Особенности:

- `rdkafka`;
- decode реализован напрямую через `serde_json`;
- один исходный batch при ошибке изолируется по сообщениям;
- ClickHouse HTTP insert не имеет аналогичного Python retry;
- failure context стандартизирован через `superbot_observability`;
- payload archive в коде injector отсутствует;
- offsets коммитятся synchronous commit;
- compile-time constants topics совпадают с Python.

## 13.2. Sales producer

Python:

- native encoding через `_superbot_native`;
- async transcoder на `ThreadPoolExecutor`;
- filesystem checkpoint store.

Rust:

- native Rust codec;
- `spawn_blocking`;
- Rust checkpoint store;
- Rust visibility waiter.

## 13.3. Wallet producer

Python:

- `WalletKafkaWriter`;
- visibility через Admin API;
- `argMax`-совместимые timestamp rows.

Rust:

- producer ждёт committed offset через отдельный `BaseConsumer`;
- visibility polling выполняется через blocking task;
- wallet send и visibility выполняются последовательно для каждого chunk.

## 13.4. Существенная разница в visibility

Python Admin API удаляет target, когда:

```text
committed > target
```

Rust делает то же самое.

Но Python имеет специальный preflight:

- получает metadata;
- получает end offsets;
- строит targets `end_offset - 1`;
- используется для drain перед force bootstrap reset.

Rust drain сравнивает committed offsets с high watermark.

---

# 14. Bootstrap и полная пересборка

Force bootstrap:

`src/superbot_ng/entrypoints/sales_history/bootstrap_runner.py`

Порядок:

1. дождаться drain sales topic;
2. truncate ClickHouse `sales_history_events`;
3. truncate PostgreSQL sales cursors;
4. заново загрузить историю.

Если Kafka metadata или drain wait завершается ошибкой, truncate не выполняется. Это явно закреплено тестом:

`tests/contracts/runtime/test_ng_kafka_visibility_shutdown_contracts.py`.

Статистический bootstrap:

- `cStatsBootstrap.py`;
- `src/superbot_ng/repositories/clickhouse/stats/sales_bootstrap.py`;
- SQL в `sales_bootstrap_facts_sql.py` и `sales_bootstrap_daily_sql.py`.

Порядок:

1. truncate `stats_sales_daily`;
2. truncate `stats_sales_facts`;
3. заново построить facts из raw events `FINAL`;
4. построить daily rollup;
5. сравнить source и target counts/sums.

---

# 15. Конфигурация и инфраструктура

## Python settings

- `src/superbot_ng/platform/settings/kafka.py`
- `src/superbot_ng/platform/settings/clickhouse.py`
- `src/superbot_ng/platform/settings/runtime.py`

## Runtime TOML

`config.toml`

Injector:

```toml
[clickhouse]
url = "http://127.0.0.1:8123"
database = "superbot"

[clickhouse_injector]
bootstrap_servers = "kafka:9094"
group_id = "superbot-clickhouse-injector"
lock_file = "/run/superbot/clickhouse_injector.lock"
```

## Инфраструктура

`docker-compose.infra.yml`:

- ClickHouse HTTP наружу на `127.0.0.1:18123`;
- Kafka host listener `127.0.0.1:29092`;
- internal listener Kafka `kafka:9094`;
- ClickHouse persistent bind mount;
- Kafka persistent bind mount;
- single-node Kafka;
- ClickHouse memory limit `2 GB`;
- Kafka memory limit `512 MB`.

Application:

`docker-compose.app.yml`

Injector запускается как:

```text
/app/clickhouse-injector
```

---

# 16. Тестовые контракты

Основной injector contract:

`tests/contracts/clickhouse_injector/test_offset_commit_contracts.py`

Проверяется:

- сохранение topic/partition/offset в buffer;
- вычисление следующего offset;
- независимость sales и wallet buffers;
- flush перед invalid Kafka commit;
- retry Kafka commit;
- ClickHouse error с последующим commit;
- изоляция плохих payload;
- отсутствие commit для повторного marked blocker;
- bounded Sentry archive;
- пропуск пустого encoded batch.

Wire contracts:

- `tests/contracts/sales_history/test_sales_history_wire_contracts.py`
- `tests/contracts/wallet/test_wallet_ng_contracts.py`

Stats contracts:

- `tests/contracts/stats/test_stats_ng_foundation_contracts.py`

Infra contracts:

- `tests/contracts/infra/test_clickhouse_infra_contracts.py`

Тесты подтверждают, что текущий замысел системы — это:

- raw/facts separation;
- marked sells only в profit facts;
- daily rollups через refreshable MVs;
- чтение аналитики только из rollup tables;
- currency-aware aggregation;
- PostgreSQL ownership для Telegram delivery state.

---

# 17. Неопределённости и потенциальные риски

## 17.1. Несовпадение ClickHouse URL

`src/superbot_ng/platform/settings/clickhouse.py`:

```text
http://127.0.0.1:18123
```

`config.toml`:

```text
http://127.0.0.1:8123
```

Контейнерный injector использует TOML и обращается к `127.0.0.1:8123`. В Docker-сети это выглядит подозрительно: ClickHouse — отдельный контейнер, а не localhost injector-контейнера.

Возможны варианты:

- config предназначен для host/network namespace с особой маршрутизацией;
- runtime configuration в образе отличается;
- это статическая конфигурационная ошибка.

По коду нельзя окончательно установить, какой URL используется в production image.

## 17.2. Python и Rust находятся в переходном состоянии

Dockerfile собирает и запускает Rust binaries:

```text
/app/clickhouse-injector
/app/sales-history
/app/wallet-sync
```

Но Python injector и Python producers всё ещё присутствуют и активно покрыты тестами.

Следовательно, repository содержит:

- Python reference/legacy-compatible stack;
- Rust production stack;
- тесты обоих контрактов.

Нужно осторожно трактовать Python как фактически исполняемый production code: Docker deployment указывает на Rust binary.

## 17.3. Terminal commit после ClickHouse error

При ошибке ClickHouse injector обычно коммитит Kafka offset. Это сознательно предотвращает бесконечный poison-message loop, но создаёт риск потери строки.

Persistent DLQ не обнаружен.

Sentry archive помогает диагностике, но не является механизмом автоматического replay.

## 17.4. Дедупликация не основана на batch ID

Batch ID:

- валидируется;
- хранится только в `EncodedClickHouseBatch`/checkpoint;
- не записывается в ClickHouse raw tables.

Дедупликация опирается на ClickHouse sorting key и `state_version`, а не на Kafka envelope ID.

## 17.5. Marked fingerprint cache непостоянен

После рестарта injector забывает rejected fingerprints. Это может позволить повторно принимать тот же неисправный marked payload и снова коммитить его после ошибки.

## 17.6. Refreshable MV semantics зависят от ClickHouse версии

Migrations используют:

```text
REFRESH EVERY 15 MINUTE
SYSTEM WAIT VIEW
```

Это требует ClickHouse с поддержкой refreshable materialized views. В compose закреплена версия `26.3.9.8`, но поведение при частично применённых migrations или старой существующей schema зависит от migration state.

## 17.7. Rust и Python списки TF2 whitelist дублируются

Список manual sale hashnames существует отдельно в:

- Python settings;
- Rust `daemon.rs`.

Тесты подтверждают Python contract и отдельный Rust count, но единого источника истины для обоих runtime не видно.

## 17.8. Wallet rollup без `FINAL`

Последняя migration `000013_wallet_daily_two_day_window.sql` специально убрала `FINAL`. Корректность рассчитывается через `argMax(observed_at)`, но:

- промежуточные дубли физически остаются;
- результат зависит от корректности observed timestamps;
- поведение отличается от sales rollup, который читает facts `FINAL`.

## 17.9. Kafka retention ограничена одним днём

Topics настроены на retention около 24 часов. Если injector будет недоступен дольше retention, Kafka replay уже невозможен. В таком случае восстановление потребует:

- повторного sales bootstrap;
- wallet pending state из PostgreSQL;
- либо внешнего восстановления raw events.

## 17.10. Offset visibility не означает бизнес-завершение всего sales cycle

Kafka committed offset означает, что конкретный envelope прошёл injector. Для sales cursor окончательное завершение наступает позднее — после marking и marked visibility. Это две разные checkpoint-модели:

```text
Kafka injector checkpoint
vs.
per-account sales-history cycle checkpoint
```

Их нельзя смешивать в operational monitoring.


</response>

Agent ID: ea8b526b-8ec2-4949-8154-9af2a3be8065 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](ea8b526b-8ec2-4949-8154-9af2a3be8065)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](ea8b526b-8ec2-4949-8154-9af2a3be8065#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](ea8b526b-8ec2-4949-8154-9af2a3be8065#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](ea8b526b-8ec2-4949-8154-9af2a3be8065#desktop)` only when the agent used computer use)