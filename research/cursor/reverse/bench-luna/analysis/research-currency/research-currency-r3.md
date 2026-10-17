## research-currency-r3
Итог: Агент разобрался, как устроена синхронизация курсов, и выполнил задачу только на чтение: Glob, rg и ReadFile, без команд и правок. Всего 45 шагов модели и 44 вызова инструментов (Glob 1, rg 7, ReadFile 36), субагентов не было. Ход работы: обзор файлов, поиск по ключевым словам, чтение Python-цепочки от `aCurrencySync.py`, чтение Rust-цепочки, проверка, что реально запускается (compose, Makefile, Dockerfile), разбор legacy-кода и финальный отчёт из 12 разделов с путями. Причины ниже выведены из коротких сводок рассуждений модели, из промпта и из предыдущих результатов; полное рассуждение зашифровано. Все пять пунктов вопроса закрыты и подкреплены прочитанным кодом. Не проверено: HTTP-клиент Python (шаг 44 открыл угаданный путь, файл не найден, повторного поиска не было), поэтому утверждение отчёта про `proxy=None` не подтверждено; статус `running` в отчёте — вывод из того, что прочитанный код его не ставит. Время: 419,7 с (около 7 мин), из них модель 319,6 с (76%), подготовка 41,1 с, паузы между вызовами 51,0 с; финальный шаг 45 занял 100,5 с. Токены: вход 1 586 677, из них из кэша 1 502 208 (около 95%, один ключ кэша на все шаги), выход 15 537, из них рассуждения 8 526, всего 1 602 214. Каждый шаг содержал ровно один вызов, хотя промпт просит параллелить независимые вызовы; вывод: чтение шагов 3–9 можно было сделать одним пакетом, так как файлы не зависели друг от друга.
### Шаг 1
Что: Glob `*` по корню рабочей папки, чтобы получить список всех файлов (модель 3,7 с; вход 9 205, кэш 0; выход 170, reasoning 108).
Зачем: В вопросе нет путей, поэтому нужна карта проекта; сводка рассуждения: «Starting read-only repository inspection».
Принцип: Сначала осмотри карту, потом читай детали.
Результат: 931 файл, но в выдаче в основном `.git`-объекты и `rust/services/*`; валютных файлов в выдаче нет, список обрезан, поэтому нужен поиск по содержимому.
### Шаг 2
Что: rg с одним regex `currency|exchange|курс|валют|forex|rates`, режим имён файлов, `.git` исключён, до 200 строк (модель 3,2 с; вход 11 818, кэш 8 960; выход 133, reasoning 41).
Зачем: Выдача шага 1 засорена `.git`, поэтому его исключили; один запрос покрывает английские и русские синонимы; сводка: «Planning detailed source inspection».
Принцип: Ищи все синонимы и языки одним запросом и сразу отсекай шум.
Результат: около 200 файлов; для ответа важны `aCurrencySync.py`, `src/superbot_ng/workers/currency/{daemon,run_once,observer}.py`, `src/superbot_ng/clients/steam/currency/client.py`, `src/superbot_ng/pipelines/currency/codec.py`, `src/superbot_ng/repositories/postgres/currency/*.py`, `rust/services/currency_sync/src/*.rs`, `migrations/postgres/000008_currency_sync.sql`, `config.toml`, `docker-compose.app.yml`, `Makefile`, `db_currencies/main.py`, `libs/steam/currency.py`.
### Шаг 3
Что: ReadFile `aCurrencySync.py` (модель 3,0 с; вход 14 363, кэш 11 008; выход 116, reasoning 56).
Зачем: Имя файла указывает на вход сервиса; сводка: «Planning parallel file inspection», но вызов был один.
Принцип: Начинай с точки входа и иди по цепочке вызовов.
Результат: Скрипт берёт `FileLock("currency_sync")` и запускает `asyncio.run(run_currency_daemon())` из `superbot_ng.entrypoints.currency`; при занятом lock выходит с кодом 75.
### Шаг 4
Что: ReadFile `src/superbot_ng/entrypoints/currency/runner.py` (модель 1,9 с; вход 14 672, кэш 14 080; выход 67).
Зачем: `aCurrencySync.py` импортирует `run_currency_daemon` отсюда (шаг 3).
Принцип: Переходи от импорта к месту, где функция определена.
Результат: Функция создаёт пул PostgreSQL и два Redis-кэша, запускает `CurrencyDaemonRunner(...).run(stop_event)` и закрывает ресурсы в `finally`.
### Шаг 5
Что: ReadFile `src/superbot_ng/workers/currency/daemon.py` (модель 1,7 с; вход 14 965, кэш 14 080; выход 66).
Зачем: Runner импортирует отсюда `CurrencyDaemonRunner`; здесь главный цикл.
Принцип: Читай главный цикл раньше вспомогательных функций.
Результат: `run()`: ждать `next_run_at` → `_run_once` → при исключении `observer.record_unexpected`, `store.mark_failed(...)` и пауза `retry_seconds`. Значения по умолчанию: база `hoppertty`, интервал 2400 с, повтор 60 с.
### Шаг 6
Что: ReadFile `src/superbot_ng/workers/currency/run_once.py` (модель 2,2 с; вход 16 001, кэш 14 080; выход 66).
Зачем: `_run_once` передаёт работу сюда; это логика одного прохода.
Принцип: Иди от оркестратора к рабочей функции.
Результат: Порядок: USD-снимок (`currency_id == 1`) → `_fetch_rates` по 5 валютам → при ошибке авторизации лог `auth_blocked`, новый снимок и повтор → иначе `store.finish_run(...)`. В `_fetch_rates` после `rate_limited` цикл по валютам прерывается.
### Шаг 7
Что: ReadFile `src/superbot_ng/clients/steam/currency/client.py` (модель 2,6 с; вход 16 928, кэш 15 104; выход 67).
Зачем: `run_once` вызывает `client.fetch_rate(...)`; нужен сам сетевой запрос.
Принцип: Дойди до места, где реально уходит сетевой запрос.
Результат: Сначала проверка Redis-ключа cooldown (если он есть, запроса нет); пауза 1 с; `GET https://steamcommunity.com/tradeoffer/new/?partner=…&token=…` под блокировкой прокси; 429 → cooldown 60 с; редирект на `/login` → `CurrencyAuthInvalid`; другой не-200 → `CurrencyResponseError`; успех → `parse_currency_wallet_info_page`.
### Шаг 8
Что: ReadFile `src/superbot_ng/domain/currency/targets.py` (модель 2,2 с; вход 18 005, кэш 16 128; выход 65).
Зачем: Клиент получает `partner` и `token` из цели; нужно знать, какие цели опрашиваются.
Принцип: Сначала выясни, что запрашиваем, и только потом, как разбираем ответ.
Результат: База — USD (`CURRENCY_BASE_ID = 1`); 5 целей: JPY (8), EUR (3), RUB (5), CNY (23), KZT (37), у каждой свои partner/token и признак `is_whole_units`.
### Шаг 9
Что: ReadFile `src/superbot_ng/pipelines/currency/codec.py` (модель 3,1 с; вход 18 337, кэш 17 152; выход 66).
Зачем: Клиент вызывает `parse_currency_wallet_info_page`; нужны правила проверки чисел.
Принцип: Читай правила проверки там, где сырой текст превращается в значения.
Результат: Разбор делает нативный модуль `_superbot_native`; проверяются база (= 1) и целевая валюта; курсы переводятся в `Decimal`; отказ при пустом, нулевом или отрицательном значении, более 12 знаков после запятой или слишком большом числе; обратный курс не считается.
### Шаг 10
Что: ReadFile `src/superbot_ng/repositories/postgres/currency/store.py` (модель 1,8 с; вход 19 085, кэш 18 176; выход 67).
Зачем: `run_once` вызывает `runner.store.finish_run(...)`; надо знать, куда пишутся результаты.
Принцип: Проследи путь данных до хранилища.
Результат: `CurrencyPostgresStore` — пул asyncpg (min 1, max 4) с настройками `DB_*`; методы берутся из `store_run_state.py`.
### Шаг 11
Что: ReadFile `src/superbot_ng/repositories/postgres/currency/store_run_state.py` (модель 2,0 с; вход 19 362, кэш 18 176; выход 69).
Зачем: Методы `finish_run`, `mark_failed`, `latest_next_run_at` определены здесь.
Принцип: Читай методы, которые вызывает уже прочитанный код.
Результат: `finish_run` — одна транзакция: `executemany` UPSERT курсов и запись состояния; статус: все 5 → `completed`, часть → `partial`, ни одного → `failed`; следующий запуск: `completed` → + интервал, иначе + повтор. `latest_next_run_at` читает `next_run_at` из `currency_sync_state`.
### Шаг 12
Что: ReadFile `src/superbot_ng/repositories/postgres/currency/store_sql.py` (модель 1,7 с; вход 20 069, кэш 19 200; выход 68).
Зачем: Миксин ссылается на SQL-константы; нужны имена таблиц и полей.
Принцип: Проверяй, какие таблицы реально меняются.
Результат: `COMPLETE_RUN_SQL` — upsert строки `id = 1` в `currency_sync_state`; `MARK_FAILED_SQL` — то же со статусом `failed`; `UPSERT_RATES_SQL` — `INSERT INTO currency_rates … ON CONFLICT (currency_id) DO UPDATE`.
### Шаг 13
Что: ReadFile `migrations/postgres/000008_currency_sync.sql` (модель 1,7 с; вход 20 692, кэш 19 200; выход 64).
Зачем: Сверить схему с SQL из шага 12.
Принцип: Сверяй код с описанием схемы в миграциях.
Результат: `currency_rates`: первичный ключ `currency_id`, `NUMERIC(24,12)`, проверки: база = 1, курсы > 0. `currency_sync_state`: одна строка `id = 1`, статусы `idle/running/completed/partial/failed`; строка создаётся миграцией.
### Шаг 14
Что: ReadFile `rust/services/currency_sync/src/main.rs` (модель 1,7 с; вход 21 280, кэш 20 224; выход 63).
Зачем: В запросе просят сравнить с Rust-сервисом; начинаю с его входа, как с Python.
Принцип: Сравнивай две реализации по одним и тем же точкам: вход → конфиг → цикл → запись.
Результат: Sentry; читает `config.toml`; lock-файл из конфига и `try_lock_exclusive` (занято → код 75); `CurrencyDaemon::connect`; SIGTERM или Ctrl-C отменяют цикл; стартовые ошибки получают коды (`config_invalid`, `lock_open_failed` и др.).
### Шаг 15
Что: ReadFile `rust/services/currency_sync/src/config.rs` (модель 1,6 с; вход 22 095, кэш 20 224; выход 63).
Зачем: `main` вызывает `CurrencyConfig::load`; нужны поля и проверки.
Принцип: Знай, какие настройки приходят извне, чтобы понимать, что меняется без правки кода.
Результат: Раздел `[currency_sync]`: `lock_file`, `base_login`, `interval_seconds`, `retry_seconds`, `auth_blocker_seconds`, `request_delay_seconds`, `proxy_cooldown_seconds`; проверки: строки не пустые, интервалы больше 0.
### Шаг 16
Что: ReadFile `rust/services/currency_sync/src/daemon.rs` целиком, 32 552 символа, самый большой файл (модель 1,8 с; вход 22 688, кэш 21 248; выход 64).
Зачем: `main` вызывает `daemon.run(cancel)`; это ядро Rust-версии: цикл, проход, HTTP, cooldown, запись.
Принцип: Если файл — ядро вопроса, читай его целиком, а не отдельные куски.
Результат: `run()`: сон до `next_run_at` → `run_once` → при ошибке `observe_error`, `mark_failed`, пауза. `run_once`: снимок → `wait_for_active_cooldown` → `fetch_rates` → `Finished` (запись `finish_run`) или `AuthInvalid` (новый снимок). `fetch_one`: пауза 1 с, блокировка прокси; при 429 Redis `SET … EX` на 7200 с, пакет продолжается. `next_run_at`: после 429 — `last_429 + 7200`, иначе `completed + 2400` или `+ 60`.
### Шаг 17
Что: ReadFile `rust/services/currency_sync/src/model.rs` (модель 2,9 с; вход 29 925, кэш 22 272; выход 127, reasoning 62).
Зачем: `daemon` использует `TARGETS`, `CurrencyRate` и `parse_wallet_info_page` отсюда; сводка: «Inspecting configurations and code dependencies».
Принцип: Читай разбор данных там, где он определён.
Результат: `TARGETS` — те же 5 валют, что в Python. Разбор: вырезать объект `g_rgWalletInfo` по скобкам → `serde_json` → проверка `wallet_currency == 1` и `wallet_other_currency == цель`. `validate_steam_rate`: без NaN, inf, минуса и нуля; до 12 знаков после запятой; целых разрядов не больше 12, всего не больше 24. Курс сохраняется строкой без пересчёта.
### Шаг 18
Что: ReadFile `rust/services/currency_sync/src/store.rs` (модель 1,7 с; вход 32 270, кэш 29 440; выход 63).
Зачем: `daemon` вызывает `finish_run`, `mark_failed`, `latest_next_run_at`; нужно увидеть запись в Rust.
Принцип: Сверяй путь записи с обеих сторон, чтобы подтвердить, что контракт один.
Результат: Пул sqlx с настройками из `settings.postgres`; `finish_run` — транзакция: INSERT … ON CONFLICT для каждого курса, затем upsert `currency_sync_state`; `mark_failed` пишет `failed` и `next_run_at = now + retry`. По смыслу SQL совпадает с Python.
### Шаг 19
Что: ReadFile `config.toml` (модель 1,7 с; вход 33 482, кэш 31 488; выход 57).
Зачем: Обе реализации читают один файл; нужны рабочие значения, а не дефолты из кода.
Принцип: Значения по умолчанию в коде могут отличаться от рабочих, поэтому проверяй конфиг.
Результат: `[currency_sync]`: `lock_file = /run/superbot/currency_sync.lock`, `base_login = hoppertty`, `interval_seconds = 2400`, `retry_seconds = 60`, `auth_blocker_seconds = 30`, `request_delay_seconds = 1`, `proxy_cooldown_seconds = 7200`. Секретные значения из файла в отчёт не попали.
### Шаг 20
Что: rg `CURRENCY_SYNC_|currency_sync|aCurrencySync|currency_sync` в режиме строк, до 300 строк (модель 4,6 с; вход 34 170, кэш 32 512; выход 162, reasoning 72).
Зачем: Нужно знать, где имя сервиса упоминается (compose, Makefile, тесты); сводка: «Planning investigation of legacy Python and Rust services».
Принцип: Чтобы узнать, что реально работает, найди все места, где система называет этот сервис.
Результат: `docker-compose.app.yml:80` — сервис `currency_sync`; `Makefile:95–96` — цель запускает этот сервис; `Makefile:37` — `make run` запрещает `aCurrencySync.py`; `aCurrencySync.py:22` — `FileLock`; `src/superbot_ng/platform/settings/runtime.py:23–25` — константы; контрактные тесты лежат в `tests/contracts/`.
### Шаг 21
Что: ReadFile `docker-compose.app.yml` (модель 1,7 с; вход 36 214, кэш 33 536; выход 58).
Зачем: rg показал строку 80 (`currency_sync:`); нужен полный блок сервиса.
Принцип: Смотри, какой бинарник реально стартует в контейнере.
Результат: `command: ["/app/currency-sync"]` — это Rust-бинарник, не Python-файл; `read_only`, `cap_drop: ALL`, `restart: unless-stopped`, том `currency_runtime:/run/superbot`, сети `infra` и `steam_auth`.
### Шаг 22
Что: ReadFile `src/superbot_ng/repositories/redis/currency/cache.py` (модель 5,0 с; вход 38 063, кэш 35 584; выход 246, reasoning 177).
Зачем: Python-клиент проверяет cooldown через `cooldown_cache`; нужны ключ и TTL; сводки: «Planning codebase inspection and citation approach», «Comparing retry logic between Python and Rust».
Принцип: Для вопроса «можно ли сейчас обращаться» найди, где хранится состояние паузы.
Результат: Ключ `currency:tradeoffer:cooldown:{proxy_key}` (или `NoProxy`); проверка — `EXISTS`; постановка — `SET … EX ttl`, минимум 1 с.
### Шаг 23
Что: ReadFile `rust/services/currency_sync/Cargo.toml` (модель 1,6 с; вход 38 496, кэш 37 632; выход 64).
Зачем: Нужно понять, какой бинарник собирается и какие библиотеки использует Rust-сервис.
Принцип: Уточняй, что именно собирается, прежде чем делать выводы о работе.
Результат: Бинарник `currency-sync` из `src/main.rs`; зависимости: `fs2` (блокировка), `redis`, `reqwest` (HTTP), `sqlx` (PostgreSQL), `superbot-auth`, `superbot-observability`, `tokio`, `toml`.
### Шаг 24
Что: ReadFile `src/superbot_ng/platform/settings/runtime.py` (модель 3,4 с; вход 38 757, кэш 37 632; выход 159, reasoning 94).
Зачем: Python-демон берёт значения по умолчанию отсюда; их надо сверить с `config.toml`; сводка: «Inspecting Python and Rust currency sync implementations».
Принцип: Сравнивай значения из кода и конфига, потому что они могут расходиться.
Результат: `CURRENCY_SYNC_BASE_LOGIN = "hoppertty"`, `CURRENCY_SYNC_INTERVAL_SEC = 2400`, `CURRENCY_SYNC_RETRY_SEC = 60` — совпадает с `config.toml`; отдельного параметра cooldown 7200 здесь нет; `AUTH_RETRY_SLEEP = 30`, `AUTH_TTL_THRESHOLD_SEC = 400`.
### Шаг 25
Что: ReadFile `src/superbot_ng/use_cases/users/runtime_user.py` (модель 3,5 с; вход 39 192, кэш 37 632; выход 65).
Зачем: `daemon` берёт снимок аккаунта через `load_ng_steam_user_snapshot`; нужно знать, когда снимок не годится.
Принцип: Читай условия отказа, а не только успешный путь.
Результат: Снимок берётся из Redis; если срок жизни Steam-логина ≤ 400 с, снимок не годится; снимок, совпадающий с отвергнутым, тоже пропускается; при отсутствии ждать `AUTH_RETRY_SLEEP` (30 с); при остановке — `ExpectedShutdown`.
### Шаг 26
Что: ReadFile `rust/services/currency_sync/src/session.rs` (модель 3,9 с; вход 39 923, кэш 38 656; выход 151, reasoning 86).
Зачем: Это Rust-аналог шага 25: готовность аккаунта и куки; сводка: «Planning inspection of Rust and Python integration».
Принцип: Ищи аналог в другой реализации, чтобы сравнивать правила, а не догадываться.
Результат: `payload_is_currency_ready`: логин непустой, `currencyid == 1`, `state_version > 0`, адрес прокси непустой, есть хотя бы одна непустая кука. Куки переносятся в `reqwest::cookie::Jar`; `proxy_key` — первая часть хоста прокси; блокировки по прокси — `ProxyLocks`.
### Шаг 27
Что: ReadFile `db_currencies/main.py` (модель 7,2 с; вход 41 263, кэш 39 680; выход 359, reasoning 298).
Зачем: В списке шага 2 есть отдельный старый файл курсов; надо понять, является ли он «Python-версией»; сводки: «Inspecting Python legacy files and rate limits», «Comparing Python and Rust rate limit strategies».
Принцип: Старый код тоже нужно прочитать, прежде чем решить, относится ли он к текущему.
Результат: Старый скрипт: пять URL `tradeoffer/new` с partner/token; собственный логин через `authorize_user`; ретраи логина 15, 30, 60, 120, 180 с; проверка auth раз в 20 с; обновление курсов раз в 40 мин; запись в MongoDB `db.prices_db.update_one({'_id': 'currency'})`.
### Шаг 28
Что: rg `currency-sync|currency_sync|курсов|валют` только по README, docs, *.md, *.yml/*.yaml и Makefile (модель 4,2 с; вход 42 960, кэш 40 704; выход 197, reasoning 92).
Зачем: Проверить, что документация и конфиги запуска говорят то же, что код; сводка: «Planning inspection of Python legacy and current currency sync».
Принцип: Подтверждай вывод из кода документацией и конфигами запуска.
Результат: Совпадения только в `docker-compose.app.yml:80,83` и `Makefile:13,50,64,69,95,96`; в README и docs совпадений нет.
### Шаг 29
Что: ReadFile `Makefile` (модель 3,4 с; вход 43 305, кэш 42 752; выход 150, reasoning 91).
Зачем: rg показал правила `run` и цель `currency_sync`; нужен полный текст, включая запреты; сводка: «Inspecting Python entrypoint and Rust Dockerfile».
Принцип: Читай правила запуска целиком, вместе с запретами.
Результат: Цель `currency_sync` → `docker compose … up --force-recreate currency_sync`; `make run` отказывает в запуске legacy-файлов, включая `aCurrencySync.py` («Legacy runtime file … is disabled»); цели `db_cur`, `bot`, `stats` тоже отключены.
### Шаг 30
Что: ReadFile `Dockerfile` (модель 4,6 с; вход 45 150, кэш 42 752; выход 215, reasoning 156).
Зачем: Проверить, какой бинарник попадает в образ; сводка: «Verifying Python as non-production entrypoint».
Принцип: То, что работает в проде, доказывай по сборке образа.
Результат: `cargo build --release --workspace`; в образ копируется `currency-sync` как `/app/currency-sync`; `.py`-файлы сервиса в образ не копируются; процесс работает от пользователя `superbot`.
### Шаг 31
Что: rg `struct AuthCache|async fn payload|ttl|AUTH_TTL` в `rust/*.rs`, до 100 строк (модель 8,2 с; вход 46 064, кэш 44 800; выход 418, reasoning 329).
Зачем: Rust-демон использует `AuthCache.payload()` из другого крейта; нужно найти определение; сводки: «Comparing Python and Rust implementations», «Analyzing Python and Rust rate limiting differences».
Принцип: Если тип импортирован из другого модуля, ищи его определение по имени.
Результат: `rust/services/auth/src/redis_cache.rs:8` (`AuthCache`), `:77` (`payload`); `rust/services/currency_sync/src/daemon.rs:201` — `redis.ttl(cooldown_key)`; TTL-логика аккаунтов — в `rust/services/auth/src/postgres.rs` и `cookies.rs`.
### Шаг 32
Что: ReadFile `rust/services/auth/src/redis_cache.rs` (модель 2,4 с; вход 46 782, кэш 45 824; выход 63).
Зачем: Это определение `AuthCache` из шага 31.
Принцип: Читай определение найденного символа целиком.
Результат: Ключ `auth:live:{login}`; `payload()` делает `GET` и разбирает JSON (битый JSON даёт `None`); `write_payload` ставит `SET … PXAT` с опциональным `NX`.
### Шаг 33
Что: ReadFile `libs/steam/currency.py` (модель 3,6 с; вход 48 271, кэш 45 824; выход 140, reasoning 78).
Зачем: Старый код разбирает тот же `g_rgWalletInfo` своим способом; нужно сравнить; сводка: «Planning legacy Python inspection».
Принцип: Сравнивай разбор одних и тех же данных в старом и новом коде.
Результат: Регулярка `g_rgWalletInfo\s*=`, поиск объекта по скобкам, `ujson.loads`; в отличие от нового кода нет проверки числовых значений; `get_currency` использует жёстко заданный partner 297302866.
### Шаг 34
Что: ReadFile `src/superbot_ng/clients/steam/currency/errors.py` (модель 5,3 с; вход 49 302, кэш 47 872; выход 244, reasoning 175).
Зачем: `run_once` ловит три типа ошибок; нужна их иерархия; сводка: «Distinguishing Python legacy and current currency sync paths».
Принцип: Чтобы понять обработку ошибок, сначала выпиши типы ошибок и их родителей.
Результат: `CurrencyResponseError(RuntimeError)` — родитель `CurrencyAuthInvalid` и `CurrencyRateLimitDefer(retry_after_seconds)`.
### Шаг 35
Что: ReadFile `src/superbot_ng/entrypoints/currency/__init__.py` (модель 5,8 с; вход 49 469, кэш 48 896; выход 261, reasoning 191).
Зачем: Проверить, что импорт из `aCurrencySync.py` ведёт именно туда; сводка: «Inspecting Python currency_sync entrypoints».
Принцип: Проверяй, что импорт ведёт туда, куда ты думаешь.
Результат: Пакет экспортирует только `run_currency_daemon` из `.runner`; это подтверждает шаг 4.
### Шаг 36
Что: rg `def proxy_key|proxy_key` в `src/superbot_ng`, `*.py`, до 50 строк (модель 8,7 с; вход 49 575, кэш 48 896; выход 449, reasoning 364).
Зачем: Python-клиент берёт ключ cooldown из `session.proxy_key()`; нужно определение; сводки: «Comparing Python and Rust currency_sync implementations», «Detailing Python and Rust auth and proxy differences».
Принцип: Ищи определение метода по имени, если его вызывает уже прочитанный код.
Результат: `src/superbot_ng/domain/users/models.py:99` — `def proxy_key`; использования: `ports/currency/cooldown.py`, `clients/steam/currency/client.py` (строки 62, 63, 88); показано 50 из 86 с лишним совпадений.
### Шаг 37
Что: ReadFile `src/superbot_ng/domain/users/models.py` (модель 2,6 с; вход 50 740, кэш 48 896; выход 63).
Зачем: Определение `proxy_key` и модель пользователя `NgSteamUser`.
Принцип: Читай модель данных, которую используют все шаги цикла.
Результат: `proxy_key()`: без прокси → `NoProxy`, иначе первая часть хоста; адрес прокси — `host:port`; у пользователя обязательны куки и `currency_id > 0`; сам прокси может быть `None`.
### Шаг 38
Что: ReadFile `src/superbot_ng/workers/currency/observer.py` (модель 18,9 с; вход 51 567, кэш 49 920; выход 944, reasoning 876).
Зачем: `daemon` вызывает `observer.record_unexpected` при сбое; надо понять, не шлёт ли он одно и то же сообщение без конца; сводки: «Analyzing Python currency_sync error handling and timing», «Highlighting Python and Rust rate limit differences».
Принцип: Проверяй, есть ли защита от лавины одинаковых сообщений.
Результат: Неожиданные ошибки уходят в Sentry; повторы одного типа (фаза + тип ошибки) подавляются на 600 с; хранится до 64 отпечатков.
### Шаг 39
Что: rg `currency_rates|CurrencyRate` по всему проекту, строки, до 200 (модель 17,5 с; вход 52 062, кэш 50 944; выход 939, reasoning 857).
Зачем: Вопрос «куда записываются результаты»: важно знать, кто их читает; сводки: «Clarifying Python vs Rust currency_sync deployment», «Reviewing Rust and Python startup error handling».
Принцип: Чтобы понять, куда попадают данные, посмотри, кто их читает.
Результат: Python-читатель `src/superbot_ng/repositories/postgres/currency/rates.py`; Rust-читатель `rust/services/stats_telegram/src/daemon.rs:259` (`SELECT inverse_conversion_rate FROM currency_rates`); `src/superbot_ng/use_cases/stats/wallet_conversion.py:96` при отсутствии курса выбрасывает `StatsCurrencyRateMissing`.
### Шаг 40
Что: ReadFile `src/superbot_ng/repositories/postgres/currency/rates.py` (модель 2,0 с; вход 53 896, кэш 50 944; выход 68).
Зачем: Python-читатель из шага 39.
Принцип: Проверяй читателя, чтобы убедиться, что данные действительно используются.
Результат: `fetch_rate(currency_id)` — `SELECT … FROM currency_rates WHERE currency_id = $1`; возвращает `CurrencyRate` или `None`.
### Шаг 41
Что: rg `class FileLock|def init_sentry|class AlreadyRunning` в `src/superbot_ng/platform` (модель 19,5 с; вход 54 364, кэш 52 992; выход 989, reasoning 897).
Зачем: `aCurrencySync.py` использует `FileLock` и `init_sentry`; нужны их определения; сводки: «Summarizing Python and Rust service distinctions», «Comparing Python and Rust rate-limiting behavior».
Принцип: Найди определения всех импортов входного файла, которые влияют на поведение.
Результат: `platform/runtime/file_lock.py:12` (`AlreadyRunning`), `:16` (`FileLock`); `platform/observability/__init__.py:32` (`init_sentry`).
### Шаг 42
Что: ReadFile `src/superbot_ng/platform/runtime/file_lock.py` (модель 1,7 с; вход 54 566, кэш 54 016; выход 64).
Зачем: Проверить, как Python не даёт запустить два экземпляра.
Принцип: На вопрос «можно ли запустить два экземпляра» отвечает код блокировки.
Результат: `fcntl.flock(LOCK_EX | LOCK_NB)`; файл `/tmp/superbot-runtime-locks/<имя>.lock`; занято → `AlreadyRunning`; код выхода 75; в файл пишется `pid=`.
### Шаг 43
Что: ReadFile `src/superbot_ng/platform/settings/__init__.py` (модель 20,9 с; вход 55 040, кэш 54 016; выход 1 124, reasoning 1 057).
Зачем: Проверить, что константы `CURRENCY_SYNC_*` доходят до пакета настроек, которым пользуется демон; сводки: «Planning configuration reading», «Comparing Python and Rust currency sync services».
Принцип: Проверяй цепочку «объявление → экспорт → использование», а не только место объявления.
Результат: `CURRENCY_SYNC_BASE_LOGIN`, `CURRENCY_SYNC_INTERVAL_SEC`, `CURRENCY_SYNC_RETRY_SEC` переэкспортированы из `runtime.py`; отдельной настройки cooldown для Python здесь нет.
### Шаг 44
Что: ReadFile `src/superbot_ng/platform/http.py`; путь был угадан, ответ «Error: File not found» (модель 16,7 с; вход 56 083, кэш 54 016; выход 881, reasoning 817).
Зачем: Python-клиент импортирует `AsyncBaseHttpClient` из `superbot_ng.platform.http`; хотелось увидеть прокси и таймауты; сводка: «Evaluating Redis error handling and HTTP client differences».
Принцип: Не угадывай путь, найди файл поиском по имени класса.
Результат: Файла по этому пути нет; повторного поиска агент не сделал, поэтому утверждение отчёта о `proxy=None` в Python-клиенте осталось непроверенным.
### Шаг 45
Что: Ответ без инструментов: итоговый отчёт на русском в чат (модель 100,5 с; вход 56 161, кэш 55 040; выход 5 543, reasoning 1 552).
Зачем: Собраны доказательства по всем пяти пунктам вопроса; сводка: «Confirming report format and compose commands».
Принцип: Остановись, когда есть доказательства на каждый пункт задачи, и отвечай в запрошенном формате.
Результат: Отчёт из 12 разделов с путями: курсы берутся со страниц Steam `tradeoffer/new` (`g_rgWalletInfo`); интервал 2400 с, повтор 60 с; rate limit: Python 60 с с остановкой пакета, Rust 7200 с с продолжением пакета; запись в `currency_rates` и `currency_sync_state`; в проде работает Rust `/app/currency-sync`, Python NG и legacy `db_currencies` описаны отдельно. Непроверенное утверждение про `proxy=None` в разделе 11 (см. шаг 44).
