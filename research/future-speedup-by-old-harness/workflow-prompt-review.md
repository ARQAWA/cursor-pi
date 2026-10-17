CLEAN

Review: PromptReview#2, review_stage=pre-action.
Object: local://workflow-prompt-task.md and the explanation text given to the user (the four-point answer).
Criterion: the rewritten prompt keeps the user's research request, asks for deeper rather than broader work, the explanation answers the four questions, and nothing unnecessary was added.

Checks performed:
- Deeper, not broader: the object states "Нужна более глубокая версия этой задачи, а не более масштабная" verbatim, matching the user's "Мне нужна более глубокая версия этой задачи, а не более масштабная".
- GPT-6.1 Sol transfer: the object covers the user's "взять всё самое топовое из GPT-6.1 Sol промта" and "улучшает именно его workflow" via item 1 and the five mechanism categories, which trace to "не сбивался с цели, продолжал работу, не забывал про цель и так далее".
- Broad search over full OMP history with Sonnet 5.5 Extra High and parallel subagents: items 2 and 3 match "всей истории OMP", "Sonnet 5.5 Extra High", "несколько саб-агентов, разделить на зоны", and "поиск ... всех моих высказываний".
- Primary sources, not summaries: item 3 matches the explanation's point 2 (full session messages, neighbouring replies, summaries only as pointers).
- Sequence "запрос -> действия -> поправка": present in item 3, matching the explanation's point 3.
- Contradicting episodes: present in item 3, matching the explanation's point 4.
- Independent evidence and no claim of proven speedup: item 5 matches the explanation's point 4 and the user's request for measured results without benchmarks.
- No harness rebuild and no extra code verification: item 4 and the result section match "не превращал работу ... в перестройку всего harness" and "Не то чтобы ... заёбно-задрочно перепроверял код".
- Explanation answers the four questions: points 1 to 4 each answer the matching user question.

No finding admitted. Only unagreed-looking wording (the five-category list, "Отбирай по содержанию", coverage reporting) is derived from the user's "и так далее", "всей истории" and the four-point explanation, so it is not a violation.
