## add-test-r2
Итог: Агент получил задачу написать контрактный тест на то, как после ошибки синхронизации кошелька назначается следующая попытка, в стиле `tests/contracts`. За 25 ответов модели он сделал 23 вызова инструментов, по одному в ответе: 2 GetDynamicTools, 3 Glob, 10 ReadFile, 2 rg, 4 Shell, 2 ApplyPatch. Он проследил цепочку «ошибка → record_failure → SQL», взял образец из `test_wallet_failure_contracts.py` и добавил тест `test_wallet_failure_store_schedules_next_attempt_after_retry_delay` (+61/−1 строка). Первый прогон упал: не хватало импорта `timedelta`, а остальные тесты файла падают на отсутствующем модуле `_superbot_native`. Импорт агент добавил, два целевых теста прошли, `git diff --check` прошёл. Полный файл и ruff не прошли, и агент это написал. По существу задача выполнена: тест есть, он в стиле файла и проходит. Ограничения: тест вызывает только `store.record_failure`, а не `sync_wallet_login`; число 30 задано в тесте числом, а не через `WALLET_FAILURE_RETRY_SECONDS` (`failures.py:8`); ruff ругается и на новый тест, но финальный ответ это прямо не называет. Время: 143 989 мс (около 144 с, 19:29:10–19:31:34 UTC). Модель думала 58 с, подготовка 25 с, пауза между вызовами 52 с (самая большая, 15,5 с, после шага 7; причина в данных не видна). Токены: вход 802 731 (из кэша 691 456), выход 4 778, из них рассуждение 2 364, всего 807 509. Вход вырос с 9 147 до 82 967; главный скачок дал вывод терминала на 95 723 символа (шаг 22): вход шага 23 стал 81 600 вместо 39 725.
### Шаг 1
Что: GetDynamicTools с namespace "cursor" и toolName "Subagent": прочитала описание и схему инструмента запуска подагентов. Подагент потом не запускала.
Зачем: в системной подсказке есть namespace cursor с инструментом Subagent, а правило требует читать схему перед вызовом. «вывод:» агент проверял, не отдать ли задачу подагенту. В описании сказано, что для узкого вопроса Subagent использовать не надо.
Принцип: перед вызовом незнакомого инструмента прочитай его описание, а для узкой задачи не делегируй её.
Результат: описание получено (6 823 символа). Агент написал: «Изучу существующие контрактные тесты и реализацию планирования повторной синхронизации, затем добавлю тест в принятом стиле…». Дальше всё делал сам.
### Шаг 2
Что: Glob "tests/contracts/**/*" в корне репозитория.
Зачем: задача прямо просит писать «в стиле существующих тестов в tests/contracts», значит нужно видеть соседние файлы.
Принцип: перед написанием теста найди соседние тесты того же раздела.
Результат: 65 файлов. В `tests/contracts/wallet/` четыре файла: `test_wallet_failure_contracts.py`, `test_wallet_backlog_contracts.py`, `test_wallet_scheduler_contracts.py`, `test_wallet_ng_contracts.py`. «вывод:» файл failure выбран по слову «failure», близкому к «ошибка».
### Шаг 3
Что: Glob "**/*wallet*" по всему проекту.
Зачем: тема задачи — синхронизация кошелька, поэтому нужны и исходники, и миграции, а не только тесты.
Принцип: ищи по ключевому слову из задачи во всём проекте, а не только в папке тестов.
Результат: 12 файлов, среди них `aWalletSync.py`, `src/superbot_ng/clients/kafka/wallet/wallet_writer.py`, миграции `000012_wallet_due_scheduler.sql` и `000007_wallet_sync.sql`, четыре тестовых файла в `tests/contracts/wallet/`.
### Шаг 4
Что: ReadFile `tests/contracts/wallet/test_wallet_failure_contracts.py` целиком (18 278 символов).
Зачем: из шага 3 это самый близкий к задаче файл. Нужен образец: как собираются фейки и что проверяется.
Принцип: возьми за образец ближайший существующий тест и повтори его структуру.
Результат: образец — `test_wallet_failure_store_returns_consecutive_retry_count` (строки 10–63). Фейковые `_Pool` и `_Connection` пишут вызовы в список `calls`. Вызов `store.record_failure(login="u1", iteration_id=7, message="Http error 500", retry_after_seconds=30, now=datetime(2026, 5, 11, 10, 0, tzinfo=UTC))`, затем проверки `calls[0]` и `calls[1]` (строки 59–62).
### Шаг 5
Что: ReadFile `tests/contracts/wallet/test_wallet_scheduler_contracts.py` (9 793 символа).
Зачем: «вывод:» агент хотел понять, как в проекте уже проверяется повторная попытка (очередь due-логинов, `next_attempt_at`), чтобы не дублировать и писать в том же духе.
Принцип: прочитай соседние тесты той же логики, чтобы знать, что уже проверено.
Результат: 8 тестов. Миграция проверяется строками SQL (`test_wallet_scheduler_contracts.py:16`). Запрос `_DUE_RETRY_LOGINS_SQL` проверяется на `ORDER BY next_attempt_at, login` и `LIMIT $2` (строки 62–63). Есть тесты планировщика и теста «пустой retry не создаёт итерацию».
### Шаг 6
Что: rg с шаблоном "next_attempt|retry_after|record_failure" по всем `*.py` в репозитории (до 200 строк).
Зачем: агент хотел увидеть путь данных от ошибки до SQL: откуда берётся `retry_after_seconds` и куда попадает `next_attempt_at`. Из тестов этого не видно.
Принцип: проследи значение по именам полей через весь путь, а не по одному файлу.
Результат: карта цепочки. `failures.py:61–67` вызывает `store.record_failure` с `retry_after_seconds`. `login_sync.py:46` ставит успешной попытке `next_attempt_at = observed_at + interval`, а `login_sync.py:100` передаёт `exc.retry_after_seconds` при ошибке 429. `store_sync_results.py:40` считает `now + timedelta(seconds=max(1, …))`. `store_sync_failure_sql.py:5` пишет `SET next_attempt_at = $2`. Совпадения из sales_history и `__quarantine` агент пропустил.
### Шаг 7
Что: ReadFile `src/superbot_ng/repositories/postgres/wallet/store_sync_results.py` (2 608 символов).
Зачем: в шаге 6 `record_failure` найден в этом файле (строки 30–45), а тест импортирует `WalletSyncResultMixin` отсюда. Нужна точная формула.
Принцип: читай короткий главный файл цепочки целиком, чтобы знать точную формулу.
Результат: `record_failure` считает `next_attempt_at = now + timedelta(seconds=max(1, int(retry_after_seconds)))` (строка 40). В транзакции вызывается `fetchval(UPDATE_FAILURE_STATE_SQL, login, next_attempt_at, message, now)`. Если вернулся `None`, будет `RuntimeError`. Затем `execute(INCREMENT_FAILURE_SQL, …)`. Формула: следующая попытка = момент ошибки + retry_after, но не меньше 1 с.
### Шаг 8
Что: ReadFile `src/superbot_ng/workers/wallet/login_sync.py` (3 318 символов).
Зачем: шаг 6 показал, что `login_sync` передаёт `retry_after` из исключения (строка 100). Агент хотел увидеть, откуда оно берётся.
Принцип: смотри, откуда приходят входные значения, а не только куда они уходят.
Результат: при `WalletRateLimitDefer` вызывается `record_wallet_failure(…, exc.retry_after_seconds)` (строки 97–100). При `WalletResponseError` — `record_controlled_failure`. При других исключениях — `record_unexpected_failure`. При успехе — `record_success(next_attempt_at = observed_at + interval_seconds)`.
### Шаг 9
Что: ReadFile `src/superbot_ng/workers/wallet/failures.py` (1 648 символов).
Зачем: `login_sync` вызывает `record_controlled_failure` и `record_unexpected_failure`, но откуда у них задержка, в шаге 8 не видно.
Принцип: доведи число задержки до его источника: константа или поле исключения.
Результат: `WALLET_FAILURE_RETRY_SECONDS = 30` (строка 8). Обычные и непредвиденные ошибки получают 30 с. Для 429 задержка берётся из исключения, по умолчанию 60 (`clients/steam/wallet/errors.py:11`, из результата шага 6).
### Шаг 10
Что: rg с шаблоном "timedelta(seconds=max|next_attempt_at =|record_failure" в `tests/contracts`, `*.py`.
Зачем: агент хотел найти в тестах все проверки задержки и вызова `record_failure`. «вывод:» скобку в шаблоне он не экранировал.
Принцип: в регулярном выражении скобку нужно экранировать (`\(`), инструмент сам просит экранировать метасимволы.
Результат: ошибка «rg: regex parse error: unclosed group». Повторного поиска не было. Агент перешёл к `test_wallet_ng_contracts.py`, где шаг 6 показал фейковые `record_success` и `record_failure` (строки 115–118).
### Шаг 11
Что: ReadFile `tests/contracts/wallet/test_wallet_ng_contracts.py` (14 749 символов).
Зачем: из шага 6 видно второй фейковый store с `record_success(next_attempt_at)`. Агент искал второй образец того же стиля и то, как там проверяется время следующей попытки.
Принцип: найди второй образец того же стиля, чтобы не выдумывать свой.
Результат: `test_wallet_iteration_writes_postgres_before_clickhouse_handoff` (около строк 96–117) проверяет, что записи в Postgres идут раньше Kafka. Строка 116 утверждает `next_attempt_at > event.observed_at`. Стиль тот же: фейковые классы, список `events`, `monkeypatch`.
### Шаг 12
Что: Shell: `git log --oneline -8 && git status --short && rg -n "WalletSync|next attempt|next_attempt_at|retry" README.md docs tests/contracts/wallet …`.
Зачем: «вывод:» агент хотел найти документацию по повторным попыткам и проверить состояние репозитория перед правкой.
Принцип: перед правкой проверь состояние репозитория и документацию, которая может задавать правила.
Результат: один коммит `a8d1875 Initial commit`, `git status` пуст. `README.md` и `docs/` в корне отсутствуют (код выхода 2), но в `tests/contracts/wallet` нашлись совпадения, например `test_wallet_failure_contracts.py:10, 50–54, 59–62`. Опираться можно только на тесты.
### Шаг 13
Что: ReadFile `src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py` (506 символов).
Зачем: тест будет проверять аргументы SQL по позициям. Нужно знать, что `$2` — это `next_attempt_at`, а `$4` — это `now`.
Принцип: сверяй аргументы в проверке с шаблоном SQL по номерам параметров.
Результат: `UPDATE wallet_sync_state SET next_attempt_at = $2, retry_count = retry_count + 1, last_error = $3, updated_at = $4 WHERE login = $1 RETURNING retry_count`. Порядок аргументов совпадает с шагом 7.
### Шаг 14
Что: Glob "pyproject.toml".
Зачем: «вывод:» агент хотел узнать правила тестов и линтера до написания кода. В шаге 4 в тестах много аннотаций и локальных импортов.
Принцип: перед написанием кода проверь правила проекта для тестов и линтера.
Результат: найден один `pyproject.toml` в корне.
### Шаг 15
Что: ReadFile `pyproject.toml` (1 709 символов).
Зачем: шаг 14 нашёл файл, а нужны настройки pytest и ruff.
Принцип: код должен соответствовать линтеру, правила которого описаны в проекте.
Результат: pytest: `addopts = "-ra --strict-markers"`, `testpaths = ["tests/contracts"]`. ruff: `line-length = 99`, `max-complexity = 7`, в `select` есть ANN, PLC, C901. ANN401 отключён. Отсюда понятно, почему ruff потом ругается на локальные импорты (PLC0415) и на отсутствующие аннотации (ANN…).
### Шаг 16
Что: ApplyPatch для `tests/contracts/wallet/test_wallet_failure_contracts.py`. После `test_wallet_failure_store_returns_consecutive_retry_count` добавлена функция `test_wallet_failure_store_schedules_next_attempt_after_retry_delay` (около 60 строк). Она собирает такие же фейки, вызывает `record_failure(login="u1", iteration_id=7, message="Http error 500", retry_after_seconds=30, now=2026-05-11 10:00 UTC)` и проверяет, что `fetchval` получил `now + 30 с`.
Зачем: образцы из шагов 4, 7 и 13 дали все части: сигнатуру, порядок SQL-параметров и формулу задержки. Тест пишется по образцу соседнего и проверяет именно то, о чём задача.
Принцип: пиши тест по образцу соседнего теста и проверяй именно тот параметр, о котором он.
Результат: файл обновлён. Импорт `timedelta` в этом патче не добавлен, отсюда ошибка в шаге 19. В сводке рассуждения написано «Updating existing test», но по патчу добавлена новая функция.
### Шаг 17
Что: Shell: `uv run pytest tests/contracts/wallet/test_wallet_failure_contracts.py && uv run ruff check …` с `block_until_ms: 1000`. Команда ушла в фон (Shell 467364) до вывода.
Зачем: инструкция режима «Change or build»: внедри изменение и проверь его. Агент написал: «Сейчас проверяю тест и стиль файла».
Принцип: после правки запускай тесты и линтер того же файла.
Результат: вывода на момент ухода в фон не было. Результат пришёл через файл терминала.
### Шаг 18
Что: GetDynamicTools (namespace cursor, toolName AwaitShell): прочитала описание инструмента ожидания фоновых команд.
Зачем: ответ Shell сказал «was sent to the background», и агент хотел узнать, как дождаться результата. Рассуждение: «Planning asynchronous shell execution».
Принцип: перед вызовом инструмента ожидания прочитай его описание.
Результат: из описания видно, что без причины фоновую задачу опрашивать не надо. AwaitShell агент не вызвал, а на следующем шаге прочитал файл вывода терминала.
### Шаг 19
Что: ReadFile файла терминала `467364.txt` (27 502 символа).
Зачем: агент хотел увидеть результат фонового прогона тестов.
Принцип: результат фоновой команды читай из её файла вывода и отличай свою ошибку от чужой.
Результат: `collected 10 items`, 1 passed, 9 failed. Новый тест падает с `NameError: name 'timedelta' is not defined` (`test_wallet_failure_contracts.py:119`). Это ошибка агента. Остальные 8 тестов падают с `ModuleNotFoundError: No module named '_superbot_native'` (цепочка импорта: `workers.wallet` → `clients.kafka.wallet` → `pipelines.wallet` → `pipelines.sales_history.native`). Это не связано с правкой. pytest также сообщил, что `pytest.ini` перекрывает `pyproject.toml`.
### Шаг 20
Что: ApplyPatch: в строке 4 импорт `from datetime import UTC, datetime` заменён на `from datetime import UTC, datetime, timedelta`.
Зачем: трассировка из шага 19 указывает на `timedelta` в строке 119. Рассуждение: «Fixing timedelta import and applying patch».
Принцип: исправляй причину, которую называет трассировка, а не симптом.
Результат: импорт исправлен. `ModuleNotFoundError` агент не трогал и сборку модуля не запускал.
### Шаг 21
Что: Shell: `uv run pytest <старый тест> <новый тест> && uv run ruff check <файл> && git diff --check && git diff -- <файл>`. Команда ушла в фон (Shell 467365).
Зачем: агент сузил прогон до двух тестов. Остальные падают на `_superbot_native` (шаг 19), то есть не из-за правки. «вывод:» так он проверил именно изменённое.
Принцип: сначала проверь изменённое узко, потом линтер, потом diff.
Результат: вывода на момент ухода в фон не было. Результат — в шаге 22.
### Шаг 22
Что: ReadFile файла терминала `467365.txt` (95 723 символа, самый большой результат в ране).
Зачем: читать результат фоновой команды, как в шаге 19.
Принцип: смотри, что именно упало, потому что ошибка линтера обрывает цепочку `&&`.
Результат: `collected 2 items`, `2 passed in 0.05s`. Затем ruff: много PLC0415 (локальные импорты, например строки 11, 15, 66, 69) и ANN* (фейки без аннотаций, например строки 77, 80, 84, 87, 91, 95). Строки 66–95 относятся к новому тесту. Есть также C901 у других тестов файла. Из-за ошибки ruff цепочка `&&` не дошла до `git diff`.
### Шаг 23
Что: Shell: `git diff --check && git diff --stat && git diff -- <файл>`. Вывод собрался до ухода в фон (Shell 467366).
Зачем: в шаге 21 `git diff` не выполнился, а итог надо проверить по факту. Рассуждение: «Inspecting git diff and test coverage».
Принцип: перед отчётом проверь итоговое изменение по diff и на пробелы.
Результат: `1 file changed, 61 insertions(+), 1 deletion(-)`. Diff показал импорт `timedelta` и новую функцию. Так как `--stat` вывелся, `git diff --check` прошёл.
### Шаг 24
Что: ответ модели без инструментов: тест добавлен, два целевых теста прошли, `git diff --check` прошёл, полный файл блокируется отсутствующим `_superbot_native`.
Зачем: все нужные данные уже есть (шаги 21–23). Рассуждение: «Refining tests and ruff reporting», «Validating targeted test assertions and ruff baseline». «вывод:» ruff повторно не запускался и сборка `_superbot_native` не пробовалась.
Принцип: отчитывайся, когда проверки сделаны, и не повторяй их без новой причины.
Результат: текст сохранён как ответ. Через 2,15 с харнесс отправил следующий запрос без инструмента.
### Шаг 25
Что: ответ модели без инструментов, финальный текст (совпадает с `finalAnswer`): тест добавлен, целевые проверки прошли, `git diff --check` прошёл, полный файл и ruff блокируются «существующими проблемами окружения/файла», «дополнительные изменения не требуются».
Зачем: это итог для пользователя. Рассуждение: «Summarizing test results and issues», «Confirming final lint status and fixes». Данные шага 22 показывают, что ruff ругается и на новый тест. В ответе сказано лишь о «многочисленных lint-нарушениях» в тесте, без указания, что их добавил сам новый тест.
Принцип: итог должен назвать и результат, и то, что не проверено.
Результат: прогон завершён, `exitCode 0`, `timedOut false`. Не проверены: остальные 8 тестов файла, полный прогон и ruff по новым строкам.
