# Decision journal

Owner decisions about the Cursor clone, in time order. Each entry has a verbatim quote from the owner's message, the session id and the message timestamp from the omp session JSONL. A `…` in a quote marks omitted text between verbatim fragments. Quotes stay in the owner's language.

The quotes were taken from the output of `bun tools/owner-messages.mjs list <session>` and are checked by `bun tools/owner-messages.mjs check docs/decisions.md` (see [verification.md](verification.md)). The session files are local to the owner's machine (`~/.omp/agent/sessions`) and are not published.

Sessions read: `01a1171c`, `01a12e3a`, `01a130bc`, `01a13b66`, `01a13b76`, `01a141a1`, `01a141ad`, `01a14656`, `01a1482e`. `01a141a1` and `01a14656` hold Codex-harness decisions (prompt for Codex, audit), not decisions about the clone, and contribute no entry. In the dictated messages, "Cloud" means Claude, "Soul" and "Solo" mean Sol, and "Llama.py", "чистого Py" and "PP" mean Pi.

## D1. Reproduce Cursor's mechanics as they are, then optimize

The first target is Cursor's loop exactly as found in its system and subagent prompts, with Cursor's limited tool set; optimization comes later.

> я хочу воспроизвести цикл курсора именно так, как он сейчас работает, как мы это раскопали через его системные промпты и промпты сабагентов. я хочу эту механику, как она есть, сначала воспроизвести, запустить, а потом уже будем думать над её оптимизацией. … также я хочу, чтобы так же, как в курсоре, у нас был ограниченный набор инструментов.

Session `01a130bc-c3a6-7101-b570-e995b9c08136` · 2026-10-12T16:10:45.198Z · message #3

## D2. No probes through the Cursor CLI

The CLI behaves differently from the Desktop UI; probes run only through the UI.

> Через CLI Cursor работает криво, не так, как через UI, поэтому через CLI любые пробы запрещены. Если делать пробы, то только через UI.

Session `01a13b66-3cd1-75d7-aa34-00dcbd47323a` · 2026-10-15T04:17:42.198Z · message #8

## D3. The clone works exactly like Cursor

Cursor's system prompt, tool blocks and internals are transplanted mechanically.

> я хочу, чтобы наш ОМП новый, ремастер, работал exactly как Cursor. Буквально как Cursor. … Мы переносим всё механически, все внутренности пересаживаем в ОМП.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-15T23:52:14.011Z · message #3

## D4. Claude prompts come from the official Claude Code prompts

Cursor's own Claude prompt cannot be recovered (masked on its backend) and is out of scope; the official Claude Code prompts are converted by the same rule Cursor applies to Codex prompts. Prompts are captured for Sonnet, Haiku and Opus 5.5.

> Мы просто возьмём промпты Cloud оригинальные, официальные и переделаем их по тому же алгоритму, как переделывается ChatGPT. … Да, ты должен снять промты для каждой модели: для Sonnet 5.5, Haiku 5.5 и Opus 5.5.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T06:29:28.176Z · message #20

## D5. All GPT models run on Cursor's GPT-5.5 prompt

GPT-6 Luna, GPT-6.1 Sol, GPT-5.6 Sol, Terra, Luna and GPT-6 Sol get prompts based on Cursor's GPT-5.5 prompt; the product name is replaced (then OMP, now Cursor Pi).

> Для нашего Cursor fork мы должны подготовить gpt 6 Luna, gpt 6.1 Sol промпты. Также gpt 5.6 Sol, gpt 5.6 Terra, gpt 5.6 Luna, gpt 6 Sol. … Они все должны работать на одном промпте от gpt 5.5 курсоровском … Надо, чтобы везде было не: «You are working in Cursor», а: «You are working in OMP».

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T06:29:28.176Z · message #20

## D6. Every converted prompt block gets a blind review

> ты должен каждый отдельный блок, переделанный по инструкции, проверить через blind reviewer, что действительно он правильно перенесён в наш ОМП Cursor-like

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T06:43:36.690Z · message #23

## D7. Plan mode is not needed

> нам режим Plan не нужен, мы же им не пользуемся в нашем harness.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T09:00:38.694Z · message #29

## D8. GPT-6.1 Sol release candidate 1: four Sol blocks added

Epistemic rigor, Technical communication, Autonomy and persistence, and Visualization are copied in full from Cursor's GPT-5.6 Sol prompt into a separate GPT-6.1 release candidate; Cursor's GPT-5.5 prompt itself is not edited. Result: [gpt-6.1-sol-rc.md](../research/cursor/remaster/prompts/gpt-6.1-sol-rc.md).

> Перенеси три блока: Epistemic rigor, Technical communication, Autonomy persistence и Visualization тоже перенеси. Эти четыре пункта полностью, как есть, переноси. … Не правь именно Cursor GPT 5.5, а это будет наш Cursor GPT 6.1 release candidate.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T12:18:55.706Z · message #38

## D9. GPT-6.1 Sol release candidate 2 by expert judgment

Result: [gpt-6.1-sol-rc2.md](../research/cursor/remaster/prompts/gpt-6.1-sol-rc2.md) (Cursor GPT-5.5 base with one anti-sycophancy rule).

> Я хочу, чтобы ты со своей экспертной оценки составил новый релиз-кандидат, промт так, как ты выше описал, как ты считаешь правильным.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T14:52:59.218Z · message #43

## D10. Compaction is provider-native, not Cursor's summarizer

GPT models compact as Codex does, Claude models as Claude Code does. This is a recorded difference from Cursor.

> Я бы отдал, чтобы summary делал GPT. … Именно нативно, так, как делает сам Codex LLM и сам Cloud Code, именно так же чтобы они делали его?

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T12:00:30.639Z · message #34

## D11. Everything beyond Cursor is turned off

> Мы должны получить exactly клон курсора на базе OMP. Мы всё лишнее отключаем … как будто этого и не было, и собираем прям exactly клон курсора, именно механически.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T15:04:42.008Z · message #46

## D12. Nothing below GPT-5.5

> Нам все, что ниже GPT-5.5, неинтересно

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-16T12:06:54.616Z · message #36

## D13. Reference is Cursor Desktop; the CLI does not exist for this work

> В данный момент работает exactly как курсор Desktop, не CLI. CLI запрещён. … Игнорируй его, как будто его нет.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-17T02:39:34.303Z · message #50

## D14. A repository of extensions on the base agent, not a fork; only the agreed scope

> Результатом работы должен быть не fork … В Llama.py не должно остаться никаких механик сверх того, что умеет Cursor. Должно быть выбрано только то, что мы определили в scope первоначально и выбрали вместе с тобой в рамках этого чата.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-17T02:43:51.657Z · message #51

## D15. Desktop probes use Computer Use

> Ты можешь делать любое пробирование, любое discovery, любые исследования для Cursor Desktop. Используй для этого Computer Use.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-17T02:47:15.788Z · message #52

## D16. Research models are GPT-5.5, GPT-5.6 Luna and GPT-5.6 Sol

> В качестве research я всегда использую модели gpt-55 или gpt-56 Luna или gpt-56 Sol

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-17T02:47:15.788Z · message #52

## D17. OMP is abandoned; the clone is rebuilt on Pi

> мы решили отказаться от OMP и делать наш курсор Harness, наш cellphone курсор, клон курсора десктопа на базе чистого Py.

Session `01a141ad-07c9-77b8-af86-0a299c14be03` · 2026-10-17T03:58:58.219Z · message #53

## D18. Goal: a full Cursor clone on Pi, for the owner's subscriptions

> цель — сделать полный клон курсора на базе Pi с нуля. … Я хочу себе личную бесплатную версию, которая работает с моими подписками.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T04:51:44.151Z · message #1

## D19. Exactly Cursor in workflow and mechanics

> Он должен работать exactly как Cursor именно по workflow, по механикам. … За исключением каких-то вещей, достижимых инстагрепом.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T04:51:44.151Z · message #1

## D20. Documentation and research sections; everything Cursor moves here

> Надо сделать часть документации, где будет вся документация храниться, сделать раздел, где будет жить весь reverse engineering, вся информация о нём, все ресёрчи. Надо всё вынести из mycodex-harness и из myomp-harness.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T04:51:44.151Z · message #1

## D21. Prepared prompts for every model

> мы подготовили промпты для каждого агента, с которым мы будем работать, такие же, как в Cursor: для GPT-6.1 Sol, для GPT-6 Sol, для GPT-6 Luna, для GPT-5.6 Sol, Luna, Terra, для Sonnet, Haiku, Opus-5.5.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T05:16:01.156Z · message #2

## D22. Move, not copy: only the Cursor work, removed from the sources

> Копи или перенос? Перенос. … вся работа предварительная, которая была проведена в рамках OMP — я имею в виду именно курсора, а не всего OMP harness — мы её переносим. … Курсор Pi будет так же публичным, как и те два репозитория. Надо будет в него всё запушить, а из тех, что я выше описал, удалить.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T05:16:01.156Z · message #2

## D23. Pi is pinned to today's latest stable release

> Версия Pi берётся на текущий день стабильная, последняя стабильная версия, и мы с ней работаем. … Мы не обновляем, мы просто работаем с выбранной, закреплённой текущей стабильной версией.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T05:16:01.156Z · message #2

## D24. Documentation in English

> Язык документации пусть будет полностью на английском. Так же, как сейчас в ремастере.

Session `01a1482e-1571-7540-bc04-3add21c9be7c` · 2026-10-17T05:16:01.156Z · message #2
