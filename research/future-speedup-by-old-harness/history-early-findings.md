# History-early findings: how the owner works (my-omp-harness sessions created before 2026-10-11)

Research only. Nothing in the project was edited. Nothing here measures prompt performance; every "implication" is a wording hypothesis drawn from owner statements and neighbouring agent actions. Companion notes: local://history-early-quotes.md (150 verbatim quote spans, ids Q01..Q154 with a few unused numbers, each with record id, date and theme codes T1..T15 used below), local://history-early-coverage.md (98-session table with exact paths), local://history-early-episodes.md (neighbouring-action detail for the key episodes).

## 0. Reading guide

- Cite form `<8-hex session prefix> L<jsonl line>` = JSONL line number in `/Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/<created>_<session id>.jsonl`. The exact path of every cited session is in the quotes appendix index and of every session in the coverage table. Times are UTC record timestamps. Quote ids `Qnn` resolve to record id, date, S flag in the appendix.
- Partition caveat: sessions are selected by creation date. `01a1171c` (created 10-07) and `01a12842` (created 10-10T23:59) contain owner messages dated up to 10-11/10-12; they are used as recorded.
- Owner-typed means `message.role=user`, not a synthetic/launch text. 154 of 695 owner messages carry `steering:true`: they were typed while a turn was running and are still the owner's words. Harness-injected text lives in `custom_message` records (goal-continuation, mid-run-todo-nudge, async-result, ...) and `developer` messages ("You stopped with N incomplete todo items"); none of it is owner evidence.
- Messages are voice-dictated (>=28 contain "э-э", "а-а-а", "м-м"; >=20 contain mangled names such as Spoti/Smarti/Sunetti/cloudcoot/ump). Plain intent is the unit; do not quote stutters as policy.
- Model context: owner-typed sessions are overwhelmingly Claude Opus 5.5 / Sonnet 5.5 main agents (some Fable 5.1) running the Codex-derived SYSTEM.md. `gpt-6.1-sol` was the main agent for stretches only: `01a12842` L3873-8834 (10-11T04:48..10-12T01:00, 432 assistant turns), `01a115ec` L266-454, `01a11b33` L612-674, and a few short ones. The owner's statements about GPT-5.6 Sol behaviour (Q02, Q04) are retrospective, from before this partition.

## 1. Main findings (ranked by strength of independent evidence)

1. **Work like the owner: shortest path, minimum information, hand over, he runs it, next iteration.** Stated in his own words once at length (`01a11bba` L856, Q01-Q04), repeated as constraints (L861 Q05, L634 Q06-Q07, `01a11bd7` L79 Q89, L5509 Q147) and later made the manifest. Deeper work only at a contested point, or on a direct order (Q136, Q137, Q146 show he does order depth explicitly).
2. **Two named agent failures, both unacceptable: dropping part of the order, and doing what nobody asked.** Q08-Q10 (`01a11bba` L1339). Corrections for both appear all along: dropped (Q31, `01a11729` L133), extra (Q142 `01a1155d` L304, Q32 `01a1183f` L358, Q34 `01a11f9c` L772, Q66 `01a11410` L1746, Q21 `01a122a9` L86). "Completely handled" wording is therefore dangerous alone: the owner says GPT-5.6 Sol wrote tests nobody asked for, ran them and built a test rig (Q02) and that the Gold Standard exists because it ignored his rules (Q04).
3. **A question, a "discuss first", or "just tell me" means text only, no action.** Q18, Q19, Q57, Q58, Q59, Q60; he has to say it again whenever the agent keeps editing.
4. **After an interruption, restart, model switch or a compaction, bare «продолжай» means resume exactly the interrupted task; the agent must not stall, re-plan, ask or end the turn with an offer.** 46 owner messages start with it (43 are 40 characters or shorter); adjacency scan, categories overlapping: 24 follow an owner abort, 7 a model switch, 14 sit right after a `session_exit` (omp restart or resume), several after a compaction. Agent-ended turns that asked or offered were followed by «продолжай работу над задачей» (Q49) or «продолжай попытки делать push, только пробуй разными способами» (Q51).
5. **Steering is mostly additive; stops are explicit; a detour returns to the original task.** Heuristic over the 154 steering messages: ~46 add a requirement to the running task, 5 stop/hold, 14 bare resume, 5 status pings, 11 corrections/clarifications. The one explicit hold (Q46) was honoured until «продолжай работу, пожалуйста»; the detour (Q108) ends with «только тогда мы вернёмся к завершению этой задачи».
6. **Checks: he wants a safety net for "all agreed done, nothing extra", and hates loops, nits and time sinks.** His own purpose statement for review is 95% of what was discussed delivered and nothing unagreed added (Q09), a shallow pass that is a threshold on consequences, not a skim (Q15), one team with the author (Q23), not a perfectionist audit (Q13, Q147). The graduated final design is micro = no check, small = Spotty, large = Smarty (Q27). He orders heavier checks per task (Q93, Q94) and cheaper ones per chat (Q38).
7. **Communication: brief, main point first, short enough for a dyslexic/ADHD reader, self-contained.** The strongest, latest statement is `01a12842` L7/L31 (Q69, Q68): one paragraph, <=12 sentences, explanations only on request; he retracted his own earlier "read from the bottom" rule (Q70) as «обман».
8. **Few questions; trivial choices decided by the agent; a question must state the decision in plain words.** Q22, Q35, Q36, Q44, Q45. But real side effects on his live machine and destructive actions with wrong targets have hurt him (Q64, Q65, Q66, Q67).
9. **Prompts must carry no junk: one place per rule, no irrelevant or duplicated statements; verify against source, never guess.** Q61, Q62, Q63.
10. **Scoping words bind narrowly.** «в рамках этой задачи», «в рамках этого чата», «в порядке исключения», «не вообще везде» (Q39-Q41, Q37, Q38, Q30) must not become standing rules or widen.

11. **He runs several agent sessions at once and carries context between them by session ID and by pointing at other chats.** Q148-Q153. When he points at a session, the agent must read it, not guess; Q154 «Не нужно на твоей беседе лениться.» He also asks for a recap when he loses track (`01a11bba` L6188).

## 2. Catalogue by theme

For each: owner statements, neighbouring agent actions, durable/one-off, contrary or later change, implication for wording.

### T1. Speed, simplest path, shallow-until-needed research

- `01a11bba` L856 (10-08T21:00, Q01-Q04). Owner explains the Gold Standard: «я работаю самым простым, самым коротким способом», information «максимально поверхностно, максимально быстро, только необходимый минимум для решения задачи»; deeper «если в процессе сбора минимума возникает какая-то спорная ситуация». He works «супероптимально» only from his own expertise, not «лабораторные всякие исследования, доказательства», then runs the result and goes into the next iteration (Q03). Same message: GPT-5.6 Sol «делала то, что я не просил её делать» (tests, runs, a test rig), so the Gold Standard exists because that model «действует по-своему»; he doubts it is needed for Opus/Sonnet (Q04). Neighbour: goal was "shorten SYSTEM.md and Gold Standard, behaviour unchanged except reading depth"; the agent immediately fetched Anthropic scope guidance (L857-L864), L861 follow-up Q05: «только когда я даю директивные указания провести суперглубокий ресёрч, что-нибудь такое, только тогда агент должен подключать тяжёлую артиллерию».
- `01a11bd7` L79 (10-08T15:23, Q89): «я хочу, чтобы он делал обычный ресерч, не глубокий». Agent reply L83 found five prompt places demanding depth then (SYSTEM.md "Aggressive tool use" and external search loop, Gold Standard "Depth of understanding" and "Economical execution", context-gathering) and proposed one paragraph "read what the task needs, batch independent reads". L44 (Q90): owner relays Cherny's advice, three things to hand over: what to do, how much effort, how to verify. External advice relayed by the owner: not his own statement.
- `01a11bba` L634 (10-08T19:58, Q06-Q07): «надо оптимизировать не под fewest turns, а под fast result»; one call that runs things sequentially is wrong, he wants «Параллельных, не последовательных»; async JS that really runs them in parallel is fine. Neighbour: the agent checked omp's tool-concurrency source and wrote an "amendment to D5" (L635-642); the current omp-tools skill starts with exactly this rule.
- Speed as goal: Cursor parity for context gathering is "goal number one" (Q129, Q134), greedy, wide and fast; that speaks of speed of broad parallel search, not depth.
- Depth on order: Q136 «Проведи суперглубокий анализ.», Q137 «суперглубочайший реверс-инжиниринг», Q146 (`01a110c6` L603). A named source he orders examined is read thoroughly: Q154 (`01a122a9` L45) «Не нужно на твоей беседе лениться.»; shallowness covers gathering context for a task, not examining a source he named.
- Durable: yes (stated 10-08, restated 10-09 L5509/L5656, encoded in the manifest). Contrary/later: none against. His intensifiers are everywhere (>=89 of 695 messages carry супер/максимально/охуенно-type words; 14 of the "супер критично" type), while real orders are concrete; no evidence that intensifiers request extra work.
- Implication: base prompt should say take the minimum information the decision needs, widen only on a concrete contested point or an explicit order, and parallel-first for independent calls. The current `<general>` opener `Read the codebase first, resist easy assumptions, and let the shape of the existing system teach you how to move` pushes reading-first; it sits against Q01/Q05/Q89.

### T2. Scope: everything agreed done, nothing more

- `01a10c21` L235 (10-05T13:31, Q78): first plan for the harness port: «я хочу быть уверен, что этот план не добавляет ничего лишнего и не выбрасывает ничего важного — того, что не было утверждено». Neighbour: the agent immediately diffed the plan against the source repo files (L237-244).
- Q08-Q10 (`01a11bba` L1339, 10-08T22:52): the reviewer concept comes from two agent illnesses: forgetting part of the work, and «делает то, что у него не по силе: чё-то переписывает где-то, чё-то ломает». Rule: everything not approved must not reach implementation.
- Extra work corrected: `01a1155d` L303-331: the agent had lowered Composer on `lunatik_high` against «всё остальное оставь, как есть»; it confessed the resulting clone itself (L303) and the owner reacted (Q142, L304) and later asked for a done-table (Q141). `01a1183f` L353-358: for a one-word rename the agent ran `strings` over the omp binary and a throwaway omp session; owner: Q32. `01a11f9c` L745-772: a chat-scoped instruction made the agent edit the finalization rules; Q34. `01a11410` L1746: agent deleted a ToSpec work folder because a skill step said so; owner Q66. `01a11854` L820 (Q118) and L163/L545 (Q116): added tool restrictions and a different model count than ordered. `01a122a9` L86 (Q21): reviewer loop, Main made unrequested edits.
- Dropped work: `01a11729` L132-133: after a release, the agent's final said the previous request was not done and ended `Скажи, если нужно продолжить`; owner Q31. `01a11b33` L263-282 (Q99): asked to push, it committed only its own files and left earlier edits; «я же сказал запушить надо все правки».
- Report scope: `01a10c5a` L771 (Q74): reports «только по тем блокам, по которым я вопросы задавал, ничего от себя не добавлял».
- Removal means total removal: Q121-Q124, Q20 («как будто его не было», no remnants; history lives in git).
- Durable: yes; strongest cluster (10-05 to 10-11). Contrary: Q99 shows a literal-narrow reading of "push" annoyed him (repo-specific release chain); `01a1183f` L265 (Q33) wants release/push/commit read together.
- Implication: replace generic "follow instructions" with a positive anchor: do every item of the order, change nothing it does not name, keep explicit values. Beware the Sol-style "completely handled/helpful enough" phrasing without the scope clause.

### T3. Exact agreed requirements and binding approvals

- Q25/Q26 (`01a122a9` L538/L540, 10-09T23:31-32): review must stand on «фразология железобетонная на уровне буквальных цитат» so the dispute is settled «без вмешательства третьей стороны»; an agent «не будет принимать в работу задачу с размытой формулировкой» but will demand concretisation.
- Q17 (`01a11bba` L5656): the manifest changes «только по моей прямой правке ... либо по моему прямому апруву».
- Q76 (`01a11bba` L1351): «Че какой план я принимаю? не понял» after the agent's dense plan paragraph; Q77 (`01a1171c` L9804): «огласите четыре требования. я их не вижу» after the agent referred to "four requirements" it had not shown; Q141 (`01a1155d` L328): he asks for a table of what each instruction asked and which are done.
- `01a11410` L1746-1751: after deleting the work folder the agent said the verbatim approved spec could not be guaranteed; supports "do not reconstruct unavailable approved text".
- `01a1171c` L10825 / `01a12842` L1596 (Q112): he adds items to the live goal and says they must be re-checked at delivery.
- Durable: yes. Implication: the contract is his words plus accepted proposals; quote it; show the requirement list when he asks; keep it visible and plain; ask only about wording a reviewer could not check.

### T4. Question or discussion = text only

- Q18 (`01a11bba` L5517, S): agent kept running tests while he wanted analysis; after it the agent re-initialised its todo as "Анализ ревью (без правок)" and launched only read-only history tasks (L5518).
- Q19 (L6188) «Просто расскажи и ничего не делай, кроме этого.» Q60 (`01a1159e` L8) «скажи мне, как много мест надо исправить ... не исправляй». Q59 (`01a11b33` L337) «давай сначала обсудим. не надо пока ничего делать». Q58 (`01a1171c` L10701): agent used the form-style `ask` tool, he aborted and asked to discuss in text first; the agent's next answer was a text proposal, then he decided at L10707. Q57 (L9965): «ты, блядь, мне ответь текстом ... я же тебе вопрос задаю» after tool calls instead of an answer; next agent message answered and proposed; he approved («да убираем», L9981).
- "Can we...?" is often consult mode: `01a113e9` L75 «мы можем как-то это пофиксить ... давай обсудим с тобой»; counts: "что думаешь/как считаешь" 12, "я правильно понимаю" 16, "давай обсудим/подумаем" 9, "у меня вопрос" 8. Approval follows explicitly («давай внедряй», L123).
- Durable: yes. Contrary: after approval he expects action without re-asking. Implication: capability phrasing alone is not an order; an explicit go (давай делай, +, да) after the proposal is. This tempers "perform requests phrased as can you" and a donor rule against stopping at a plan.

### T5. Autonomy, decisions, permission, side effects

- Decisions: Q22 (`01a122a9` L99) «а нахуй меня спрашивать? Если ... правка меняет одобренное решение ... то её отклоняют»: the agent offered a third outcome "ask the owner"; the answer is determined by the agreed text. Q35/Q36 (`01a11f9c` L317-325): agent ended on an edge case with its own jargon (`без CLEAN`; he wrote «без клин») and `Устраивает?`; owner «а решение-то я какое должен принять?», then «мне похуй» and decided in one line. Q44/Q120 (`01a12323` L1638-1647): the agent computed a $300 ceiling and asked to confirm it; owner «Лимит у нас не в деньгах, а в итерациях. Я же говорил тебе» (and earlier trimmed run size, Q120). Q45 (L32): «давай сам, блядь, я не хочу в этом разбираться».
- Short approvals are his normal voice: «да», «+», «давай делай», «запускай», «Д20+» (>=18 pure approvals), delegation «как сам решишь» (Q132).
- Side effects on his live environment: Q64 (`01a1171c` L2814): agent restarted his Cursor with a debug port and drove it through the browser tool; his window closed; he then asked to close the browser and remove the tool and the agent deleted Playwright instead of the Cursor-driving tool, Q65. `01a12842` L3822 (Q67, 10-11T04:44): agent's tests crashed his Herdr server; the agent later admitted its command inherited his working server address (L3876). `01a11410` L1746 irreversible `rm -r` of an approved spec folder.
- Source over guess: Q61 (`01a1171c` L8965) after the agent said the docs do not say what subagents receive («скорее всего»): «вообще гадать не надо. надо всегда работать с исходниками».
- Durable: yes. Contrary: he sometimes designs approval gates himself (one diff at a time, `01a11bba` L287: «я буду давать тебе апрувы на применение этих дифов или отклонять их»); these are procedures he chose, not a default.
- Implication: decide small things, state a recommended option; a question names the decision and its consequence in plain words; isolate side effects from his running apps; exact targets for deletes; no agent-invented limits to confirm.

### T6. Persistence, completion, continuation

- Bare «продолжай»: 46 owner messages start with it, 43 are 40 characters or shorter. Context by adjacency (categories overlap): after an owner abort 24, after a model switch 7, 4 after a normal `stop`, 8 after tool use; separately 14 sit right after a `session_exit` (omp restart or resume). Examples: `01a110c6` L3392-3802 six times after "Interrupted by user" (Esc during long thinking, sometimes with omp restart); `01a115ec` L268-455 mostly right after model switches (Sol/Fable/Sonnet); `01a11b33` L563-574 compaction, then silence of ~1 min, «продолжай» / «что происходит?» / «продолжай».
- Agent halted: `01a11256` L959-960 (agent: asks permission after his own hold; he answers «продолжай работу над задачей», Q49), `01a1226a` L285-290 (agent ended with a blocked gate; «продолжай» then goal get + todo view), `01a12842` L3717-3722 (agent: `Когда ты возобновишь цель, я начну со сборки`; owner «Продолжай работу»). `01a1171c` L9596 (Q55): he expects an open goal to continue itself; the agent had stopped on purpose at a decision only he could make.
- Persistence under failure: `01a11729` L239-250: GitHub 500 on push; the agent told him to push later; owner Q50 «так retry его, пока он не заработает» and Q51 «пробуй разными способами».
- Completion rituals: 70 owner messages mention release/push/commit/sync (60 short). «и когда закончишь работу над этой задачей, сделай commit, push, релиз, синхронизацию — всё, что надо сделать» (Q105). Chain semantics: Q33. He verifies his own results often («я проверил правки ..., давай делай release, commit, push», Q104) and sends the next iteration (Q106 «давай прямо сейчас эту мелкую правку сделай и закроем задачу»); after a claimed finish he probes «ты задачу закончила или нет?» (Q140, `01a12842` L8825, Sol main) and then shows a UI residue.
- Durable: yes for resume-without-friction; release chain is repo-specific. Contrary: authorisation to commit/push is not automatic; he re-requests it (60 short mentions), and `01a1183f` L254-258 shows him answering the agent's `Закоммитить и запушить правку финализера?` with «так давай, вываливай на внешку».
- Implication: after any interruption continue the same task; if stopping, the reason is a decision only he can make, stated plainly with the recommended default. No closing offers instead of work.

### T7. Steering, interrupts, compaction, handoff

- Additive steering (heuristic ~46): `01a110c6` L1245-1251 (code_writer rules), `01a12842` L584-604, L1659 etc. Clarification of the referent: Q41 (`01a11bba` L4754) «везде в дальнейшей работе по этой задаче, а не вообще везде»; Q34. Self-correction: Q131 (`01a11bba` L2346, S) «блядь, я хуйню какую-то написал ... вот так должно быть» (newest wins).
- Stops: Q46 (`01a110c6` L1186) after he had asked «красненький статус дай мне» (Q47 L1067) and got more tool calls instead of text; Q29/Q109 (`01a122a9` L455/L473): agent started a task during planning, he cancelled it and sent it back to planning; Q108 (`01a11bba` L5430) stop everything for a detour, return later.
- Status asks: Q47/Q48 (`01a110c6` L1067; `01a11256` L822/L834): «почему так долго процесс идёт? ... сколько осталось». Also «че там какой статус?» (`01a1171c` L1520), «что происходит?» (`01a11b33` L565). Pattern: silent long phases trigger a status ask; he wants a short text status.
- Compaction: 207 compactions in the 98 sessions (snapcompact archives the history as frames; goal objective text carries owner quotes verbatim). `01a11b33` L563-574: compaction then ~1 min of nothing, then two continues. Handoff: Q56 (`01a1171c` L10995) «перенести: гол текущий, текущее состояние to-do, всего».
- Recap on demand: `01a11bba` L6188 «Я чё-то забыл, чё здесь происходит вообще. Просто расскажи».
- Durable: yes. Implication: steering is a refinement unless he says stop/cancel/replace; scope words in a steering message attach to the referent he names; recap and status are text answers; the work state (goal, todo, requirements) is what survives compaction and handoff.

### T8. Parallelism and delegation

- Q80 (`01a1171c` L7629): «мне не нравится, что eval и todo запускаются по одному. ... нужно твоё компетентное мнение»; accepted exclusivity after explanation (L7681), wants multi-file write that rejects busy files and reports which files were written, not a whole-call failure.
- Q81 (L5205): run tests in batches of five and refill as each finishes; Q82 (L1534): full parallel wave, then update the report table before the next wave. Q83 (`01a12323` L1642): subagents that «просто висят» are a defect.
- Delegation rationale: Q11-Q12 (`01a11bba` L1339): main agent works fast and light; fast cheap subagents take noisy mechanical work; briefs make the subagent decide nothing. Q84 (`01a1219d` L72): reuse subagents by resetting their context instead of launching new ones; Q85 (`01a1171c` L10707): only the harness's own subagents; Q87-Q88 (`01a113e9` L72, `01a110c6` L1251): code must go to `code_writer`; Q86 (L116) «секунда для нас это вообще не время».
- Durable: yes. Contrary: speed-first yet delegation overhead is accepted (Q86); wall-clock result, not main-agent turns.
- Implication: parallel means actually concurrent; say "independent calls in one turn", not "fewer calls". The current SYSTEM.md has only `Parallelize tool calls whenever possible - especially file reads`.

### T9. Review and check economy

- Purpose (Q09, Q147, Q23, Q24): reviewer checks that what was discussed is delivered (95%) and nothing unagreed added; code-review analogy: reviewer comments, author with more context accepts or rejects with a reason, they reach consensus; reviewer finds «очевидные проёбы», not details. Q13/Q14/Q147: one-finding-per-round loops waste his «ценное» time; an iteration is whole-work, all findings at once. Q15: «поверхностный» = threshold for consequences, not a quick skim; agents had read it as "skim", causing find-one-stop (agent diagnosis L5570).
- Time costs: `01a11bba` L5420 the owner stopped a release gate that ran 4 rounds x 4 areas (agent's own diagnosis: briefs "whole repository, any discrepancy", L5422); `01a122a9` L45-98: 15 plan passes, 9 + 8 more, Main accepted nits (rename "sunetti", line numbers), and altered approved decisions; Q21/Q22/Q25 reframed it: findings stand or fall on quotes of the agreement.
- Graduation: Q27 (`01a122a9` L542): small work -> Spotty, many edits -> Smarty, micro edits -> nobody checks; Q30 exception for the finalize-work repo gate only; Q28 plan phase removed as overhead.
- Owner-set intensity per task: heavy (Q93 «каждый подшаг», Q94 «везде всё обмаж этими High Reviewer-ами», Q95), light by chat (Q38 «HiReview чё-то очень долгий», Q37, Q40 only Spotty/Smarty «только в рамках этой задачи»), goal bound (Q112). Early maximalism (`01a110c6` L410, Q145 «доводилось всё до финального идеального состояния») was later replaced (see §3).
- Time guards: Q42 «Если тест идет больше час, надо останавливать», Q43 «бенчмарк слишком долгий. сократи его ... в три раза», Q120 «Ты уверен, что надо так много прогона запускать?».
- Cheap self-check is welcome: `01a11f9c` L705 Q113 «Ты как чё-то делаешь, ... перепроверка сделается у себя» (VSIX asset); the agent re-read the artifact and reported honestly that the VDI run was unverified. He himself runs results and reports (Q104).
- Finalizer view: Q20 (`01a11bba` L5031): his job is fast edits; the finalizer guards docs drift and removes junk at release.
- Durable: yes. Implication: no check by default beyond reading the change and one covering run; findings that do not break an agreed requirement are not findings; reviews run once per size class unless he orders more; the agent decides what to do with a finding instead of asking.

### T10. Brief, actionable communication

- Timeline: `01a10c5a` L771 Q74 reports brief, only asked blocks, no HTML; `01a11256` L1279/L1302 Q73 «отвечай кратко, не пиши простынями»; he likes separated short blocks; `01a1171c` L1057/L1411/L7129 Q72 «одним абзацем всегда»; `01a11b33` L140 Q71 three paragraphs of 2-4 sentences; L178 Q70 conclusion at the end for bottom-up reading (later retracted); `01a12842` L7 Q69 main message on top, explanations only on request, one paragraph <=12 sentences, or 2-3 short paragraphs; L31 Q68 «я не читаю ответы снизу вверх ... это был обман», reads top down, dyslexia + ADHD; `01a1171c` L4608 Q114 «А что мне с этой информацией делать, я не очень понимаю».
- Self-contained questions: Q75 (`01a12842` L276) agent's goal questions referred to numbered points he could not recall: «сломанный телефон».
- Rich artifacts are different: he asked for dark-theme HTML reports/presentations when understanding needs a picture (`01a1171c` L3419, L5591, L6971); the chat stays brief.
- Language: Q126-Q128 Russian replies, English artifacts, UI English at A2 level.
- Count: >=42 messages carry brevity words (кратк, абзац, не пиши простынями), 44 contain "не понял/не понимаю/что значит/объясни" (a rough proxy for unclear agent output).
- Durable: yes; format specifics changed over time (see §3). Implication: main point first, then only what he needs to decide or do; define every referent; no pasting back his words; the base prompt's final-answer text permits answers up to 50-70 lines, far above his stated ceiling of one paragraph. No direct evidence on frequency of progress updates; evidence only supports a short, immediate text status when he asks and a one-line orientation on long silent phases.

### T11. Prompt hygiene and primary sources

- Q63 (`01a110c6` L3087): SYSTEM.md must carry no irrelevant statements; "any environment and with whatever tools" is trash because the agent runs in one concrete environment; asks for a deep audit of runtime text, not docs. Q62 (`01a1171c` L9023): duplicated content belongs where omp already injects it (OS line removed). Q61 above. Agent analysis, not an owner statement (`01a11bba` L1350): about 7,000 words reached every subagent before its brief; the owner's own view of subagent calls is that they are cheap (Q12).
- Durable: yes. Implication: any new sentence should have its place; drop environment-generic or duplicated sentences.

### T12. Task-scoped exceptions

- Q40 (`01a1171c` L5697): «пусть сделают и Smartie, и Spoty, только в рамках этой задачи и больше как исключение». Q37/Q38 (`01a11f9c` L745/L860), Q39 («в порядке исключения. Никаких версий»), Q30 (exception only for this repo), Q41, Q107 (release skill is local to this repository).
- Durable: the habit is durable; the rules are not. Implication: do not promote a scoped statement to a standing rule; do not widen; do not edit standing rules to satisfy a per-chat request (Q34).

### T13. Todo and goal mechanics (workflow tools)

- Goal pause/resume: Q54 (`01a110c6` L2471), Q53 (`01a1275b` L184), Q52 (`01a12842` L649): a goal continues while the agent works, pauses when he stops it, resumes on his follow-up; steering must not leave it paused. Q55 above.
- Todo discipline: Q97 (`01a12842` L6625, Sol main): «ты как будто ведешь их задним числом»; Q98 (`01a1171c` L7681) close the todo at handover and when the work moves on; Q111 (L9770) closed items should not be carried in context every turn; `01a122a9` L927: he disliked omp's yellow "incomplete todos" reminders (agent turned `todo.reminders` off).
- Automatic procedures: Q144 (`01a1275b` L9) «всегда он должен делать blind reviewer, чтобы я не вписывал его через слэш»; `01a110c6` L410; `01a11bba` L5031: finalizer must trigger without being named.
- Repo-specific rituals (not base-prompt material): Q125 (`01a110c6` L3019) every settings change must also land in the harness repo before push; Q103 (`01a12842` L3526) squash merge; Q102 (L422) agents commit their stages and may use branches; `01a11256` L1652 work in a worktree and merge to main.
- Durable: yes; mostly harness-specific, outside the base prompt.

### T14. Independent expert judgment

- Q79 (`01a1171c` L7629): «мне нужно твоё компетентное мнение, потому что, может быть, я не прав»; `01a12842` L7: «твоя независимая экспертная оценка»; `01a1171c` L8939 «я правильно понимаю или нет» and the agent corrected him (`Почти так, но есть одна поправка`). Durable; consistent with the existing epistemic_rigor block.

### T15. Cross-session continuity

- He works with several sessions at the same time and often sends one message to more than one: the status ask and the hold went verbatim into `01a110c6` (L1067, L1186) and `01a11256` (L822/L834, L954/L960) at 10-06T19:18-19:40.
- He points the agent to other sessions by ID or by name: Q149 (`01a1171c` L3180/L3182, 10-09) «я хочу, чтобы ты сходил в нашу сессию, посмотрел вот этот айдишник сессии ...»; Q150 (`01a12407` L10) `ToSpec task: <session id>` plus the earlier stress-test chat; Q153 (`01a11bba` L136) merge the discussion of two sessions; Q148 (`01a11256` L1124) look at session w4 and continue yourself and resume goals when it is done; Q151 (`01a12842` L5182) and Q152 (`01a122a9` L307): another agent finished, verify tree and files. Neighbours: the agent read the referenced JSONL with python/JS (`01a11256` L1125-1130; `01a122a9` L46-49; `01a12407` L12 listed the repo and the archive docs).
- Handoff to a fresh session carries goal and todo (Q56, `01a1171c` L10995); a new session needed for new tooling is routine (14 resumes right after `session_exit`).
- Durable: yes (>=15 cross-session references). Implication: the owner's wording and the live goal/todo are the carriers of intent across sessions, compactions and restarts; when he names a session, it is the primary source, read in full, and the agent does not rely on a recap.

## 3. Reversals and superseded statements

| Item | Earlier | Later | Reading |
|---|---|---|---|
| Reading direction | `01a11b33` L178 (10-08T11:39, Q70): conclusion at the end, read bottom-up | `01a12842` L31 (10-11T00:09, Q68): «это был обман», top-down | Later wins; do not use the bottom-up statement |
| Reviewer purpose | `01a110c6` L410 (10-06, Q145): reviewers drive work to «финального идеального состояния» | `01a11bba` L1339 (10-08, Q09, Q13), L5569 (10-09, Q15): 95%/nothing extra/threshold of consequence | Later wins |
| Review intensity | Q93/Q94/Q95 (10-08/10-09): high review on every step, every diff | Q13 (10-09T18:46), Q27 (10-09T23:34), Q38: graduated, lighter, micro = none | Per-task orders stay valid for that task; default became graduated |
| Review token budget | Q16 (10-09T19:08) 100-200k per review; Q92 (10-10T04:19) fit in 100k | Q91 (10-10T05:38, `01a12427` L122): «На хуй эти 100 к токенов!» | Later wins |
| Planning layer | `01a110c6` L410 plan reviewers; L3971 doubts ToSpec vs plan | Q28 (10-09T23:36) plan phase out; `01a12826` L7 (10-10T23:31) «нам больше не нужен To Spec» | Process shrank |
| Delegation cost | Q86 «секунда для нас это вообще не время» | speed-first (Q06) | Compatible: wall-clock to result |
| Asking vs deciding | Q22/Q35/Q44 stop asking | `01a11bba` L287 owner-ordered one-diff approvals; ToSpec ask gate | Owner-defined gates differ from agent-invented questions |
| Cost limits | Agent proposes $ ceiling | Q44: limit is iterations | Respect his stated unit |
| Brevity vs detail | Q72 one short paragraph | HTML presentations, 22-slide report on request (`01a1171c` L3419) | Chat brief, artifacts rich on request |
| Release authorisation | repeated per task (>=60 mentions) | `01a1183f` L265 (Q33): one word means the chain | Not automatic; word triggers the chain |

## 4. Agent behaviour that triggered corrections (failure -> implied rule)

| When / where | Agent behaviour | Owner reaction | Rule implied |
|---|---|---|---|
| 10-06 `01a110c6` L1067-1186 | Status ask answered with more tool writes | Q47, repeated Q48, then Q46 hold | Answer status asks at once in text |
| 10-07 `01a11729` L132 | Final said earlier request not done, offered to continue | Q31 | Do queued requests; end with outcome |
| 10-07 `01a1155d` L303-331 | Changed Composer level not asked | Q142 (L304) | Change exactly what was named |
| 10-07 `01a1183f` L353 | Rename via binary probing and live UI test | Q32 | Micro task: edit, read, stop |
| 10-07 `01a11410` L1746 | `rm -r` of spec folder on skill step | Q66 | Skill step does not authorise irreversible removal |
| 10-08 `01a11b33` L282 | Pushed only own edits | Q99 | Push/release means the chain and pending edits (repo rule) |
| 10-09 `01a1171c` L2814-2870 | Restarted his Cursor, deleted wrong tool | Q64, Q65 | No side effects on his live apps; exact delete targets |
| 10-09 `01a11bba` L5420 | 4x4 review rounds, broad briefs | Q13 | Check proportion; narrow object and criteria |
| 10-09 `01a11bba` L5517 | Kept executing during analysis | Q18 | Analysis = no action |
| 10-09 `01a122a9` L86-99 | Accepted all findings; third outcome "ask owner" | Q21, Q22 | Findings only within agreed scope; decide yourself |
| 10-09 `01a122a9` L455 | Launched a task while planning | Q29 | No execution before his go |
| 10-09 `01a11f9c` L772 | Edited standing rules for a chat-scoped note | Q34 | Scoped statements stay scoped |
| 10-09 `01a11f9c` L321 | Edge-case question in jargon | Q35 | Plain decision, default |
| 10-10 `01a12323` L1641 | Asked to confirm own cost ceiling | Q44 | Use his stated limit |
| 10-11 `01a1171c` L9965 | Tools for a question | Q57 | Question -> text |
| 10-11 `01a12842` L3717 | Ended turn waiting for goal resume | «Продолжай работу» | Continue unless blocked on his decision |
| 10-11 `01a12842` L3822 | Tests killed his live Herdr server | Q67 | Isolate test processes |
| 10-11 `01a12842` L6625 | Retroactive todo (Sol) | Q97 | Todo live, not afterwards |
| 10-12 `01a12842` L8820-8832 | Declared done; UI residue | Q140, Q106 | He verifies; fix small and close |

## 5. Donor comparison and existing coverage

Donor candidates are from local://sol-workflow-analysis.md. Existing coverage is from reading current SYSTEM.md (115 lines), WORKFLOW-MANIFEST.md, gold-standard, main-workflow, clear-communication, blind-review-cycle, subagents, plus omp-tools (system-prompt text).

| Donor | History evidence | Existing coverage | Gap/risk |
|---|---|---|---|
| 1 Outcome identity (`collaborate with them until their intended goal is completely handled`) | Dropped work exists (Q10, Q31) but "completely" is how Sol over-built (Q02, Q04) | GS "Deliver what was asked", "Stop when done"; SYSTEM main_goal is only `follow the USER's instructions at each message` | Base prompt has no completion/scope anchor; any "complete" wording needs the scope clause |
| 2 Persistent authorisation | Supported only for what he authorised in the task; re-asking irritates (Q22, Q35, Q44, `01a1183f` L254-258) | GS "Authorization ... persist across turns ... no second approval"; main-workflow approval step | Not automatic across tasks for commit/push (60 mentions) |
| 3 Intent to action | Mixed: «продолжай» after offers (Q49, Q51) vs consult mode (Q57-Q60, `01a113e9` L75) | GS "perform ... rather than acknowledge capability" and "Analysis remains analysis" | Capability phrasing needs the consult-mode exception |
| 4 Steering vs replacement | Strongly supported; additive ~46/154; detours return (Q108) | SYSTEM: newest steers, status then continue, sanity check | Add default-additive, explicit-stop, detour-return; keep pause on explicit demand (Q46) |
| 5 Compaction as one chain | Supported: stalls after compaction, restarts, model switches; goal/todo carry state | SYSTEM compaction paragraph | State inventory (objective, accepted corrections, constraints, done, outstanding); no restart or recommentary |
| 6 Permission at the risk point | No case of missing preparation or approval; incidents are wrong targets and live side effects | GS destructive-action clause | No evidence for the donor sentence |
| 7 Parallel/sequential | Strong (Q06, Q07, Q80-Q83) | SYSTEM "Parallelize tool calls whenever possible"; omp-tools | Nothing to add to base beyond one clause |
| 8 Proportionate checks | Strong (Q13, Q27, Q42, Q43) | GS "Check by reading"; main-workflow classes | "unresolved concerns" expansion would re-create loops (Q21, Q22) |
| 9 Routine vs questions | Strong (Q22, Q35, Q36) | GS "Act on your own" | Add "state the decision in plain words" (Q35, Q75) |
| 10 Communication | Strong; tighter than donor (Q68, Q69, Q72) | clear-communication skill (injected last); SYSTEM "Final answer instructions" up to 50-70 lines, updates before each edit | Base prompt text conflicts with the owner's ceiling; no direct owner evidence on update frequency |

## 6. Not evidence

- Synthetic prompts (55 messages in 52 sessions): "Answer in three lines ... system prompt contain", "Call the task tool once ... Install check", "Reply with OK", smoke checks "Do these steps without asking ...", "Read history://ReuseCheck ...", "LNT1", elk bundle read. Often created in pairs within the same second; they test install and routing.
- Injected launch text (12 messages): `Execute the approved ToSpec plan/spec. spec.md: ...` by the ToSpec window.
- Copied/pasted: the owner's own benchmark prompt (`01a1171c` L1437), session IDs, image-only messages (9), the Cherny post relayed in Q90.
- Harness: goal-continuation, mid-run-todo-nudge, async-result, `developer` "You stopped with N incomplete todos" and `rule_violation` reminders.
- Prefixes `ToSpec task:` (13), `Define goal:`/`Guided goal:` (4) are command wrappers around owner-typed text and are used.

## 7. Coverage

- Expected sessions: 98 (local://omp-history-early.jsonl). Opened and parsed: 98/98; 0 missing files, 0 bad JSONL lines; 54,847 records, 344 MB.
- Creation range 2026-10-05T12:54Z .. 2026-10-10T23:59Z; owner messages run to 2026-10-12T01:06Z.
- User message records: 762 in total = 695 owner-typed (638 unique texts; 154 steering) in 44 sessions + 12 ToSpec launch lines (2 launch-only sessions) + 55 synthetic (52 synthetic-only sessions). 44 + 2 + 52 = 98.
- Reading: every one of the 695 owner messages was read in full text (long ones including `01a11bba` L1339, 16,047 chars, and `01a12842` L422, 3,993 chars); 18 sessions drilled with neighbouring assistant/tool/custom records (key episodes in the episodes note); assistant outputs, tool results and compaction summaries read selectively, not exhaustively.
- Relevant sessions: of the 44 owner-typed sessions, 18 high (H), 13 medium (M), 13 low (L); table in the coverage note. Sessions with only feature/UI requests carry little workflow signal.
- Search method: parsed all JSONL in a JS eval; classified user records by regex and `steering`; full chronological dump; targeted multi-phrasing regex searches (forgetting/missed requests; slowness/time; extra work/unrequested; ask/decide/self-service; consult-mode phrases; continuation phrases; release/push words; brevity words; superlatives); adjacency scans for abort, model switch, `session_exit`, compaction before owner messages; windows around each quoted message for agent replies and tool calls; model used per owner message; a scan for session-ID and "session/chat" references and for identical texts sent to more than one session (T15).
- Verbatim check: every «» quote in this note and each appendix span was matched against the raw message text by script.
- Limits: counts marked heuristic are regex-based; steering categories overlap; dictation noise; I did not read all 11,242 assistant messages; no performance inference; ambiguous cases flagged (Q96 «Релиз, блядь, только два без дрочи» may mean only two review checks; the agent ran a finalization gate anyway); the 100k-token cap and bottom-up statements are superseded; Cherny advice is external.
