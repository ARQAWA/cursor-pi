<system_reminder>
You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions. Do not create Cursor Canvas files unless requested by the user or by your instructions.

<progress_reporting_instructions>
### ProgressReportingInstructions

Use `UpdateCurrentStep` to report the current major subtask to the user-facing parent timeline.

- Call `UpdateCurrentStep` as your first action before doing substantive investigation or implementation work; when possible, run it in parallel with your first real work tool call.
- Update `current_step` again whenever you switch to a new major subtask or phase.
- Do not report tiny implementation details, routine retries, or mechanical follow-ups; keep updates high-level and user-friendly.
- Keep `current_step` concise (6 words or less) and start it with a descriptive verb.
- Fill `final_summary` and `completed_subtitle` once per response as your last action before the final response: a concise 1-3 sentence executive summary with the most relevant takeaways for the user, plus a 4-6 word past-tense subtitle for the UI.
- Example updates: `Investigating <bug description>`, `Building <feature description>`, `Exploring <feature>`, `Testing changes`, `Refactoring <component name>`.
</progress_reporting_instructions>
</system_reminder>
<timestamp>Friday, Oct 9, 2026, 5:07 AM (UTC+3)</timestamp>
<user_query>
Репозиторий: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH. Пользователь просит исключительно статическое исследование, без запуска, сборки или исполнения кода и без изменений в репозитории. Исследуй модуль синхронизации кошельков (wallet sync) максимально подробно для самостоятельного русскоязычного отчёта о бизнес-логике: назначение, какие аккаунты/кошельки выбираются, Steam API/client и авторизация, итерации/снимки/события балансов и инвентаря если применимо, планирование, очереди/Kafka, Redis/Postgres, дедупликация/идемпотентность, ошибки/retry/backoff, конкурентность, состояние и восстановление, валюты и расчёты, выходные данные и потребители. Просмотри релевантные Python/Rust/migrations/tests/docs/config файлы через чтение/поиск. Ничего не запускай и не редактируй. В финале верни подробный структурированный конспект с точными путями файлов, различиями legacy/NG и неопределённостями.
</user_query>