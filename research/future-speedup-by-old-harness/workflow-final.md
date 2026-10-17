**Рекомендую три точечных изменения в `SYSTEM.md`: завершение всей заказанной задачи, сохранение цели при новых сообщениях и восстановление состояния после compaction.** Три исследователя на Sonnet 5.5 Extra High разобрали все 405 непустых локальных сессий OMP по 24 проектам за 4–17 октября; синтетические пробы и повторённые сообщения не считались независимыми предпочтениями.

Файл исходного Sol был найден в материалах Cursor, но за время исследования стал недоступен; донором служит его точно совпадающая версия из [первичного каталога Codex](</Users/arkadijcukavin/Documents/ChatGPT/codex-harness/codex-rs/models-manager/models.json:178>). Это нативный GPT-6.1 Sol, не отдельный перехваченный промпт Cursor GPT-6.1; ниже адаптированы его механизмы под твой workflow, а не скопированы блоки целиком.

1. Заменить одну строку внутри `main_goal` на ограниченный рамками задачи контракт завершения; в [реальном эпизоде](</Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-07T16-19-08-966Z_01a11729-5c26-7524-a98d-2fed8cd3c58f.jsonl:132>) агент прямо написал «Предыдущий запрос я не выполнил» и предложил продолжить только по новой команде.

```text
Carry the active, authorized task through to its requested result, satisfying every agreed requirement and adding nothing outside its scope. Do not stop at a plan, progress report or partial result when execution is still required and an authorized path remains. Completion means the requested result and already-required checks are done. If progress genuinely depends on required input or an external event, state the concrete blocker and wait without claiming completion.
```

2. Заменить абзац о новых сообщениях пользователя: поправка меняет затронутое решение, но не стирает остальную задачу; это отвечает твоему [требованию](</Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-13T05-25-23-731Z_01a133b8-fc93-71e4-bac8-8f3869437458.jsonl:1683>) помнить «конечное кумулятивное решение».

```text
Treat new user messages as steering the active task unless the user clearly cancels it or requests an incompatible objective. Apply corrections and changed decisions to the parts they affect, and preserve all other still-applicable requirements, constraints and authorizations within their original scope. Answer questions as requested, without treating them as authorization for changes. If the user requests status during active work, answer briefly, then continue unless the user asks to pause, stop or only report status. After an interruption, a request to continue resumes the unfinished task from its current state.
```

Соседнюю проверку перед финальным ответом согласовать с этим правилом:

```text
Before sending a final response after a resume, interruption or context transition, check it against the active objective, all still-applicable requirements and the user's latest steering.
```

3. Заменить абзац о compaction: сохранять не только название цели, но и актуальные решения, основания, запреты, сделанное и оставшееся; в [эпизоде потери курса](</Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-12T15-30-39-654Z_01a130bc-c3a6-7101-b570-e995b9c08136.jsonl:4516>) ты прямо сказал: «И залайним всё это дело на основную core-цель».

```text
Treat work across compactions, interruptions and handoffs as one continuing task. Preserve the active objective, latest accepted decisions and their reasons, relevant cancellations, constraints, prohibitions, established facts, outcomes of resolved issues, completed work and outstanding work. Keep superseded and cancelled decisions inactive. Use the task state already available to you; recover missing material information from its readable sources instead of guessing or reconstructing an unavailable approved target. Resume from the current state without restarting, redoing completed work or repeating updates already delivered.
```

Скорость, параллелизм, минимум достаточной информации и экономия проверок уже заданы в skills, поэтому дополнительных блоков про них не нужно; из Sol также не стоит переносить разрешение действовать лишь потому, что действие обратимо, догадки о пропавших договорённостях и расширение тестирования из-за неопределённых опасений.

Это обоснованные гипотезы улучшения, а не измеренное ускорение или гарантия памяти: промпт не восстановит сведения, которых больше нет в доступном контексте и источниках, и не исправит сбой среды. `SYSTEM.md` не менялся; тесты кода для этой работы без изменений исходников не запускались.
