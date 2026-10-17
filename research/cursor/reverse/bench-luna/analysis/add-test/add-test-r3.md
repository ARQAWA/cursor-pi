## add-test-r3
Итог: Задача была написать контрактный тест на то, как после ошибки синхронизации кошелька назначается следующая попытка. Агент сделал 16 ответов модели и 15 вызовов инструментов: rg ×4, ReadFile ×6, Glob ×1, ApplyPatch ×2, Shell ×2. Субагентов не было. Каждый вызов шёл отдельным ответом, хотя системная инструкция велит распараллеливать независимые вызовы. Агент нашёл расчёт `next_attempt_at = now + retry_after_seconds`, добавил тест в `tests/contracts/wallet/test_wallet_failure_contracts.py` (+60 строк), pytest не запустил из-за синтаксической ошибки в `shutdown.py:25`, проверил `git diff --check` и сдал результат. Прогон занял 72,3 с: модель работала 26,8 с, до её первого ответа проходило 16,4 с, между ответом и следующим запросом 19,7 с. Токены: вход 312 546, из них из кэша 276 736 (≈88%), выход 2 875, из них рассуждение 1 064, всего 315 421. Задача выполнена лишь частично. Тест написан в нужном месте и стиле, но не запущен. По коду он упадёт с NameError, потому что `timedelta` не импортирован (вывод, тест не запускался; см. шаг 12). Проверка минимальной задержки в 1 секунду, которую агент обещал в шаге 10, в тест не попала.
### Шаг 1
Что: rg по `tests/contracts/**` с шаблоном `wallet|кошел|sync|синх`, режим «только имена файлов».
Зачем: Задача просит тест «в стиле существующих тестов в tests/contracts», значит сначала нужны контрактные тесты про кошелёк и синхронизацию. Сводка рассуждения: «Planning contract test for wallet sync retry». В шаблон попали и русское «кошел», и английские слова, потому что запрос на русском, а код на английском.
Принцип: Ищи по всем названиям предмета (английским, русским, синонимам), иначе пропустишь нужный файл.
Результат: 48 файлов. Кошельковые: `test_wallet_failure_contracts.py`, `test_wallet_backlog_contracts.py`, `test_wallet_ng_contracts.py`, `test_wallet_scheduler_contracts.py`. Слово «ошибка» из задачи, вероятно, и привело к выбору `test_wallet_failure_contracts.py` (вывод).
### Шаг 2
Что: ReadFile всего `tests/contracts/wallet/test_wallet_failure_contracts.py`.
Зачем: Файл с «failure» в имени ближе всего к теме ошибки. Сводка рассуждения: «Inspecting wallet tests and implementation».
Принцип: Прочитай целиком самый похожий существующий тест, чтобы повторить его приёмы.
Результат: Образец — `test_wallet_failure_store_returns_consecutive_retry_count` (строки 10–62): заглушки `_Pool`, `_Connection`, `_Context` вместо настоящей базы, вызов `asyncio.run(store.record_failure(...))`, проверка списка `calls` и импорт `UPDATE_FAILURE_STATE_SQL`. Строка 62 — конец этого теста, новый тест потом вставлен после неё. Остальные тесты файла про 429, наблюдателя и выход из сервиса, а не про повторы.
### Шаг 3
Что: ReadFile всего `tests/contracts/wallet/test_wallet_scheduler_contracts.py`.
Зачем: «Следующая попытка» — это расписание повторов. Сводка рассуждения: «Inspecting scheduler and backlog code».
Принцип: Проверь соседний модуль про то же понятие, чтобы не дублировать уже покрытое и увидеть непокрытое.
Результат: Тесты проверяют SQL-текст (`next_attempt_at`, `ORDER BY next_attempt_at, login`, строки 16, 62–63) и выбор повторов по времени, но не сам расчёт времени после ошибки. Значит расчёт стоит искать в другом месте.
### Шаг 4
Что: rg по `next_attempt_at|retry_after_seconds|record_failure|retry_count` с фильтром `superbot_ng/**/*.py`.
Зачем: Нужен код, который считает следующую попытку. Сводка рассуждения: «Planning error handling analysis».
Принцип: Ищи по именам функций и полей, которые уже видел в тесте.
Результат: «No matches found». Вывод: фильтр привязан к корню репозитория, а пакет лежит в `src/superbot_ng/` (видно по путям в шаге 6). Пустой результат, потерь нет.
### Шаг 5
Что: Glob `**/*wallet*` по корню репозитория.
Зачем: Поиск по тексту оказался пуст, поэтому агент смотрит, какие файлы вообще связаны с кошельком. Сводка рассуждения: «Inspecting tree structure».
Принцип: Если поиск по тексту пуст, сначала проверь список файлов по имени.
Результат: 12 файлов, в том числе `src/superbot_ng/clients/kafka/wallet/wallet_writer.py`, `migrations/postgres/000012_wallet_due_scheduler.sql`, `aWalletSync.py`. Файлы из `repositories/postgres/wallet/` в список не попали, потому что в их именах нет слова wallet (вывод по результату шага 6).
### Шаг 6
Что: rg `record_failure|next_attempt_at|retry_after_seconds|UPDATE_FAILURE` по `src` с номерами строк.
Зачем: По именам файлов кода не нашлось, нужен текст. Сводки рассуждения нет; вывод: агент продолжил поиск по ключевым словам из шага 4.
Принцип: Когда имя файла не говорит о сути, ищи по содержимому.
Результат: Главное — `src/superbot_ng/repositories/postgres/wallet/store_sync_results.py:30–40`: метод `record_failure`, строка 40 — `next_attempt_at = now + timedelta(seconds=max(1, int(retry_after_seconds)))`. Также `store_sync_failure_sql.py:3–5`, `workers/wallet/failures.py:61–67`, `workers/wallet/login_sync.py:46,100`, `clients/steam/wallet/client.py:68,77`, `repositories/postgres/wallet/store_retry_schedule.py:31–43`. Совпадения из `sales_history` — шум.
### Шаг 7
Что: ReadFile всего `src/superbot_ng/repositories/postgres/wallet/store_sync_results.py`.
Зачем: Строка 40 из шага 6 — точное место расчёта, нужен весь метод и его вызов в базу. Сводки рассуждения нет.
Принцип: Читай весь метод, который собираешься тестировать, а не одну строку.
Результат: `record_failure(*, login, iteration_id, message, retry_after_seconds, now=None)`. Строка 39 — `now = now or datetime.now(UTC)`. Строка 40 — расчёт `next_attempt_at`. Строки 42–48 — `fetchval(UPDATE_FAILURE_STATE_SQL, login, next_attempt_at, message, now)`. Строки 49–50 — если результата нет, `RuntimeError`. Затем `execute(INCREMENT_FAILURE_SQL, ...)` и возврат `retry_count`. Минимум в 1 секунду задаёт `max(1, …)` в строке 40.
### Шаг 8
Что: ReadFile всего `src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py`.
Зачем: Метод передаёт в базу константу из этого файла, и тест должен сверять именно её, как в образце шага 2. Сводки рассуждения нет; вывод: причина та же.
Принцип: Проверяй SQL, который реально уходит в базу, через импорт константы, а не через копию текста.
Результат: `UPDATE_FAILURE_STATE_SQL`: `SET next_attempt_at = $2, retry_count = retry_count + 1, last_error = $3, updated_at = $4 WHERE login = $1 RETURNING retry_count`. Порядок аргументов: $1 логин, $2 время следующей попытки, $3 сообщение, $4 текущее время.
### Шаг 9
Что: rg `next_attempt_at|next attempt|следующ` по `tests/contracts`.
Зачем: Проверить, нет ли уже теста на расчёт времени после ошибки, и выбрать файл для нового теста. Сводка рассуждения: «Determining location for retry contract test».
Принцип: Перед добавлением теста проверь, не покрыто ли уже, и клади его туда, где лежат похожие тесты.
Результат: Совпадения: `test_wallet_ng_contracts.py:115–116` (фейк успешной записи), `test_wallet_failure_contracts.py:90` (фейк успешной записи), `test_wallet_scheduler_contracts.py:16,62–63` (SQL-текст). Теста на расчёт после ошибки нет, поэтому тест новый. Место — `test_wallet_failure_contracts.py` (вывод).
### Шаг 10
Что: перед вызовом модель написала: «Проверю текущий контракт `record_failure` … Добавлю изолированный тест, который проверяет точное время следующей попытки и минимальную задержку в 1 секунду». Затем ReadFile всего `tests/contracts/wallet/test_wallet_ng_contracts.py`.
Зачем: Сводка рассуждения: «Inspecting existing tests for contract error retries». Нужен был ещё один образец из той же папки.
Принцип: Перед написанием теста прочитай несколько соседних тестов, чтобы повторить их формат.
Результат: Файл про парсер, кодек, порядок записи «Postgres раньше Kafka», остановку и вход в сервис. Для расчёта повторов он не помог, и дальше агент на него не ссылался (вывод). Обещанная проверка минимальной задержки в 1 секунду в итоговом тесте не появилась.
### Шаг 11
Что: ReadFile всего `src/superbot_ng/workers/wallet/failures.py`.
Зачем: Нужно знать, какое `retry_after_seconds` ставит рабочий код после ошибки, чтобы взять реалистичное значение. Сводка рассуждения: «Planning contract test for wallet sync retry».
Принцип: Бери входные значения теста из реального кода, а не придумывай.
Результат: `WALLET_FAILURE_RETRY_SECONDS = 30` (строка 8). И `record_controlled_failure`, и `record_unexpected_failure` передают это значение в `record_wallet_failure`, который вызывает `runner.store.record_failure(...)`. Поэтому в тесте взято 30 секунд.
### Шаг 12
Что: ApplyPatch в `tests/contracts/wallet/test_wallet_failure_contracts.py`: после первого теста вставлена функция `test_wallet_failure_store_schedules_next_attempt_after_retry_delay`. Сводка рассуждения: «Designing contract test for retry scheduling».
Зачем: Нужное было собрано: стиль (шаг 2), место расчёта (шаг 7), SQL (шаг 8), значение 30 секунд (шаг 11). Тест использует заглушку пула, фиксированное «сейчас» 2026-05-11 10:00 UTC, вызывает `record_failure(login="u1", iteration_id=7, message="Http error 500", retry_after_seconds=30, now=now)` и проверяет `calls[0] == ("fetchval", calls[0][1], "u1", now + timedelta(seconds=30), "Http error 500", now)`.
Принцип: Пиши тест по образцу: заглушка вместо базы, фиксированное время, проверка того, что ушло в запрос.
Результат: Файл обновлён. Дефект: тест использует `timedelta`, но шапка файла импортирует только `from datetime import UTC, datetime` (строка 4). В файле `timedelta` встречается лишь в строке 119. Агент этого не заметил.
### Шаг 13
Что: ApplyPatch в тот же файл: внутри теста добавлен импорт `UPDATE_FAILURE_STATE_SQL`, а `calls[0][1]` заменён на эту константу.
Зачем: Сводка рассуждения: «Adding exact SQL equality assertion». В первой версии SQL сравнивался сам с собой и поэтому не проверялся.
Принцип: Ожидаемое значение должно приходить из независимого источника, а не из результата самого вызова.
Результат: Проверка стала точной: `("fetchval", UPDATE_FAILURE_STATE_SQL, "u1", now + 30 с, "Http error 500", now)`. Импорт `timedelta` по-прежнему не добавлен.
### Шаг 14
Что: Shell `pytest -q tests/contracts/wallet/test_wallet_failure_contracts.py` с ожиданием до 30 с.
Зачем: Правило developer-промпта: «implement the requested change, verify it in proportion to risk» (реализуй и проверь с учётом риска). Сводки рассуждения нет.
Принцип: После изменения запусти затронутый тест и отделяй ошибку запуска от ошибки в самом тесте.
Результат: Код выхода 4, тесты не стартовали. ImportError при загрузке `tests/conftest.py` → `src/superbot_ng/platform/runtime/shutdown.py:25`: `except NotImplementedError, RuntimeError:` даёт SyntaxError (синтаксис Python 2). Ошибка вне задачи, и агент её не правил.
### Шаг 15
Что: Shell `git diff --check && git diff -- tests/contracts/wallet/test_wallet_failure_contracts.py`.
Зачем: pytest не запустился по причине вне задачи, поэтому агент проверил доступное: пробелы и сам diff. Сводки: «Assessing Python test and syntax issues», «Inspecting git diff for changes».
Принцип: Если основную проверку нельзя выполнить, сделай доступную и честно назови, что осталось непроверенным.
Результат: Код 0. `git diff --check` без замечаний. Diff — один блок `@@ -62,6 +62,66 @@`, строки импорта `timedelta` в нём нет, но агент это не заметил.
### Шаг 16
Что: ответ без инструментов — итог для пользователя.
Зачем: Всё, что можно было сделать без работающего pytest, сделано. Сводки рассуждения нет.
Принцип: Итоговый ответ сначала сообщает результат, потом то, что не проверено.
Результат: Тест добавлен в `test_wallet_failure_contracts.py`, проверяет `next_attempt_at = now + retry_after_seconds` и передачу в SQL. `git diff --check` прошёл, pytest заблокирован синтаксической ошибкой в `shutdown.py` (Python 2). Агент не утверждал, что тест прошёл. Но он не упомянул ни отсутствующий импорт `timedelta`, ни пропущенную проверку минимальной задержки в 1 секунду.
