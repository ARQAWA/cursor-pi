# Sol (6c6c0e1a) и GPT-5.5 (e011a12a): что разное

Источник: журналы адаптера kimi-codex-proxy-87797.jsonl (Sol) и kimi-codex-proxy-89249.jsonl (gpt-5.5, отправлен на Sol). Разобранные элементы — в sol/ и gpt-5.5/.

## Системный промпт
Промпты разные по составу, а не только по имени модели.

| | Sol | GPT-5.5 |
|---|---|---|
| Main | 15 499 знаков: epistemic_rigor, general, getting_work_done, technical_communication, system-communication, autonomy_and_persistence, editing_constraints, mode_selection, dynamic_tools, terminal_files_information, working_with_the_user, visualizations, main_goal | 19 362 знака: general, system-communication, editing_constraints, engineering_judgment, special_user_requests, mode_selection, dynamic_tools, terminal_files_information, working_with_the_user, main_goal |
| Субагенты | 12 465 и 12 473: без mode_selection и dynamic_tools | 15 983 и 16 120: без mode_selection и dynamic_tools |

GPT-5.5 получает промпт в стиле Codex: «senior engineer's judgment», multi_tool_use.parallel, ASCII по умолчанию, правила грязного дерева git, engineering_judgment, special_user_requests. У Sol вместо этого epistemic_rigor, autonomy_and_persistence, technical_communication, visualizations.

## Инструменты
Четыре набора одинаковы байт в байт у обеих моделей: Main, explore/generalPurpose, browser-use (Glob, rg, ReadFile, UpdateCurrentStep, TodoWrite и 16 browser_*), cursor-guide (rg, ReadFile, WebSearch, WebFetch, UpdateCurrentStep). Каталог namespace cursor одинаков: 14 инструментов, полный файл — cursor-namespace-catalog.json.

## Что закрыто этим прогоном
- Схемы ConnectScm и SetActiveBranch: в cursor-namespace-catalog.json.
- Роли cursor-guide, browser-use, ci-investigator: roles/.
- Напоминания режима Ask: roles/mode-Ask-*.md.
- Уведомление «The following task has notified» (notify_on_output).

## Что не пришло
- Роли bugbot и security-review: ревью не стартовали, diff пуст; в журнале только общее напоминание субагента.
- Роль best-of-n-runner: отдельного текста роли нет.
- ReadLints: в наборах и каталоге нет, поиск по «Lint» его не нашёл.
- Режимы Plan и Debug: переход в Plan отклонён, Debug-напоминаний нет.
- Текст сжатия контекста.
