## Алгоритм

Задача — поменять одно число в конфиге. Все три прогона дали один и тот же итоговый diff (blob `df0dabb` совпадает), различалась только глубина разведки.

1. **Точное число из запроса.** Первый вызов — `rg` по `30` по всему репозиторию, `head_limit` 100 (шаг 1 во всех трёх). Выдача шумная: «at least 734» совпадений, первые 100 заняты `Cargo.lock` и другими сервисами. Полезные попадания: `config.toml:66`, `:74`, `:82`.
2. **Слова запроса → имена кода** (только r1 и r2). `rg` по `wallet|синх|sync`. r1 ограничил glob `*.{rs,toml,md,yml,yaml,json}`, r2 исключил `rust/Cargo.lock`. Находит `[wallet_sync]` в `config.toml:58`, сервис в `docker-compose.app.yml:57`, каталог `rust/services/wallet_sync`. r3 этот шаг пропустил.
3. **Раздел конфига.** `ReadFile` вокруг строки 66 (r1 и r2: offset 50, limit 40; r3: offset 55, limit 35). Раздел `[wallet_sync]` (строки 58–68) отделяет нужную строку от `[stats_telegram]` (82), где такой же ключ.
4. **Кто читает ключ.** `rg "failure_retry_seconds"` по репозиторию (r1 шаг 6, r2 шаг 4, r3 шаг 3). Ответ: `config.rs:21` и 10 мест в `daemon.rs` (190–342), плюс одноимённые ключи `stats_telegram` и `telegram_sender.py`. Вывод агента: код берёт значение из конфига, значит менять надо конфиг.
5. **Тип и валидация** (r1 шаг 5, r2 шаг 5). `ReadFile` `config.rs` целиком. Поле `u64`, `validate()` его не проверяет, значит 60 пройдёт.
6. **Тесты** (r2 шаг 7). `rg` по `tests/` вернул «No matches found», тесты менять не нужно.
7. **Правка.** `ApplyPatch` по одному файлу: `-failure_retry_seconds = 30`, `+… = 60`. r1 дал контекст из двух строк выше и одной ниже. r2 дал одну строку ниже (`kafka_payload_max_bytes`). r3 дал без контекста, хотя строка есть дважды. Правка легла на строку 66 (`@@ -63,7 +63,7 @@`), то есть на первое совпадение.
8. **Проверка инструментом.** `Shell`: `git diff --check && git diff -- config.toml` (r1, r2) или `git diff -- config.toml && git status --short` (r3). Тесты и сборку не запускали.
9. **Стоп.** Когда diff показывает ровно одну пару строк с нужным значением, модель пишет ответ без вызовов. Текста между шагами не было (assistantText пуст). Итог — одно-два предложения, результат первым.

Цепочка решений видна по сводкам рассуждений: «Investigating retry delay for wallet sync» → «Inspecting wallet sync configuration» → «Inspecting wallet sync retry settings» → «Examining wallet config tests» → «Modifying wallet sync retry in config.toml».

| Показатель | r1 | r2 | r3 |
|---|---|---|---|
| Ответов модели / ответов с вызовом | 9 / 8 | 10 / 9 | 6 / 5 |
| Вызовы по типам | rg 4, ReadFile 2, ApplyPatch 1, Shell 1 | rg 4, ReadFile 3, ApplyPatch 1, Shell 1 | rg 2, ReadFile 1, ApplyPatch 1, Shell 1 |
| Вызовов в одном ответе | максимум 1 | максимум 1 | максимум 1 |
| Wall / span / модель, с | 53,1 / 40,8 / 22,0 | 47,0 / 39,5 / 15,1 | 40,8 / 29,4 / 16,9 |
| Вход / из кэша | 157 731 / 132 096 (84%) | 172 758 / 148 224 (86%) | 79 113 / 49 152 (62%) |
| Выход / reasoning | 972 / 241 | 1 031 / 285 | 563 / 154 |
| Всего токенов | 158 703 | 173 789 | 79 676 |
| Итог | `config.toml:66`, 30→60 | то же | то же |

Общее: один вызов за ответ, ApplyPatch для одного файла, Shell только для git diff, итог на русском. Различается глубина. r3 пропустил поиск по словам и чтение кода. r2 читал `daemon.rs` со строки 160. Входные токены растут, потому что каждый шаг заново отправляет накопленный контекст: 9,1k → 20,5k (r1), 9,1k → 20,2k (r2), 9,1k → 14,5k (r3). Поэтому объём токенов пропорционален числу шагов. Время идёт в основном на ответы модели, около 4–5 с на шаг. Инструменты занимали 1–2,5 с (Shell 1,3–2,5 с). Почему глубина разная, по данным не видно, reasoning зашифрован. Вывод: это решение модели на каждом шаге.

Качество относительно задачи. Изменена единственная строка, которую читает сервис кошелька: `failure_retry_seconds` в `[wallet_sync]` (`config.toml:66`). `stats_telegram` (82) и `currency_sync` `auth_blocker_seconds` (74) не тронуты. Я проверил по коду: путь rate limit берёт задержку из `proxy_cooldown_seconds` и `Retry-After` (`session.rs:176–192`), значит правка его не касается. Тест `daemon.rs:471, 477` передаёт `Some(60)` литералом, `session.rs:455` тоже литерал. Жёстких 30 для повтора в `wallet_sync/src` нет.

Пробелы:
- Ни один ответ не сказал, что значение вступит в силу только после пересборки и перезапуска. Факты: `Dockerfile:66` `COPY config.toml /app/config.toml`, `wallet_sync/src/main.rs:35` читает конфиг один раз в `run()`, `Makefile:92–93` использует `up --no-build --force-recreate`. Вывод: работающий сервис продолжит повторять через 30 с до пересборки образа и пересоздания контейнера. Сам процесс деплоя я не проверял.
- Тесты и сборка не запускались. `git diff --check` проверяет только пробелы.
- Поправка к анализу r1: «в каждом ответе был ровно один вызов» неточно. Девятый ответ — текст без вызовов.

## Принципы

- **Начинай с точного значения из запроса.** Шаг 1 во всех трёх прогонах — `rg` по `30` (`data/edit-short-retry-r1–r3.json`, step 1), без перевода слов.
- **Одно значение может стоять в нескольких разделах, смотри раздел.** `failure_retry_seconds = 30` есть в `[wallet_sync]` (66) и `[stats_telegram]` (82). Все три читали окно вокруг строки (r1 шаг 4, r2 шаг 3, r3 шаг 2).
- **Перед правкой найди, кто читает ключ.** Поиск по имени ключа: r1 шаг 6, r2 шаг 4, r3 шаг 3. Код берёт значение из `self.config.wallet_sync` (`daemon.rs:190`), поэтому правится конфиг.
- **Используй выделенный инструмент, а не shell.** Verbatim: «If a tool exists for an action, prefer to use the tool instead of shell commands (e.g ReadFile over cat).» и «When searching for text or files, prefer the dedicated search tools available to you (`rg`, `Glob`) over shell search commands.» 19 из 22 вызовов — rg, ReadFile или ApplyPatch.
- **Одна точечная правка через ApplyPatch.** Verbatim: «Try to use `ApplyPatch` for single-file edits, but use formatting commands for generated output and scripts for efficient bulk mechanical changes.» Во всех трёх прогонах одна правка одного файла.
- **Проверяй результат по diff, а не по сообщению инструмента.** Verbatim: «implement the requested change, verify it in proportion to risk, and hand off the completed result while a safe, relevant next step remains.» r3: ответ «has been updated» не показывает, что изменилось, поэтому запущен `git diff` (шаг 5).
- **Перед правкой проверь тип и правила проверки.** r1 шаг 5 и r2 шаг 5: прочитан `config.rs`, поле `u64`, `validate()` его не трогает.
- **Параллель независимые вызовы — правило не выполнено.** Verbatim: «When possible, parallelize independent tool calls rather than running them sequentially.» Все 22 вызова шли в отдельных ответах. r1 шаги 4 и 5 (два чтения) не зависели друг от друга.
- **Промежуточный текст не нужен.** Verbatim: «Do not send commentary merely because you are reading files, searching, running tools, thinking, about to edit, or because time passed.» assistantText пуст на всех шагах с вызовами.
- **Сначала результат, потом шаги.** Verbatim: «Lead with the outcome, not the steps you took to get there.» Все три итога начинаются с «Задержка повтора синхронизации кошелька … с 30 до 60 секунд».
- **Останавливайся, когда безопасного следующего шага нет.** После зелёного diff — ответ без вызовов (r1 шаг 9, r2 шаг 10, r3 шаг 6). Перезапуск и тесты никто не предложил, см. пробелы в разделе «Алгоритм».
