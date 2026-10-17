## Алгоритм

Источники: analysis/research-currency/*.md, data/research-currency-r1..r3.json (шаги, usage, finalAnswer), data/index.json, data/prompts. Ниже rN означает research-currency-rN. Все три прогона шли по одной схеме.

1. Разведка. Первый вызов во всех трёх прогонах: Glob `*` по корню репозитория. Результат одинаковый (длина 5 022; 931 файл, в выдаче в основном `.git`). Курсов в выдаче нет, поэтому агент переходит к поиску по тексту.
2. Поиск по синонимам. Один rg с альтернативой (`currency`, `exchange`, `курс`, `валют`, `forex`, `rates`; в r1 ещё `currency_sync`), режим «только имена файлов». Около 200 путей. По именам агент выбирает точку входа `aCurrencySync.py` и пары Python/Rust.
3. Цепочка вызовов. Один ReadFile за ответ. Следующий файл тот, на который ссылается предыдущий: runner → daemon (цикл) → run_once (один проход) → client (HTTP и ошибки) → codec (парсер) → targets (валюты) → store, store_run_state, store_sql (запись) → миграция (схема).
4. Зеркало в Rust. Те же вопросы к main.rs, config.rs, config.toml, daemon.rs (целиком), model.rs, store.rs, session.rs. Агент сравнивает одну операцию в двух реализациях.
5. Что работает в проде. Поиск `currency_sync` в compose, Makefile и Dockerfile. Прод запускает `/app/currency-sync`, а `make run` отказывается запускать `aCurrencySync.py`. Так боевой код отделяется от legacy.
6. Потребители и legacy. `rg currency_rates|currency_sync_state` даёт читателей (`rates.py`, `stats_telegram/daemon.rs`). `db_currencies/main.py` (Mongo) читается отдельно.
7. Точечные проверки: значения в `settings/runtime.py`, ключи Redis в `auth/cache.py`, контрактные тесты в `tests/contracts/currency/`.
8. Остановка. Когда у каждого пункта вопроса есть путь к файлу, идёт ответ без инструментов: отчёт на 9–12 разделов, 4 852–5 543 токена вывода, 88–101 с.

Промахи. Если путь не найден, r1 (шаг 23, «File not found») делает rg по имени константы (шаг 24). r3 (шаг 44, `platform/http.py`) не ищет повторно и оставляет утверждение непроверенным.

Параллельность. В каждом прогоне по одному вызову на ответ (37, 40 и 44 вызова за 38, 41 и 45 ответов). Правило промпта не выполнено. Вывод: модель выбирает следующий шаг только после результата предыдущего. Пауза между вызовами около 1,2–1,4 с, всего около 50 с на прогон.

| Прогон | Ответов / вызовов | Вызовы по типам | Wall, с | Модель, с | Пауза, с | Токены (доля кэша) | Выход / рассуждения | Финальный ответ |
|---|---|---|---|---|---|---|---|---|
| r1 | 38 / 37 | Glob 1, GetDynamicTools 1, rg 4, ReadFile 31 | 316,0 | 222,0 | 49,8 | 1 246 543 (93,5%) | 10 657 / 4 244 | 99,6 с, 5 493 / 1 552 |
| r2 | 41 / 40 | Glob 1, rg 6, ReadFile 33 | 320,2 | 218,5 | 51,6 | 1 403 494 (94,2%) | 10 464 / 4 953 | 87,9 с, 4 852 / 2 069 |
| r3 | 45 / 44 | Glob 1, rg 7, ReadFile 36 | 419,7 | 319,6 | 51,0 | 1 602 214 (94,7%) | 15 537 / 8 526 | 100,5 с, 5 543 / 1 552 |

Общее. Одинаковые порядок разведки и обхода и одни и те же числа: интервал 2400 с, повтор 60 с, пауза 1 с, пять валют (JPY 8, EUR 3, RUB 5, CNY 23, KZT 37). При 429 Python ставит cooldown 60 с и останавливает пакет, Rust ставит 7200 с и продолжает пакет. Запись идёт в `currency_rates` и `currency_sync_state`.

Различия. r1 сделала меньше всего чтений (31 ReadFile). Она не читала Rust-авторизацию (`rust/services/auth`) и не назвала потребителя `stats_telegram`. r2 дошла до `rust/services/auth/src/redis_cache.rs` и `Makefile:30–43`, но не упомянула нативный парсер `_superbot_native`. r3 потратила больше всего рассуждений (8 526 токенов; пять шагов по 817–1 057 токенов: 38, 39, 41, 43, 44). Вывод: причина в выборе «настоящего» кода между Python, Rust и legacy.

Качество относительно задачи. Все три выполнили условия: отчёт в чате, по-русски, с путями, без правок и запусков. Числа совпадают между прогонами. Общая слабость: ни в одном финальном тексте нет `danger_accept_invalid_certs(true)` (Rust-клиент, daemon.rs:610 по анализу r1), хотя все три прочитали `daemon.rs`. Кроме того, r1 называет aCurrencySync.py одновременно «NG-entrypoint» и «legacy», r3 подаёт `proxy=None` без пометки «не проверено», а код в отчётах не оформлен по правилу `startLine:endLine:filepath`.

## Принципы

- Только чтение. «Answer, explain, review, or status: inspect as needed and give an evidence-backed answer. These requests do not authorize file edits, external writes, messages, PR changes, or other mutations unless the user also asks for a change.» Подтверждение: в трёх прогонах нет Shell и ApplyPatch (data/index.json, toolCounts).
- Поиск инструментами, не shell. «When searching for text or files, prefer the dedicated search tools available to you (`rg`, `Glob`) over shell search commands.» Подтверждение: Shell 0 раз; rg 4, 6 и 7 раз; первый вызов Glob (шаг 1) во всех прогонах.
- Параллельность не выполнена. «When possible, parallelize independent tool calls rather than running them sequentially.» Подтверждение: один callId на ответ; по анализу r3, шаги 3–9 можно было прочитать одним пакетом.
- Каждое чтение ведёт к следующему. Новый файл выбирается по импорту или вызову из предыдущего: r1 шаги 4→5→6→7, r2 шаги 3→4→5→6. Это наблюдаемая стратегия, а не цитата промпта.
- Сверка двух реализаций по одним точкам. Одна и та же роль читается в Python и в Rust: r1 шаги 14–19, r2 шаги 16–21, r3 шаги 14–18.
- Прод определяется деплоем, а не наличием кода. «Прод» выводится из compose, Makefile и Dockerfile: r1 шаги 30–31, r2 шаги 22 и 28, r3 шаги 21, 29–30.
- Не угадывать путь, а искать. r1 шаг 23 → шаг 24 (rg по имени). Противоположный случай: r3 шаг 44 оставил непроверенное утверждение. Правило: «Verify uncertain claims. When a claim is wrong or risky, say so directly and explain the technical reason.»
- Прямая просьба о формате важнее skill. Canvas-навык: «You MUST use a canvas when the agent produces a standalone analytical artifact». Пользователь попросил «в чат». r1 (шаг 38) и r2 (шаг 41) обсуждали canvas и ответили в чате; по анализу, выбор сделан по просьбе пользователя.
- Итог первым. «Lead with the outcome, not the steps you took to get there.» Финалы открываются ответом о production: r1 «Краткий вывод», r2 «1. Какая версия используется в production», r3 «1. Общая схема».
- Формат. «Avoid over-formatting responses with bold emphasis, headers, lists, and bullet points.» Финалы содержат 9–12 разделов, таблицы и блоки кода. Объём оправдан просьбой «подробный отчёт», но заголовков много.
- Секреты в отчёт не переносятся. В `db_currencies/main.py` учётные данные открытым текстом; отчёты их не повторили (r1 шаг 35, r2 шаг 32). В r3 шаг 19 сказано: «Секретные значения из файла в отчёт не попали». Это наблюдаемое поведение, не правило промпта.
