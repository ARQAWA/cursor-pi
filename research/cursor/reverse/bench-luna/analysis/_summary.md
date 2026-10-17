# Общий алгоритм агента

## Как устроен один шаг

На каждом шаге Cursor отправляет модели весь пакет: системный промпт (developer.txt), user-context (git status на старте, список субагентов и навыков, каталог динамических инструментов, запрос пользователя), список инструментов (tools.json: Shell, Glob, rg, ReadFile, ApplyPatch, AskQuestion, GetDynamicTools, CallDynamicTool) и всю историю прошлых шагов. Модель отвечает одним из двух способов: делает ровно один вызов инструмента или пишет финальный текст без вызова. Cursor выполняет вызов, добавляет результат в историю и шлёт следующий запрос. Рассуждение зашифровано: видны только короткие заголовки и счётчики токенов (токен примерно равен кусочку слова).

В каждом из 21 прогонов на ответ приходился один вызов. Ответ без вызова (финал) был один в 17 прогонах и два в четырёх (edit-complex-backoff ×3 и add-test-r2).

Вход растёт, потому что история шлётся заново. У needle-api-port-r1 вход вырос с примерно 9 150 до 18 413 токенов за четыре запроса (всего 54 733). У edit-short-retry: с 9,1 тыс. до 20,5 тыс. (r1) и до 14,5 тыс. (r3). В длинных прогонах в среднем 32–42 тыс. входа на запрос (research-currency-r1: 1 235 886 за 38 ответов; edit-complex-backoff-r1: 2 580 182 за 65).

Почти весь вход берётся из кэша: 93–96 % в research и complex, 84–95 % в diagnose, 62–89 % в коротких задачах. Вывод: неизменная часть (промпт, инструменты, старая история) кэшируется, а каждый шаг добавляет только новый хвост.

Время делится на четыре части. «До запроса» = wall − spanMs, «подготовка» = spanMs − модель − пауза, секунды:

| Прогон | До запроса | Подготовка | Модель | Пауза и инструменты | Wall |
|---|---|---|---|---|---|
| needle-api-port-r1 | 12,1 | 4,7 | 10,5 | 3,7 | 31,0 |
| add-test-r2 | 9,3 | 24,7 | 58,3 | 51,7 | 144,0 |
| research-currency-r1 | 13,6 | 30,6 | 222,0 | 49,8 | 316,0 |
| diagnose-currency-r1 | 7,7 | 63,1 | 194,4 | 76,2 | 341,4 |
| edit-complex-backoff-r2 | 8,0 | 53,6 | 434,6 | 78,8 | 575,0 |
| edit-complex-backoff-r1 | 12,8 | 68,1 | 184,4 | 175,8 | 441,0 |

В коротких задачах модель занимает 13–41 % времени (needle-api-port-r2: 5,1 из 39,7 с). В длинных — 57–76 % (research-currency-r1: 222 из 316 с). Подготовка около 1 с на запрос. Пауза между вызовами в research — 1,2–1,4 с. Пауза 176 с в edit-complex-backoff-r1 — вывод: ожидание фоновых команд (pytest, cargo) через AwaitShell. Reasoning составляет от 11 % (needle) до 78 % (diagnose-currency-r1) от выхода. Он всегда меньше output, поэтому вывод: он входит в output.

## Универсальный алгоритм

1. Точное совпадение первым. Из запроса берётся число или имя, и по нему идёт rg (edit-short-retry: «30»; edit-rename: старое имя). Если структура неизвестна, сначала Glob `*` (research-currency ×3, diagnose-currency-r1 и r3, edit-complex-backoff-r1 и r3).
2. Широкий поиск по синонимам, затем сужение. needle-api-port-r1: `(?i)(port|listen|http|api)`, 6 993 совпадения, затем `bind|TcpListener`. edit-complex-backoff-r1: `retry_count|wallet|sync`, затем только `retry_count`.
3. Точка входа и цепочка. Файл читается целиком, следующий файл берётся из импорта или вызова (research-currency, diagnose-currency).
4. Все места значения. rg по имени ключа или функции (`failure_retry_seconds`, `record_failure`, `.failed(`). Перед правкой ищутся все вызывающие (edit-complex-backoff-r1, шаг 27).
5. Тип, конфиг, тесты. Тип поля (config.rs: u64), манифест, ближайший тест как образец.
6. Правка через ApplyPatch, один файл за вызов.
7. Проверка и остановка. `git diff --check`, `git diff`, повторный rg по старому имени, cargo check, узкий pytest. Затем ответ без инструментов.

## Алгоритм по типам задач

### Сложный сбор (research-currency)
Glob `*`, rg по синонимам (currency, exchange, курс, валют, forex, rates), 31–36 чтений по цепочке, сравнение Python и Rust одной операции, затем «что работает в проде» (compose, Makefile, Dockerfile). Shell и ApplyPatch не использовались. Отличия: r1 не читала Rust-авторизацию, r2 не упомянула нативный парсер.

### Точечный вопрос (needle-api-port)
Широкий rg, проверка config.toml (ключа порта там нет), rg по `bind`/`TcpListener`, чтение нужного места, ответ. 3–5 вызовов, 27–40 с. Решает фильтр типов файлов: при `*.py` (r2) первым найден botApi.py, без него (r1, r3) только Rust main.rs.

### Короткая правка (edit-short-retry)
rg «30» (шум: 734+ совпадений), rg по wallet|sync, окно вокруг ключа, поиск читателей ключа, ApplyPatch 30 → 60, git diff. 5–9 вызовов, 41–53 с. Решает точное место: `failure_retry_seconds` есть в `[wallet_sync]` (config.toml:66) и в `[stats_telegram]` (82). Итоговые diff у всех трёх одинаковы.

### Сложная правка (edit-complex-backoff)
51–63 вызова, 441–575 с. Все три перенесли расчёт в один SQL-UPDATE счётчика. В SET стоит старое retry_count, поэтому результат равен 30 × 2^(новое − 1), потолок 1800 с. Ограничение: r1 через CASE при значении ≥ 6, r2 и r3 через LEAST(…, 6) в степени. Python и Rust сделаны одинаково. Проверки: cargo check прошёл у всех трёх, pytest одного файла: 1 прошёл, 8 упали на `_superbot_native`. Решает место расчёта (SQL или Python после RETURNING). Перед выбором r1 вызвала субагента.

### Переименование (edit-rename)
rg по старому имени → чтение двух файлов целиком → ApplyPatch: 5 замен в двух файлах → rg пусто → git diff (r2, r3). 6–7 вызовов, 38–50 с. Ничего не решалось. Не проверено: порядок импортов в login_sync.py стал не по алфавиту, код не собирался.

### Диагностика (diagnose-currency)
Glob или rg, выбор входа (Python daemon или Rust), цепочка вызовов, прод по docker-compose (`/app/currency-sync`), проверка гипотез тестами, ответ. 30–59 вызовов, 236–341 с, без правок. Решает выбор входа. Гипотеза о блокировке прокси отвергнута контрактными тестами (r1, r3). Цепочка r1 и r3 ведёт к `is_redirect` → AuthInvalid (daemon.rs:375). r2 назвала другой узел: retry auth-воркера с тем же прокси.

### Новый тест (add-test)
rg по имени → чтение test_wallet_failure_contracts.py и соседнего файла целиком → путь значения до источника (`WALLET_FAILURE_RETRY_SECONDS = 30`) → ApplyPatch нового теста после существующего → pytest. 10–23 вызова, 57–144 с. Решает способ запуска. r2 перешла на `uv run`, исправила импорт `timedelta` и получила 2 passed. r1 и r3 получили exit 4 на голом pytest и остановились. r1 взяла 45 с вместо 30.

## Как агент выбирает следующий шаг

- Имя из прошлого результата → следующее чтение. research-currency: runner → daemon → run_once → client → codec → targets → store. diagnose-currency: daemon → run_once → client → proxy_lock.
- Шумный результат → точный идентификатор. edit-complex-backoff-r1, шаги 3 → 4: `retry_count|wallet|sync` (200 строк шума) → `retry_count`.
- Пустой результат → другой способ. edit-short-retry-r2, шаг 6: rg по tests/ дал «No matches found», тесты не меняются. add-test-r3, шаг 4: glob `superbot_ng/**` пуст → шаг 5: поиск по именам `**/*wallet*`.
- Путь не найден → поиск по имени. research-currency-r1, шаг 23 «File not found» → шаг 24: rg по имени константы. diagnose-currency-r1 и r3, шаг 8: `runtime.py` не найден → Glob `**/runtime.py` → rg `def wait_or_stop`.
- Каталог сборки не найден → искать манифест. edit-complex-backoff-r1, шаги 41–42: cargo в корне не нашёл Cargo.toml → запуск из `rust/`. edit-complex-backoff-r2, шаги 38–39: Glob `Cargo.toml`.
- Ошибка инструмента → исправить запрос. edit-complex-backoff-r1, шаг 19: `record_failure(` дал unclosed group → шаг 20 с экранированием.
- Патч не встал → перечитать и убрать префиксы номеров строк. edit-complex-backoff-r2, шаг 21 (в контекст попали «10|») → шаг 22.
- Программа или пакет не найдены → взять имя из манифеста или окружения. edit-complex-backoff-r2, шаги 44–46: `wallet_sync` → `superbot-wallet-sync`. Шаг 54: `python` нет → `uv run`.
- Тест упал → трассировка, правка, узкий повтор. add-test-r2, шаги 17–21: NameError → импорт → 2 passed.
- «has been updated» не доверять → проверить diff. edit-short-retry-r3, шаг 5. edit-rename-r2 и r3, шаг 7.
- Ответ уже есть в выдаче → не открывать файл. needle-api-port-r1, шаг 4: ответ по строкам поиска без ReadFile.
- Гипотеза не подтверждена тестом → сменить гипотезу. diagnose-currency-r1, шаг 36.

## Когда он останавливается и как проверяет

- Критерий остановки: ответ полный. Research: у каждого пункта вопроса есть файл. Needle: есть значение и путь. Diagnose: цепочка замкнута, непроверенные звенья названы. Edit: diff показывает нужные строки, старого имени нет.
- Проверки в данных: `git diff --check` (short-retry r1–r2, rename r2–r3, complex ×3), `git diff` или `git status`, rg по старому имени (rename), cargo check (complex), узкий pytest (complex, add-test). Вывод фоновых команд читается через ReadFile файла терминала.
- Ни в одном прогоне не проверялись: SQL на PostgreSQL, перезапуск или пересборка сервиса, полный набор тестов. Вывод: в edit-short-retry работающий процесс читает config.toml один раз (`wallet_sync/src/main.rs:35`), поэтому новое значение не действует до пересборки.
- Финальный текст иногда писался дважды: edit-complex-backoff-r1 (шаги 64–65), r2 (57–58), r3 (52–53).

## Субагенты и динамические инструменты

- Subagent нет в основном списке инструментов (tools.json: 8 позиций). Агент вызывает его через GetDynamicTools (namespace `cursor`), затем через CallDynamicTool. В namespace также есть AwaitShell (опрос фонового Shell), SwitchMode, TodoWrite, WebFetch, WebSearch и другие.
- Счёт по 21 прогонам: GetDynamicTools 10 вызовов в 6 прогонах. CallDynamicTool 14 вызовов: 12 AwaitShell (все в edit-complex-backoff) и 2 Subagent.
- Субагент запускался дважды. edit-complex-backoff-r1: тип explore, задача «Trace wallet retry behavior», 16 ответов, 15 вызовов (ReadFile 10, rg 3, Glob 2), 292 360 токенов, около 68 с. Отчёт совпал с тем, что главный агент видел сам. diagnose-currency-r3: главный агент сам прочитал daemon.rs и session.rs, затем субагент (16 ответов, 15 вызовов, 348 315 токенов, 81 с) перечитал те же файлы. Главный ждал 84,7 с и почти дословно повторил его вывод.
- Границы задаёт описание инструмента, а не системный промпт. Цитата из описания: «If the query is a narrow or specific question, you should NOT use the Subagent». add-test-r2 прочитала её и субагента не вызывала. Ещё одна цитата: «Avoid delegating the full query to the Subagent tool and returning the result.» AwaitShell: «Prefer NOT to poll reflexively». edit-complex-backoff-r1 опрашивала фоновый процесс 8 раз.
- Вывод: субагент не дал нового результата, но добавил 290–350 тыс. токенов и повторные чтения.

## Правила промпта: что соблюдается, что нет

Правила одинаковы в developer.txt всех 23 файлов (21 основной и 2 субагента): проверено по трём фразам.

| Правило (дословно) | Соблюдается? | Доказательство |
|---|---|---|
| «When possible, parallelize independent tool calls rather than running them sequentially.» | Нет | В 21 из 21 прогонов один вызов на ответ. research-currency-r1, шаги 4–7: независимые чтения шли по одному |
| «When searching for text or files, prefer the dedicated search tools available to you (`rg`, `Glob`) over shell search commands.» | Да | В research и needle Shell не использовался. Единственный rg внутри Shell: add-test-r2, шаг 12 |
| «If a tool exists for an action, prefer to use the tool instead of shell commands (e.g ReadFile over cat).» | Да | Shell только для git, pytest, cargo, uv. Вывод терминалов читается через ReadFile (edit-complex-backoff-r1, шаг 33) |
| «Try to use `ApplyPatch` for single-file edits, but use formatting commands…» | Да | Все правки через ApplyPatch, ни одной через Shell |
| «Do not send commentary merely because you are reading files, searching, running tools, thinking, about to edit, or because time passed.» | Да | Текст между вызовами пуст (edit-short-retry r1–r3). В edit-rename: «Промежуточных сообщений нет» |
| «Lead with the outcome, not the steps you took to get there.» | В основном да | edit-rename: «Переименовал record_wallet_failure в persist_wallet_failure…». research-currency r2 и r3 открываются разделом «1. …» |
| «Avoid over-formatting responses with bold emphasis, headers, lists, and bullet points.» | Частично | research: 9–12 разделов и таблицы (объём оправдан просьбой «подробный отчёт»). needle: **55789** и маркеры |
| «Remember that line numbers must NOT be included for non-codeblock citations (e.g. citing a filepath).» | Нет | needle, все три ответа: пути с номерами строк (main.rs:28, botApi.py:120) |
| «Verify uncertain claims. When a claim is wrong or risky, say so directly and explain the technical reason.» | Частично | edit-complex-backoff-r1–r3 прямо пишут, что SQL не запускали. add-test-r1 и r3 не сказали, что в тесте нет импорта timedelta. research-currency-r3 подала `proxy=None` без пометки |
| «Diagnose: determine the cause and explain it. Do not implement the fix unless the user asks for it…» | Да | diagnose-currency: 0 ApplyPatch. git status пуст (diagnose-currency-r3, шаг 26) |
| «Answer, explain, review, or status: inspect as needed and give an evidence-backed answer. These requests do not authorize file edits…» | Да | research и needle: ни одной правки и ни одного Shell |
| «Transient technical friction: retry or use a relevant alternative.» | Частично | add-test-r2 перешла на `uv run` и заработала. add-test-r1 и r3 остановились на exit 4. `_superbot_native` в complex принят за окружение без проверки на чистом дереве |
| «Change or build: implement the requested change, verify it in proportion to risk, and hand off the completed result while a safe, relevant next step remains.» | Частично | Diff проверен в коротких правках и переименованиях. Никто не сказал, что сервис надо перезапустить |
| «You MUST use a canvas when the agent produces a standalone analytical artifact» (навык из user-context, не системный промпт) | Нет, по просьбе пользователя | research-currency r1 и r2 ответили в чат, потому что пользователь попросил «в чат» |

## Слабые места и разброс между повторами

- Побочный эффект не назван в финале. Во всех трёх edit-complex-backoff задержка из Steam 429 (`retry_after`) и `failure_retry_seconds` из конфига перестала влиять на расписание. r1 написала об этом по ходу (шаг 55), но не в финале. r2 и r3 не назвали его в финальном тексте.
- Проверка слабая. SQL ни разу не выполнялся в PostgreSQL. Тесты проверяют подстроки SQL, а не значения 30, 60 и 1800 с. В edit-complex-backoff 8 из 9 тестов файла падают на `_superbot_native`. add-test-r2 запускала только два теста, и они прошли.
- Окружение понято неодинаково. add-test-r1 и r3 приняли SyntaxError в conftest (exit 4) за дефект кода. r3 назвала его «синтаксис Python 2», это не проверено. Проект закреплён на Python 3.14.4 (pyproject.toml, по данным add-test-r2).
- Дефект теста не назван. В тесте add-test-r1 и r3 нет импорта `timedelta`, значит будет NameError. Ни один из двух отчётов этого не сказал.
- Выводы расходятся. diagnose-currency-r2 назвала другой узел, чем r1 и r3. В needle «API бота» не разрешён ни в одном ответе: Rust-сервис в проде, Python botApi.py отключён Makefile:37. В research ни один финал не упомянул `danger_accept_invalid_certs(true)` (daemon.rs), хотя все три прочитали этот файл.
- Ошибки ввода. Пути терминалов набирались вручную: edit-complex-backoff-r3 получила «File not found» четыре раза, r2 два раза, r1 один раз. Патч с префиксами «10|» не встал трижды (r2 шаг 21; r3 шаги 22 и 29).
- Разброс между повторами. add-test: 10, 23 и 15 вызовов, 57, 144 и 72 с. diagnose: 59, 46 и 30 вызовов. edit-complex-backoff: 63, 56 и 51 вызов, 441–575 с. Задача одна, глубина разная. Вывод: решение модели на каждом шаге, рассуждение не видно.
- Два финала и лишние ответы. Три прогона edit-complex-backoff писали два итоговых текста. add-test-r2 имела два ответа без вызова.
- Старт. До первого запроса уходило 7,7–23,8 с у одинаковых задач. Вывод: это задержка харнесса, а не работа агента.

## Таблица всех прогонов

Ответов — ответы модели. G — Glob, GD — GetDynamicTools, CD — CallDynamicTool, RF — ReadFile, AP — ApplyPatch, Sh — Shell. Wall и модель в секундах. Токены и reasoning — основной агент, как в index.json. Субагент — в скобках его токены.

| Прогон | Ответов | Вызовы | Wall, с | Модель, с | Токены всего | Reasoning | Субагент | Итог |
|---|---|---|---|---|---|---|---|---|
| research-currency-r1 | 38 | 37: rg 4, RF 31, G 1, GD 1 | 316,0 | 222,0 | 1 246 543 | 4 244 | нет | отчёт с путями, без правок |
| research-currency-r2 | 41 | 40: rg 6, RF 33, G 1 | 320,2 | 218,5 | 1 403 494 | 4 953 | нет | отчёт с путями, без правок |
| research-currency-r3 | 45 | 44: rg 7, RF 36, G 1 | 419,7 | 319,6 | 1 602 214 | 8 526 | нет | отчёт, один путь непроверен |
| needle-api-port-r1 | 4 | 3: rg 2, RF 1 | 31,0 | 10,5 | 55 137 | 45 | нет | порт 55789, Rust |
| needle-api-port-r2 | 6 | 5: rg 2, RF 3 | 39,7 | 5,1 | 91 423 | 79 | нет | порт 55789, Python |
| needle-api-port-r3 | 6 | 5: rg 3, RF 2 | 27,1 | 6,1 | 97 701 | 79 | нет | порт 55789, оба места |
| edit-short-retry-r1 | 9 | 8: rg 4, RF 2, AP 1, Sh 1 | 53,1 | 22,0 | 158 703 | 241 | нет | 30 → 60 в config.toml |
| edit-short-retry-r2 | 10 | 9: rg 4, RF 3, AP 1, Sh 1 | 47,0 | 15,1 | 173 789 | 285 | нет | то же, читатели проверены |
| edit-short-retry-r3 | 6 | 5: rg 2, RF 1, AP 1, Sh 1 | 40,8 | 16,9 | 79 676 | 154 | нет | то же, без поиска по словам |
| edit-complex-backoff-r1 | 65 | 63: GD 3, G 2, rg 8, RF 21, CD 9, Sh 7, AP 13 | 441,0 | 184,4 | 2 597 046 (+292 360) | 10 059 (+133) | 1: 16 ответов, 15 вызовов | SQL-формула, 8 тестов на окружении |
| edit-complex-backoff-r2 | 58 | 56: rg 6, RF 25, G 2, AP 11, Sh 8, GD 2, CD 2 | 575,0 | 434,6 | 2 234 471 | 15 210 | нет | SQL-формула, проверка неполная |
| edit-complex-backoff-r3 | 53 | 51: G 2, rg 4, RF 24, Sh 7, AP 11, GD 1, CD 2 | 539,9 | 394,6 | 2 267 441 | 13 207 | нет | SQL-формула, два патча не встали |
| edit-rename-r1 | 7 | 6: rg 2, RF 2, AP 2 | 42,8 | 15,2 | 72 541 | 123 | нет | 5 замен, без diff |
| edit-rename-r2 | 8 | 7: rg 2, RF 2, AP 2, Sh 1 | 37,5 | 7,7 | 84 422 | 116 | нет | 5 замен, diff чистый |
| edit-rename-r3 | 8 | 7: rg 2, RF 2, AP 2, Sh 1 | 50,3 | 9,6 | 84 686 | 305 | нет | 5 замен, diff чистый |
| diagnose-currency-r1 | 60 | 59: G 1, rg 18, RF 39, Sh 1 | 341,4 | 194,4 | 2 230 757 | 17 402 | нет | цепочка до redirect, не проверен |
| diagnose-currency-r2 | 47 | 46: rg 12, RF 30, G 3, Sh 1 | 311,5 | 189,5 | 2 554 191 | 20 606 | нет | другой узел: auth-воркер |
| diagnose-currency-r3 | 31 | 30: G 2, rg 5, RF 20, Sh 1, GD 1, CD 1 | 236,4 | 76,4 | 816 460 (+348 315) | 4 146 (+2 048) | 1: 16 ответов, 15 вызовов | та же цепочка, со строками |
| add-test-r1 | 11 | 10: rg 3, RF 4, AP 1, Sh 2 | 57,2 | 20,7 | 224 557 | 498 | нет | тест написан, exit 4 |
| add-test-r2 | 25 | 23: GD 2, G 3, RF 10, rg 2, Sh 4, AP 2 | 144,0 | 58,3 | 807 509 | 2 364 | нет | тест исправлен, 2 passed |
| add-test-r3 | 16 | 15: rg 4, RF 6, G 1, AP 2, Sh 2 | 72,3 | 26,8 | 315 421 | 1 064 | нет | тест написан, exit 4 |
