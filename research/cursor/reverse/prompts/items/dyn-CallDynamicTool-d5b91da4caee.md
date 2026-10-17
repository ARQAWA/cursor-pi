<!-- 704ada44-4cb2-422b-9af3-5b380ba360a9 CallDynamicTool args: {"namespace":"cursor","toolName":"Subagent","arguments":{"description":"Исследовать историю продаж","prompt":"Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Пользователь просит исключительно статическое исследование, без запуска, сборки или исполнения кода и без изменений в репозитории. Исследуй модуль истории продаж (sales history) максимально подробно для самостоятельного русскоязычного отчёта о бизнес-логике: назначение, источники/приём данных, доменные модели, парсинг Steam, пагинация, курсоры/checkpoints, initial/backfill и incremental режимы, маркировка/классификация, Kafka/посредники, Postgres/filesystem, workers/daemons, ошибки/retry/idempotency/конкурентность, конфигурация, выходные события и связь с ClickHouse. Просмотри релевантные Python/Rust/migrations/tests/docs файлы через чтение/поиск. Ничего не запускай и не редактируй. В финале верни подробный структурированный конспект с точными путями файлов и отмечай выводы/неопределённости.","subagent_type":"generalPurpose","model":"inherit","run_in_background":false}} -->
This is the output of the subagent:

response:
<user_visible_high_level_summary>
Статическое исследование завершено: разобраны Python/Rust pipeline, Steam-парсинг, Kafka/ClickHouse, Postgres/filesystem state, bootstrap/incremental, marking, retries, конкурентность, конфигурация, миграции и контрактные тесты. Запусков и изменений не выполнял; в отчёте отмечу расхождения и неопределённости реализации.
</user_visible_high_level_summary>
<response>
# Отчёт по модулю Sales History

Исследование выполнено только чтением и поиском файлов. Код не запускался, не собирался и не изменялся.

## 1. Назначение

Модуль собирает историю покупок и продаж Steam Community Market, сохраняет её в ClickHouse и затем классифицирует сырые события:

- сопоставляет покупки и продажи;
- рассчитывает прибыль;
- помечает обработанные строки;
- предоставляет факты для статистики по Steam AppID 753 и TF2 AppID 440.

Основная архитектура:

```text
Steam Community Market
        ↓
sales-history daemon
        ↓
Kafka ch.sales_history_events.v2
        ↓
ClickHouse injector
        ↓
superbot.sales_history_events
        ↓
marking через ClickHouse + Kafka
        ↓
ReplacingMergeTree state_version=2
        ↓
stats_sales_facts / daily statistics
```

Ключевые точки входа:

- `aSalesHistorySync.py` — continuous daemon;
- `cSalesHistoryBootstrap.py` — ручной initial/backfill;
- `rust/services/sales_history/src/main.rs` — Rust service entrypoint;
- `src/superbot_ng/entrypoints/sales_history/`.

---

## 2. Источник данных и авторизация

### Источник

Используется Steam endpoint:

```text
GET https://steamcommunity.com/market/myhistory/render/
```

Параметры запроса:

- `query=""`;
- `start`;
- `count`;
- `norender=1`;
- `l=english`.

Реализация:

- Python: `src/superbot_ng/clients/steam/sales_history/fetch.py`;
- Rust: `rust/services/sales_history/src/steam_client.rs`.

Размер страницы ограничен 500 событиями:

- Python: `src/superbot_ng/clients/steam/sales_history/parser_ids.py`;
- Rust: `rust/services/sales_history/src/steam_client.rs`.

История запрашивается через proxy. Для одного proxy действует mutex/lock, чтобы параллельные аккаунты не отправляли Steam-запросы одновременно:

- Python: `src/superbot_ng/platform/proxy_lock/`;
- Rust: `rust/services/sales_history/src/steam_client.rs`, `SteamProxyLocks`.

### Auth

Активный roster берётся из PostgreSQL:

```sql
auth.credentials
WHERE active = true
  AND runtime_role = 'trading'
```

Файлы:

- `src/superbot_ng/repositories/postgres/auth/credentials.py`;
- `src/superbot_ng/use_cases/users/roster.py`;
- `rust/services/sales_history/src/main.rs`.

Живые cookies, proxy и currency ID читаются из Redis auth cache:

- Python: `src/superbot_ng/use_cases/users/runtime_user.py`;
- Rust: `rust/services/sales_history/src/daemon.rs`;
- Rust session: `rust/services/sales_history/src/steam_session.rs`.

Python дополнительно проверяет TTL `steamLoginSecure`: snapshot считается пригодным, если TTL больше `AUTH_TTL_THRESHOLD_SEC` (400 секунд):

- `src/superbot_ng/use_cases/users/runtime_user.py`;
- `src/superbot_ng/platform/settings/runtime.py`.

Для каждого auth state version используется соответствующий cookie jar:

- `src/superbot_ng/clients/steam/cookies.py` и связанные файлы;
- `src/superbot_ng/workers/sales_history/daemon_raw.py`;
- тест: `tests/contracts/sales_history/test_sales_history_continuous_coordinator_contracts.py`.

---

## 3. Steam response и парсинг

Steam response должен быть JSON с:

- `success`;
- `events`;
- `purchases`;
- `listings`;
- `assets`.

Python:

- `src/superbot_ng/clients/steam/sales_history/parser_myhistory.py`;
- `src/superbot_ng/clients/steam/sales_history/parser.py`.

Rust:

- `rust/services/sales_history/src/page.rs`.

### Типы Steam-событий

Steam event type:

- `4` — buy;
- `3` — sell.

Внутренний тип:

- `1` — BUY;
- `2` — SELL.

Константы:

- `src/superbot_ng/domain/sales_history/constants.py`;
- `rust/services/sales_history/src/model.rs`.

Другие Steam event type игнорируются.

### Event ID

ID формируется как:

```text
time_event + time_event_fraction padded to 9 digits + listingid
```

Например:

```text
1000000002L1
```

Python:

- `src/superbot_ng/clients/steam/sales_history/parser_ids.py`.

Rust:

- `rust/services/sales_history/src/page.rs`.

### Hashname

Для определения market hash name используется цепочка:

1. найти listing;
2. взять asset из listing;
3. определить `appid`, `contextid`;
4. попробовать `id`, затем `new_id`;
5. найти asset в `assets`;
6. извлечь `market_hash_name`;
7. URL-encode имени.

Fallback:

- для BUY — asset из purchase;
- для SELL — asset из listing.

Python:

- `src/superbot_ng/clients/steam/sales_history/parser.py`;
- `src/superbot_ng/use_cases/sales_history/...`.

Rust:

- `rust/services/sales_history/src/page.rs`;
- `native/superbot_native/src/lib.rs`.

Hashname хранится уже percent-encoded. Для поиска внутри ClickHouse используются одновременно:

```sql
hashname_hash = cityHash64(...)
AND hashname = ...
```

Это защищает от коллизий hash и обеспечивает точное сравнение.

### Денежные поля

BUY:

```text
buy_price =
    paid_amount
  + paid_fee
  + added_tax
```

SELL:

```text
listing_price = listing.original_price
sell_price     = purchase.received_amount
```

На raw-стадии:

- `transaction_id=""`;
- `profit=0`;
- `state_version=1`.

Реализация:

- Python native pipeline: `native/superbot_native/src/lib.rs`;
- Rust: `rust/services/sales_history/src/page.rs`.

---

## 4. Доменная модель и wire format

### SalesHistoryEvent

Файл:

- `src/superbot_ng/domain/sales_history/events.py`;
- Rust: `rust/services/sales_history/src/model.rs`.

Поля:

1. `login`;
2. `event_id`;
3. `event_type`;
4. `time_event`;
5. `time_event_fraction`;
6. `appid`;
7. `hashname`;
8. `buy_price`;
9. `listing_price`;
10. `sell_price`;
11. `transaction_id`;
12. `profit`;
13. `source_currency_id`;
14. `state_version`.

Wire row строго содержит 14 полей.

Проверяются:

- тип события только 1 или 2;
- UInt32-диапазоны для времени и AppID;
- Int64-диапазоны цен;
- положительный currency ID;
- state version только 1 или 2.

### Envelope

Kafka payload:

```json
{
  "v": 2,
  "b": "batch-id",
  "r": [
    ["login", "event-id", 1, 123, 0, 753, "hash", 100, 0, 0, "", 0, 8, 1]
  ]
}
```

Модель:

- `src/superbot_ng/domain/sales_history/envelopes.py`;
- `src/superbot_ng/pipelines/sales_history/envelope.py`;
- `native/superbot_native/src/lib.rs`;
- `rust/services/sales_history/src/codec.rs`.

Envelope version строго `2`.

---

## 5. Пагинация и остановка прохода

Константы:

- page size: `500`;
- Python max pages: `200000`;
- Rust max pages: `500`.

Файлы:

- Python: `src/superbot_ng/use_cases/sales_history/constants.py`;
- Rust: `rust/services/sales_history/src/raw_sync.rs`.

Стартовые offsets:

```text
start=0
start += 500
```

Цикл обрабатывает страницы последовательно.

### Stop conditions

Проход завершается при:

- `no_events`;
- `cutoff`;
- `previous_cursor`;
- `max_pages`.

Реализация:

- Python: `src/superbot_ng/use_cases/sales_history/sync_page.py`;
- Rust: `rust/services/sales_history/src/page.rs`.

`page_stop_reason` смотрит на самое старое событие страницы:

```text
oldest.time < cutoff
```

или:

```text
oldest <= previous_cursor
```

События, которые строго старше предыдущего cursor, отбрасываются. При равном времени/fraction сохранение допускается, потому что полный event identity включает `event_id`.

---

## 6. Cursor/checkpoint модель

### PostgreSQL cursor

Миграции:

- `migrations/postgres/000001_sales_history_cursors.sql`;
- `migrations/postgres/000002_sales_history_sync_meta.sql`.

Таблица `sales_history_cursors` содержит:

- `login`;
- `latest_event_id`;
- `latest_time_event`;
- `latest_time_event_fraction`;
- `last_synced_at`;
- `next_sync_at`;
- `retry_until`;
- `retry_count`;
- `sync_meta JSONB`.

Репозитории:

- `src/superbot_ng/repositories/postgres/sales_history/cursor_store.py`;
- `cursor_roster.py`;
- `cursor_retry.py`;
- `cursor_meta.py`;
- Rust: `rust/services/sales_history/src/cursor.rs`.

Обычный успешный цикл:

1. cursor загружается;
2. история отправляется;
3. выполняется marking;
4. cursor upsert-ится;
5. `next_sync_at = synced_at + 900 секунд`;
6. retry поля очищаются;
7. `sync_meta` очищается.

### Sync meta

Фазы:

```text
raw_running
raw_sent
raw_visible
marking
marked_sent
no_new_rows
failed
```

Файл:

- `src/superbot_ng/pipelines/sales_history/sync_meta.py`.

В meta сохраняются:

- предыдущий cursor;
- новый cursor;
- raw Kafka checkpoint;
- marked Kafka checkpoint;
- affected sell keys;
- cycle ID;
- timestamp;
- ошибка.

Meta обновляется атомарным shallow JSON merge через PostgreSQL:

- `src/superbot_ng/repositories/postgres/sales_history/cursor_meta.py`.

### Filesystem checkpoint

Назначение — восстановиться после:

- rate limit;
- остановки процесса;
- ошибки marking;
- потери процесса после Kafka ACK.

Файлы:

- Python: `src/superbot_ng/repositories/filesystem/sales_history/checkpoint_store.py`;
- `checkpoint_file.py`;
- Rust: `rust/services/sales_history/src/checkpoint.rs`.

Директория:

```text
/var/lib/superbot/sales-history/checkpoints
```

Файл аккаунта адресуется SHA-256(login), поэтому login не используется напрямую в имени файла.

Права:

- каталог `0700`;
- файл `0600`;
- `fsync` после создания/добавления.

Формат JSONL:

1. `cycle`;
2. `page`;
3. `rate_limit`.

Каждая page record содержит:

- offset;
- page index;
- количество rows;
- cursor delta;
- affected sell keys;
- последний Kafka checkpoint;
- stop reason;
- phase `raw_running` или `raw_done`.

При чтении:

- неполный последний line обрезается;
- полная повреждённая checkpoint удаляется;
- нарушенная последовательность страниц считается invalid.

Тесты:

- `tests/contracts/sales_history/test_sales_history_checkpoint_contracts.py`.

---

## 7. Initial/bootstrap/backfill режим

Вход:

- `cSalesHistoryBootstrap.py`;
- `src/superbot_ng/entrypoints/sales_history/bootstrap.py`;
- Rust: `rust/services/sales_history/src/bootstrap.rs`.

Режимы:

### Обычный bootstrap

Обрабатываются только аккаунты без успешно завершённого cursor:

```sql
missing_logins(active_logins)
```

### `--force`

Выполняется:

1. ожидание drain Kafka topic;
2. `TRUNCATE TABLE superbot.sales_history_events`;
3. `TRUNCATE TABLE sales_history_cursors`;
4. полная загрузка всех активных аккаунтов.

Реализация:

- Python: `src/superbot_ng/entrypoints/sales_history/bootstrap_runner.py`;
- Rust: `rust/services/sales_history/src/bootstrap.rs`.

### Bootstrap cutoff

Используется cutoff:

```text
2026-01-01 00:00:00 UTC
```

Константа:

- Python: `src/superbot_ng/use_cases/sales_history/constants.py`;
- Rust: `rust/services/sales_history/src/bootstrap.rs`.

Bootstrap не использует предыдущий cursor:

```text
previous_cursor_key = None
```

После raw-фазы выполняется полное marking аккаунта.

---

## 8. Incremental/daemon режим

Вход:

- `aSalesHistorySync.py`;
- `src/superbot_ng/workers/sales_history/daemon.py`;
- Rust: `rust/services/sales_history/src/daemon.rs`.

Перед стартом daemon проверяет, что все активные аккаунты имеют bootstrap cursor. Если нет:

```text
bootstrap_required
```

Синхронизация выбирает due accounts:

```sql
next_sync_at <= now
AND (retry_until IS NULL OR retry_until <= now)
```

Порядок:

```text
last_synced_at NULLS FIRST, login
```

Python coordinator:

- `daemon_coordinator.py`;
- `daemon_coordinator_loop.py`;
- `daemon_schedule.py`.

Параметры:

- account concurrency: `12`;
- marking concurrency: `4`;
- sync interval: `900 секунд`.

Отложенные аккаунты хранятся в heap по monotonic deadline. Повторный defer того же login заменяет старый deadline и не создаёт duplicate work item.

---

## 9. Raw pipeline

Главные файлы:

- `src/superbot_ng/use_cases/sales_history/sync_raw.py`;
- `sync_page.py`;
- `sync_page_progress.py`;
- `sync_page_send.py`;
- `sync_cycle.py`;
- `src/superbot_ng/workers/sales_history/daemon_raw.py`.

Порядок страницы:

1. Steam fetch;
2. parse;
3. native encode;
4. chunking;
5. Kafka send;
6. после успешного Kafka ACK — checkpoint page append;
7. обновление in-memory state;
8. переход к следующей странице.

Тест явно фиксирует порядок ACK → checkpoint:

- `tests/contracts/sales_history/test_sales_history_checkpoint_contracts.py`.

Raw state:

- `processed`;
- cursor;
- affected sell keys;
- raw Kafka checkpoint;
- stop reason.

`affected_sell_keys` — это уникальные пары:

```text
(appid, hashname)
```

только для SELL с непустым hashname.

---

## 10. Kafka

Конфигурация:

- topic: `ch.sales_history_events.v2`;
- partitions: `16`;
- bootstrap servers Python: `127.0.0.1:29092`;
- Rust config: `config.toml`;
- group: `superbot-clickhouse-injector`.

Файлы:

- `src/superbot_ng/platform/settings/kafka.py`;
- `src/superbot_ng/platform/settings/runtime.py`;
- `src/superbot_ng/clients/kafka/sales_history/`;
- `rust/services/sales_history/src/kafka.rs`.

Producer:

- `acks="all"`;
- compression `zstd`;
- `linger_ms=20`;
- max Kafka payload: `512 KiB`;
- key Kafka record — login.

Отправка возвращает:

- topic;
- partition;
- offset;
- batch ID;
- rows.

Это `KafkaSendCheckpoint`.

Payload chunking:

- ограничение по bytes;
- raw page может быть разбита на несколько chunks;
- marked chunk ограничен также 5000 rows;
- batch IDs получают suffix `-0001`, `-0002`, etc.

---

## 11. ClickHouse injector

Сервис:

- Python: `src/superbot_ng/workers/clickhouse_injector/service.py`;
- `codec.py`;
- `flush.py`;
- `commit.py`;
- Rust аналог: `rust/services/clickhouse_injector/`.

Consumer:

- `enable_auto_commit=False`;
- `auto_offset_reset="earliest"`;
- `max_poll_records=1000`.

Buffer flush при:

- 1000 сообщений;
- 2 MiB;
- возрасте 2 секунды;
- forced shutdown.

Kafka envelope декодируется, валидируется и превращается в JSONEachRow для ClickHouse:

- `native/superbot_native/src/lib.rs`;
- Rust: `rust/services/sales_history/src/codec.rs`.

Порядок commit:

1. принять Kafka messages;
2. decode/encode;
3. попытаться записать ClickHouse;
4. зафиксировать Kafka offsets даже после ошибки записи;
5. отправить ошибку в observability.

Это означает, что injector ориентирован на progression Kafka consumer и не гарантирует автоматический replay после ошибки ClickHouse.

Для повторно отклонённых marked payload действует `MarkedPayloadProgressGuard`:

- `src/superbot_ng/workers/clickhouse_injector/progress_guard.py`.

Если тот же marked payload снова приходит, injector блокируется и периодически фиксирует ошибку, вместо бесконечного продвижения.

---

## 12. ClickHouse storage и идемпотентность

Миграция:

- `migrations/clickhouse/000002_sales_history_events.sql`.

Таблица:

```text
superbot.sales_history_events
```

Engine:

```text
ReplacingMergeTree(state_version)
```

Ключевые поля сортировки:

```text
login,
event_type,
appid,
hashname_hash,
time_event,
time_event_fraction,
event_id
```

State versions:

- `1` — raw;
- `2` — marked.

Идемпотентность строится не через Kafka exactly-once, а через:

1. стабильный `event_id`;
2. одинаковую сортировку ClickHouse;
3. `ReplacingMergeTree(state_version)`;
4. `FINAL` при marking/query;
5. marked state version `2`, превосходящий raw `1`.

Риск/нюанс: Kafka delivery может быть повторена, а raw/marked envelopes получают новые batch IDs. Дедупликация фактически возложена на ClickHouse ReplacingMergeTree и ключ сортировки.

---

## 13. Marking: AppID 753

Файлы:

- Python:
  - `src/superbot_ng/use_cases/sales_history/marking.py`;
  - `marking_753.py`;
  - `marking_queries.py`;
  - `marking_buy_candidates.py`;
  - `marking_writer.py`.
- Rust:
  - `rust/services/sales_history/src/marking.rs`;
  - `marking_runtime.rs`.
- Native:
  - `native/superbot_native/src/lib.rs`.

Алгоритм:

1. выбрать SELL со `transaction_id=''`;
2. сгруппировать по `(appid, hashname)`;
3. для каждого ключа определить нужное количество BUY;
4. выбрать unmarked BUY:
   - `buy_price > 0`;
   - тот же market key;
   - сначала более дорогие BUY;
   - затем по времени;
5. сопоставить SELL и BUY;
6. сформировать transaction ID:

```text
buy_event_id + "+" + sell_event_id
```

7. записать:
   - BUY с transaction ID;
   - SELL с тем же transaction ID;
   - SELL profit = `sell_price - buy_price`;
   - state version = 2.

Если BUY не найден:

- SELL получает `transaction_id = sell_event_id`;
- profit остаётся 0;
- событие всё равно считается marked.

Incremental режим ограничивает AppID 753 marking affected keys текущего raw pass. Если keys отсутствуют, выполняется полное marking.

---

## 14. Marking: AppID 440

Для TF2 используется отдельная стадия:

- `src/superbot_ng/use_cases/sales_history/marking_440.py`;
- Rust: `rust/services/sales_history/src/marking.rs`.

Алгоритм:

1. выбрать unmarked SELL AppID 440;
2. если SELL нет — BUY не загружаются;
3. выбрать unmarked BUY AppID 440;
4. BUY получают:
   - transaction ID = собственный event ID;
   - profit = 0;
5. SELL получают:
   - transaction ID = собственный event ID;
   - profit = `sell_price` только для manual sale hash names;
   - иначе profit = 0;
6. state version = 2.

Список manual/full-profit items:

- `src/superbot_ng/platform/settings/tf2.py`;
- Rust дублирует список в `rust/services/sales_history/src/daemon.rs` и `bootstrap.rs`.

В коде есть расхождение: Rust-список содержит `Haunted Hoard Case`, тогда как Python-настройки и часть каталога выглядят иначе по длине/содержимому. Это следует учитывать как потенциальную drift-проблему между реализациями.

---

## 15. Visibility/checkpoints между Kafka и ClickHouse

После raw send cursor нельзя сразу считать безопасным.

Используется `KafkaVisibilityWaiter`:

- Python: `src/superbot_ng/clients/kafka/visibility/waiter.py`;
- `admin.py`;
- Rust: `rust/services/sales_history/src/visibility.rs`.

Waiter периодически читает committed offset consumer group:

```text
superbot-clickhouse-injector
```

Checkpoint считается видимым, когда:

```text
committed_offset > produced_offset
```

То есть injector должен уже обработать сообщение и commit offset.

Raw marking:

1. raw checkpoint записан;
2. ожидается visibility;
3. phase `raw_visible`;
4. phase `marking`;
5. marking читает ClickHouse;
6. marked rows отправляются Kafka;
7. снова ожидается visibility;
8. cursor обновляется;
9. checkpoint удаляется.

---

## 16. Ошибки и retry

### Steam network errors

Transient errors:

- connect timeout;
- connect error;
- proxy error;
- pool timeout;
- read timeout;
- protocol/read errors.

Retry:

- до 6 попыток;
- задержки `0.1, 0.2, 0.3, 0.4, 0.5` секунд;
- после исчерпания defer на 60 секунд.

Файлы:

- `src/superbot_ng/clients/steam/sales_history/retry.py`;
- `constants.py`;
- `errors.py`.

### HTTP response errors

Response attempts:

- до 5 попыток.

Ошибки сохраняются в диагностические artifacts:

```text
/var/log/superbot/steam-history-artifacts
```

Python хранит body и безопасные headers, удаляя:

- cookie;
- authorization;
- set-cookie;
- proxy-authorization.

Rust сохраняет более ограниченный artifact:

- `rust/services/sales_history/src/steam_client.rs`.

Retention Python:

- cleanup раз в сутки;
- retention 30 дней.

### HTTP 429

Для 429:

- случайный defer от 2400 до 4800 секунд;
- сохраняется абсолютный `retry_at_unix` в filesystem checkpoint;
- login освобождает account slot;
- coordinator позже восстанавливает resume state.

Если процесс перезапущен, оставшиеся deadlines восстанавливаются из checkpoint.

### Auth blocker

Auth-required response определяется по тексту:

```text
Login ... to view your Community Market history
```

Такой аккаунт:

- не считается обычной ошибкой Steam;
- откладывается на `AUTH_RETRY_SLEEP=30` секунд;
- не создаёт обычный PostgreSQL retry.

Файлы:

- `daemon_raw_errors.py`;
- `bootstrap_errors.py`;
- `runtime_user.py`.

### Generic runtime error

Для общей ошибки:

- Sentry/capture;
- `retry_until = now + 30 секунд` в daemon raw path;
- некоторые marking/runtime errors используют 3600 секунд.

### Sentry policy

Файл:

- `src/superbot_ng/clients/steam/sales_history/sentry_policy.py`.

Особенности:

- контролируемые статусы 429/500/502/503/504 обычно не отправляются сразу;
- пять одинаковых серверных response errors могут вызвать capture;
- auth-required capture выполняется каждый пятый случай для `(login, proxy, reason)`.

---

## 17. Конкурентность

Python runtime:

```text
SALES_HISTORY_DAEMON_ACCOUNT_CONCURRENCY = 12
SALES_HISTORY_RAW_CONCURRENCY = 12
SALES_HISTORY_MARKING_CONCURRENCY = 4
SALES_HISTORY_TRANSCODE_WORKERS = 2
SALES_HISTORY_MARK_QUEUE_SIZE = 16
```

Источники:

- `src/superbot_ng/platform/settings/runtime.py`;
- `config.toml`;
- `daemon_coordinator.py`;
- `bootstrap_pipeline.py`.

Raw и marking разделены очередью. Account task не завершается и checkpoint не удаляется, пока marking worker не подтвердит завершение.

При marking error:

- checkpoint сохраняется;
- cursor не считается успешно завершённым;
- retry записывается;
- аккаунт может быть восстановлен с raw_done checkpoint без повторного Steam fetch.

Тесты этого поведения:

- `tests/contracts/sales_history/test_sales_history_continuous_coordinator_contracts.py`.

Singleton lock:

- Python: `FileLock("sales_history")`;
- Rust: lock file из `config.toml`;
- exit code already running: `75`.

---

## 18. ClickHouse statistics

Materialized view:

- `migrations/clickhouse/000005_stats_sales_facts_mv.sql`;
- обновления: `000007_stats_440_profit_metric.sql`;
- currency: `000010_stats_sales_currency.sql`.

В stats попадают только:

```sql
event_type = SELL
AND transaction_id != ''
AND appid IN (753, 440)
```

Метрики:

- AppID 753 → `753_profit`;
- AppID 440 → `440_profit`.

Дата сдвигается на один час назад:

```sql
toDate(toDateTime(time_event, 'UTC') - INTERVAL 1 HOUR)
```

Currency берётся из `source_currency_id`.

Дальше:

```text
sales_history_events
    ↓ materialized view
stats_sales_facts
    ↓ daily refresh MV
stats_sales_daily
    ↓ stats repositories/use cases
Telegram/statistics presentation
```

Файлы:

- `src/superbot_ng/repositories/clickhouse/stats/summary_sales.py`;
- `sales_bootstrap_facts_sql.py`;
- `src/superbot_ng/entrypoints/stats/bootstrap.py`;
- `src/superbot_ng/use_cases/stats/`.

Sales history sync сам не пишет stats и не использует Mongo:

- это явно закреплено в `tests/contracts/sales_history/test_sales_history_sync_loop.py`.

---

## 19. Legacy Python implementation

Старый путь находится в:

- `modules/sales_history_sync.py`;
- `aSalesHistorySync.py`;
- `libs/steam_req/...`;
- `models/mongo.py`.

Legacy использовал:

- MongoDB;
- непосредственную запись документов;
- `insert_sales_history_batch_ignore_existing`;
- inline stats rollup.

Новая NG-реализация сознательно ушла от этого:

- Kafka как посредник;
- ClickHouse injector;
- Postgres cursor;
- filesystem checkpoints;
- native Rust encoding/marking.

Тесты проверяют отсутствие legacy stats/Mongo path в новом sync stack.

---

## 20. Важные расхождения и неопределённости

### Python vs Rust

В репозитории присутствуют две реализации:

- Python NG stack;
- Rust service stack.

Они в целом поддерживают один wire contract, что подтверждается тестами и одинаковыми constants, но не полностью идентичны.

### Max pages

- Python: `HISTORY_MAX_PAGES = 200000`;
- Rust: `HISTORY_MAX_PAGES = 500`.

Это существенное расхождение. При 500 строках на страницу Rust ограничивает проход примерно 250 000 событиями, Python — значительно большим количеством.

### Retry после Kafka/ClickHouse ошибок

Cursor обновляется только после visibility и marking, что защищает от преждевременного cursor advance.

Однако injector после ошибки ClickHouse всё равно коммитит Kafka offsets:

- `src/superbot_ng/workers/clickhouse_injector/commit.py`.

Повторная обработка зависит от внешнего Kafka replay/restart сценария или наличия уже сохранённых данных. Автоматического DLQ/retry topic в рассмотренном коде нет.

### Cursor semantics

Cursor строится из первой страницы (`events[0]`), а stop condition — из самой старой записи страницы. Это предполагает, что Steam возвращает историю в порядке от новых к старым.

### Empty/no-event page

При `processed=0` и отсутствии Kafka checkpoint marking пропускается, а cursor может быть успешно обновлён. Это явно закреплено тестом:

- `tests/contracts/sales_history/test_sales_history_sync_loop.py`.

### Manual TF2 catalog drift

Список manual sale hash names дублируется в Python и Rust и может расходиться. Особенно заметен Rust item `Haunted Hoard Case`, присутствующий в Rust-тесте/списке, но не очевидно синхронизированный с Python catalog.

### Документация

Отдельных Markdown-документов по sales history не найдено. Основная документация фактически представлена:

- кодом;
- migrations;
- contract tests;
- Rust tests;
- `config.toml`;
- docker-compose.

### Тесты

Contract tests многочисленны и описывают ожидаемую архитектуру, но поскольку выполнение не проводилось, данный отчёт подтверждает только статическое наличие логики, а не её фактическое поведение в окружении.
</response>

Agent ID: 1421601a-1361-4d0e-b3d9-6501c8010707 (can be used with the `resume` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with `[Name](1421601a-1361-4d0e-b3d9-6501c8010707)`. Don't use a generic label such as `[agent]`, `[worker]`, or `[subagent]`. For cloud subagents, when the agent has edited code, link to `[Review](1421601a-1361-4d0e-b3d9-6501c8010707#changes)`, or, if you know the exact added and deleted line counts, `[Review +A −D](1421601a-1361-4d0e-b3d9-6501c8010707#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](1421601a-1361-4d0e-b3d9-6501c8010707#desktop)` only when the agent used computer use)