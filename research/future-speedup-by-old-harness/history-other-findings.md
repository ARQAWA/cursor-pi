# HistoryOther findings: owner workflow evidence from 270 non-main-project OMP sessions

Author: HistoryOther (research only; no project edits). All dates are UTC from record timestamps (the owner is UTC+5, so late-evening local messages carry the next UTC date). Source partition: `local://omp-history-other.jsonl` (270 session records; raw transcripts under `/Users/arkadijcukavin/.omp/agent/sessions/<project>/<ts>_<id>.jsonl`). Evidence = raw JSONL user messages plus neighbouring assistant/tool records. Summaries, recaps and `sol-workflow-analysis.md` were used only for navigation. All Russian quotes below are extracted programmatically from the JSONL text and verified verbatim (profanity retained as written). Reference format `[S<n>:L<line>]` = session index n in Appendix A, JSONL line number; Appendix B maps each cited reference to record id, timestamp and file path.

Caution on scope of the evidence: the main agent in these sessions was mostly Claude Opus 5.5 / Sonnet 5.5 and GPT-6.1 Sol (per-session models in Appendix A), not the GPT-5.5-based prompt under review. The findings are about the owner's preferences and about failure patterns that appeared across models; whether a given prompt wording prevents a failure is a hypothesis, not a measurement. No secrets are reproduced (two sessions contain pasted API tokens; they are deliberately not quoted).

## 0. Headline findings (most durable first)

1. **Result minimal, path fast.** The owner explicitly separates the size of the deliverable (minimal, no extras) from the way to get there (fast, wide, parallel, few turns, low TPS). This is stated once at length in [S8:L162] and repeated in different forms from 2026-10-04 to 2026-10-16. Strongly durable.
2. **Exact order, no substitution.** Largest cluster of corrections: agent did a different, wider or narrower thing than ordered (wrong repo, wrong metric, partial application of an "all" instruction, unrequested report, abridgement not disclosed in the report). Strongly durable.
3. **Discussion/question versus order.** Repeated misparse in both directions: clarifying questions treated as orders (agent edited), and declarative sentences that were check-questions treated as statements. Moderately durable (seen 2026-10-04..10-05 and again in dictated form 2026-10-16).
4. **Goal continuity is mostly interrupted by the environment, not by the model quietly giving up.** Of 63 short "продолжай / какой статус / что там" pings, 30 followed an owner interrupt, 4 followed an API error, 16 were mid-run status requests and only 13 followed a turn the agent finished on its own. The real model-side gaps: long silent work or waiting without a status, and (per the agent's own explanation in S75) turns that ended while background work was pending, which paused the goal.
5. **Done means working and shipped.** The owner's completion test is the real behaviour (not a plan, not a unit probe), executed by the agent itself, and for harness work includes release, commit and push; he asks "ты сделал релиз commit и push, да?" at the end of almost every harness task.
6. **Autonomy is bounded by ambiguity, not by risk labels.** He wants the agent to solve problems, test, deploy and clean up its own leftovers without asking; he wants a question only when a reference is ambiguous enough to send work to the wrong place.
7. **Brevity is the most frequent complaint** (44 distinct messages under a broad pattern, 26 under a strict one, 2026-10-04..10-17), peaking 10-05 and 10-07, falling afterwards.
8. **Delegation is owner-directed and model-family bound** (no cross-family subagents; explicit counts and tiers per task; free choice of agent type on request).
9. **Independent review is wanted for substantive work, chosen by the owner, one reviewer per stage**; he objects to reviewer chains and to silence while reviews run, not to review itself.
10. **Agreements are lost across compaction and on forks of work**; the owner designed a decisions registry for it (the harness now emits `my-omp-harness.decisions` records).

## 1. Coverage and method

| Item | Count |
|---|---|
| Sessions expected in `omp-history-other.jsonl` | 270 |
| Session files opened and fully JSON-parsed | 270 (0 missing, 0 parse errors) |
| Raw size / JSONL records | 392,046,857 bytes / 67,224 records |
| User message records (all `attribution: "user"`) | 1,153 |
| Developer-role messages (injected) | 41 |
| `custom_message` injections (goal, plan-mode, ru-mode, todo nudges, async results...) | 1,294 |
| Assistant messages / tool results | 12,911 / 20,900 |

Method: parsed every file in Bun eval (read-only); extracted every user message with line number, record id, timestamp and `steering` flag; dumped all user messages of the 119 non-benchmark sessions in chronological order and read them (messages over about 1,300-1,500 characters were truncated on first pass and their tails were read in a second pass; pasted tool output and chat pastes were skimmed); keyword sweeps (brevity, speed, scope, review, delegation, release, acceptance); for episodes, read the neighbouring assistant text, tool calls and stop reasons via a context helper; quantified continuation pings by stop reason of the preceding assistant record; checked `custom_message` types (goal-continuation, session-stop-continuation, goal-paused) and developer injections.

Partition composition (sessions / user messages): superbot-test-Gd9Ld3YH 151/155; `/tmp` 65/339; my-codex-harness 24/339; superbot 7/227; gpt-read-aloud 1/43; soniox-pilot 1/20; cursor-ui worktree 1/8; prompt-split worktrees 3/3; scope-focus-tospec temp dirs 4/4; ten `/var/folders/.../tmp.*` probe dirs 10/10; cursor-pi 1/2; cursor-like-harness 1/2; /tmp/strrep 1/1.

Gaps: no file was unreadable. Not inspected as evidence: the main `my-omp-harness` project (other agents' partitions), assistant `thinking` text, the contents of tool results except where quoted, pasted binary images (45 image attachments, only referenced). Forked sessions repeat earlier user messages (S26/S29, S38/S73, S47/S48, S107/S108, S3x test replays), so "822 unique texts" below is the deduplicated figure. Message counts of keyword sweeps include duplicates removed by prefix match only.

## 2. Synthetic versus owner content

- **151 sessions (all of superbot-test-Gd9Ld3YH, 2026-10-04..10-09; 79 on 10-08, 68 on 10-07) are benchmark/probe sessions in a test copy of the Superbot repo.** They contain 155 user messages, 60 unique texts: fixed tool-behaviour probes ("Call rg once with output_mode files...", "list the exact names of all your tools", read-continuation checks, `enot` subagent probes) and replayed benchmark research prompts (a 10-question and a 40-question `currency_sync` quiz repeated 55+15 times; a "≤40 lines wallet_sync/currency_sync" report 21 times; a "describe trading-bot modules" report 8 times; one 2026-10-04 "double-listing guard" research prompt). Models: haiku-5.5, grok-4.7, composer-2.5, gpt-6-sol. They are owner-authored test material replayed many times, not live preferences. Only three messages carry live owner intent: the steering "жадный поиск делай максимально" in session 01a122cd and two timing questions in 01a10665; the replay prompt style itself ("саб-агенты запрещены. собирать, запускать, исполнять что-то запрещено") is consistent with the non-synthetic evidence below.
- **Among the 119 other sessions, 47 contain no owner workflow content**: tool/UI/RPC probes, install checks, `say ok`/`hi`/`cd`, harness-generated "Execute the approved ToSpec spec" runs, and forked continuations with zero user messages (S1, S7, S13-S19, S34-S36, S43-S46, S49-S50, S52-S54, S56, S58, S64-S70, S72, S79-S88, S90-S92, S107-S108, S110).
- **72 sessions carry real owner conversation: 945 non-probe user messages (822 unique texts)**, plus 53 probe messages. 133 of all user messages (107 unique) are `steering: true`, i.e. typed while the agent was running (interrupts, corrections, status pings).
- Harness-generated text sitting in user or developer role (not owner preferences): ToSpec "Execute the approved ToSpec spec..." (S52, S71 L7, S75 L8), 20 "Plan approved" developer messages, 4 compaction resume injections ("Resume the user's latest intent. Re-read kept recent messages above the summary... do not invent work."), 4 guided-goal texts, 3 "You stopped with N incomplete todo items", 6 rule_violation reminders, 16 hidden `goal-continuation` steers in these sessions (S75 x6, S76 x9, S117 x1; 17 partition-wide) and 7 `session-stop-continuation` notices.
- Style change over time: 2026-10-04..10-08 typed text; from about 10-09 many messages are voice-dictated (speech-to-text artefacts such as "РПС/WPS" for VPS, "ответное мнение" for "эти отклонения", mid-sentence self-corrections), see theme 12.

## 3. Themes

### T1. Speed, shortest path, wide and parallel gathering, low TPS

Owner words:
- Core statement, 2026-10-05, after the agent argued the "minimize actions" rule conflicted with fast reading: «допустим, я у неё просил: «напиши мне функцию». она писала эту функцию, потом писала на неё тесты, потом писала на неё тестовый стенд, писала на неё 50 фикстур, делала кучу всего, потом бенчмарки собирала и так далее» and then «самое главное — это скорость и получение конечного результата, на который мы идём»; «информацию мы собираем максимально быстро, максимально эффективно, максимально широко»; «а минимальное количество действий — это, блядь, не про общую работу, а именно про конечный результат. что мы не пишем дохуя кода ненужного, а мы пишем только минимально необходимый код» [S8:L162].
- Cost model: «у нас очень низкий tps у агента, и для нас каждый отдельный tool call, который проходит между tps — это большая задержка» [S8:L164]; «у нас tps 10-20 в среднем» [S8:L254]; wide-first search: «пусть лучше он будет делать широкий поиск в начале, а потом сужать его ближе» [S8:L212].
- Later: «да, можно делать хоть до 50 параллельных запросов, маленьких, коротеньких, а потом собрать их как пазл» [S6:L1259, 10-05]; «можешь поднять 40 sub-агентов, 50. Ускоряй процесс» [S111:L200, 10-15]; «Давай зачистку делай самую простую быструю и очевидную» [S114:L48, 10-16]; «Я бы хотел простое максимально решение.» [S102:L47, 10-14]; «давай skip это 30-минутное наблюдение. давай всё выкатывай, и будем потом смотреть, когда всё будет работать на продакшне» [S38:L3058, 10-07]; «Протестировали этих workers с max reasoning — полная хуета. Делаем всем medium reasoning» [S113:L2006, 10-16] (the same session raised workers to max at «Давай поднимем effort workers. Пусть workers будут high reasoning, а не medium reasoning.» [S113:L862, 10-16]); «в таком формате работы это будет сильно быстрее» [S76:L830].

Episode (S8, 2026-10-05): ordered an "aggressive context gathering" section appended to the Codex prompt without touching the original («ты не трогаешь никак весь изначальный промпт»). The agent added the section plus an override sentence because the original said "Minimize actions, calls, ... and elapsed work" and "Group independent reads and searches when useful" (agent text L161: "Taken literally, every extra read is a violation"). Owner corrected the premise: the minimization rules were written against GPT-5.6 Sol over-engineering (tests, fixtures, benchmarks) and may be making other models "тупить и медленно работать". The agent then formulated two axes (minimal result / fastest path) [S8:L163, agent's own wording] and proposed turn-count rules (L165); the owner did not reject it and moved to Cursor-style wide globs and greps (L186, L217) and later approved "более чем логично" the agent's reasoning on one question (L420).

Durability: strong, rule-level, multi-week. Contrary/later: the owner is not against watching production: «и последить за ним в течение хотя бы часа» [S75:L7329, 10-11] and he asked for a one-hour watch on 10-07 [S38:L2349] before cancelling it [S38:L3058, L3606]; effort level is tuned per role by measurement (max workers were "хуета").
Implication (hypothesis): any base-prompt wording that frames "minimize calls/actions" must say it applies to the deliverable and side artefacts, not to reads, searches and parallel calls; per-turn cost matters more than per-call cost.

### T2. Exact order: no substitution, no extras, scope words, "out of scope"

Owner words (scope gates):
- «больше кроме этого ничего не надо. остальное out of scope» [S5:L1982]; «и больше ничего, кроме этого, никаких правок делать нельзя» [S10:L261]; «omp out of scope» [S30:L199]; «всякие gpt-5 версии out of scope» [S30:L167]; «Всё, остальное всё аутоскоп.» [S71:L537]; «Пока новая чистая копия out of scope.» [S75:L1083]; «не выходя за рамки репозитория» [S4:L141].

Episodes (ordered -> done -> corrected):
- S4 (10-04). Ordered analysis of how Cursor's agent uses its search tool and a short report. The agent wrote "Данных достаточно. Пишу отчёт." [S4:L114]. Owner interrupted mid-run: «погоди, блядь, какой ты отчет там пишешь нахуй?» [S4:L115]. The agent replied it had not written any report and was about to dump results to a file the owner never asked for [S4:L116].
- S9 (10-05). Ordered measuring TPS of the ordinary model through omp; the agent benchmarked Fast mode through another CLI. Owner: «Нахуй ты фаст меряешь? я хотел что бы ты замерял мин обычный не фаст через омп» [S9:L85]; next turn the agent admitted «раньше я мерил **Fast через `agent` CLI**, это было не то, что ты просил» [S9:L95].
- S28 (10-05). Ordered comparing Cursor speed with Codex speed after all changes; the agent computed old-versus-new Codex normalised time. Owner: «ты должен сравнить скорость работы курсора и скорость работы кодекса после всех наших правок» [S28:L607]; the agent then ran the Cursor-versus-Codex comparison tool (L608-L610).
- S71 (10-10). Owner asked that compaction run on extra high («чтобы compaction делал этот э-э-м экстрагей гайку и попробуем ещё раз» [S71:L283], dictated). The agent's brief for the fix (task LcmXhigh, [S71:L287]) set only the leaf summaries to xhigh and wrote "condensation keeps \"high\"" (its own narrowing of the owner's wording). The agent's own session report («В этой сессии плагин сделал одну сводку D0 на xhigh, около $0,01–0,02. В прошлой сессии было 7 сводок D0 на low и одна свёртка D1 на high» [S71:L336]) showed a mix of modes, and the owner said «Я же сказал, чтобы он все сводки делал на extra high.» [S71:L337]; the agent then sent a second fix (LcmXhighAll, [S71:L338]) for the remaining call. Pattern: an "all/everything" instruction applied partially by the agent's own choice.
- S38 (10-06). Ordered a brainstorm skill "в репозитории агента" (Superbot is the working repo). The agent chose `my-omp-harness`, read its README and skills and queued todo items to transfer files. Owner: «какой нахуй перенос агента в харнск? о чём ты вообще? стой», «с чего ты вообще взял про этот репозиторий? я его не упоминал даже», «вся работа проходит исключительно и только в нем» [S38:L117/L125/L127]. The agent stopped and asked [S38:L124] without having changed files. Cause in the transcript: the owner's phrase was ambiguous ("репозиторий агента"); the agent picked a repo outside the cwd without asking.
- S75 (10-10). After an approved ToSpec the agent restructured migrations/Kafka topics into docker and removed screen launching; owner expected a multi-copy Docker Compose packaging: «я ж тебе другую поставил задачу изначально», «Я ожидал, что ты всё обернёшь в Docker-контейнер, даёшь возможность запуска нескольких сессий, нескольких копий» [S75:L1062/L1064]. Source of the drift: the work followed an approved ToSpec spec; the transcript does not show whether the owner read it in detail, and the agent's retelling at L1063 quotes his original request correctly, so the gap lay between spec and intent, not in the agent ignoring the words.
- S113 (10-16). Ordered adding "три предложения" from Sol's epistemic_rigor block to the GPT-5.5-based prompt («Давай добавляй их и делай сразу же Release Commit and Push»). The agent added the first two sentences verbatim and its own abridgement of the third, and the release report did not say so; owner discovered it by asking «Погоди. То есть ты эти три раздела не как есть внёс, а ты их как-то изменил?» [S113:L2203]; the agent answered yes and said the report should have stated the abridgement [S113:L2205]. Same session, the next order demanded verbatim transfer («Единственное, что мы в нём поменяем, именно название модели GPT-6.1 на просто GPT-6») and the owner then refined it to «надо просто писать GPT Model и всё».

Also scope-by-protection: «ОМП пересобирать — это крит, это запрет» [S59:L1434, 10-10]: after the owner said the harness must not be touched, the agent proposed a rebuild; it admitted "ты сразу сказал, что харнесс трогать нельзя" [S59:L1436].

Contrary: broad but ordered scope is welcome: «Надо сделать суперглубочайшее review всего функционала, который только есть в этом пакете» [S115:L6]; he also asks for completeness of dependent artefacts: «А ты legacy cleanup обновил в соответствии с той работой, которую ты проделал выше?» [S106:L1138]. So "scope" means what he said, not "small".
Durability: strong; every correction above is a literal-instruction mismatch, none a request for more minimalism.
Implication: preserve explicit values and the scope of quantifiers ("все", "только это", "дословно"); resolve repo/target ambiguity from the working directory before acting; disclose any departure from a verbatim or exact order in the final report.

### T3. Discussion versus order; questions without question marks

- Clarifying question treated as order (S0, 2026-10-04). After the owner asked «понимаешь, о чём я?», the agent edited `new-model-instructions.md` and ran the repository's finalize reviewer gate (L92-L109). Owner: «вообще я тебе не говорил с ними ничего делать. ты не должен был сейчас никак менять вообще ничего. мы это пока только обсуждали» [S0:L126]. The agent reverted («Вы правы: я решил за вас и внёс правки, которые вы не заказывали.» [S0:L130]).
- Declarative check read as a statement (S5 L928, S6 L472): the owner wrote «сейчас у нас все работает, и курсор можно запускать, и можно запускать все через наш адаптер»; agent answered with rollback instructions; owner: «это, блядь, был вопрос нахуй?» then «это был вопрос: сейчас работает наш адаптер или не работает наш адаптер?». In S6: «всё получается, работа завершена» -> agent: "Great, glad it works." -> «нет, это был вопрос, лол» [S6:L472/L476]; the corrected reply listed what was tested and what not («Sorry, I read that as a statement. As a question, the answer is: the work is finished, but I've only tested it outside omp.» [S6:L478]) and the owner moved on without objection.
- Opposite signal: «Только сейчас прямо не включай, просто расскажи.» [S59:L193] versus the next order «Хочу, чтобы ты мне щас включил эту функцию экспериментальную» [S59:L195]: the owner flips explicitly between "tell me" and "do it".
- Actor confusion in dictated text (S113, 2026-10-16): «Я когда закончу всю работу, сделаю релиз commit и push» was parsed by the agent as the owner's own future action ("релиз, commit и push ты сделаешь"); owner: «Нет, ты сделаешь. Ты закончишь всю работу, ты сам сделаешь релиз, commit и push» [S113:L2588/L2598].
- Counter-example showing the safe handling: S76 L981 «ты сможешь так сделать, скажи мне, пожалуйста, или нет?» -> agent answered and asked for the one risky permission (download headless Chrome, copy profile) [S76:L986]; the owner granted it: «да, ты можешь поставить headless-браузер».
Durability: moderate. Existing Gold Standard text already says a question gets an answer, not edits; the added insight from history is that owner "questions" often have no question mark and are status checks ("...да?"), which the agent must answer with verified state rather than acknowledge.

### T4. Goal continuity, status, stalls, pauses, interruptions

Quantification (63 short pings matching continue/status patterns, forked duplicates included; S38 and S73 share 7): preceding assistant record stop reason — aborted (owner interrupt, usually 3-60 s earlier) 30; API error 4 (three 429, one 400); tool call still in flight, i.e. agent running 16; agent finished normally 13. The 13 "finished" cases are mostly "so what next / I don't understand" after a closing message that gave no next action (examples: S98 L563 after "...доступен на localhost:8000... аудио для проверки распознавания я не отправлял": «Так и что дальше-то? Я не понимаю» ; S25 L158 «так и че дальше» after a direction-only answer).

Owner words about stalls/silence:
- «что там, какой статус? мне кажется, ты подзавис немножечко, нет?» [S5:L2191]; agent admitted «Да, подготовка затянулась.» [S5:L2195] (a long plan-mode planning phase; the same message was queued twice, L2191 and L2194).
- «ты продолжаешь выполнение плана?» [S8:L639]; «какой сейчас статус выполнения плана? я не вижу туду для нашего PLAN.md» [S8:L657]; «погоди, стой. ты сейчас выполняешь наш план.md, который мы с тобой планировали так долго?» [S8:L675]; the agent confirmed the plan file lived in the session `local://` folder and not as `PLAN.md` («Yes. I'm executing the plan we built together»), owner: «все отлично. значит, мы с тобой на одной волне. продолжай работу по плану, не отвлекайся» [S8:L679] (accepted).
- «подожди, ты уже второй раз на паузу ставишься. почему ты на паузу ставишься? не понимаю, в чём проблема? почему я тебя отжимаю от паузы самостоятельно?» [S75:L5235, 10-11]; «уже полтора часа прошло, я не вижу никакого результата твоей работы. ты не даёшь никаких отчётов» [S75:L6531]. Neighbouring actions: the agent was in repeated `wait` calls for sub-agent gates and a ~10 minute image build ("Wait interrupted by message" at L5225/L5233); it later explained itself: «Отчётов было мало, потому что я долго ждал фоновые задачи» ... «Пока шло ожидание, ход завершался и цель вставала на паузу. Это моя ошибка: во время ожидания нужно было писать тебе короткий статус.» [S75:L6532].
- Repeated "still waiting" turns triggered by the harness' goal-continuation steer when the agent was blocked on the owner: S76 L986 «Работа стоит: жду твоего ответа, ставить ли headless-браузер.», L1146 «Я по-прежнему жду ответа», S75 L8436 «Продолжение ждёт команды `/mcp reload` в этой omp-сессии.», L9493 «Жду результат уже назначенной часовой проверки; задача остаётся открытой.» (16 goal-continuation records in S75, S76, S117). These continuations produce a repeat message and no work; in the S75 L8436 case the only blocker was a command the owner had to type.
- Owner interrupt-and-resume loop: owner stops the agent and types "продолжай" typically 3-60 s after an aborted assistant record (two cases only after hours, S75 L1739 and S97 L343, when the session had been left running), often when the agent's previous message was empty or only thinking (S38 L1325-1326, S75 L1735-1739, S97 L173-179, S118 L176-182). Cause not visible in the transcripts beyond silence and very long thinking blocks (thinking text lengths about 14-20k characters in S97 L158-L170); after such a resume the agent resumed the same work correctly (S118 L183 «Ожидание прервалось, проверяю состояние трёх агентов первой волны.»).
- Standing continuation rule from the owner: «продолжай» follows the owner policy at L7393 below; agent text before it: "Если всё идёт по плану, завершаю release, commit, push, production-выкатку... без новой остановки".

Durability: status-visibility is durable (S5, S8, S75, S97...). The "block only on deviation" policy is explicit: «готовый результат ты мне отдаёшь на approve, если ты что-то исправил, если что-то пошло не по плану и ты самостоятельно нашёл решение. а если ты идёшь по плану и всё получилось с первого раза, то approve никакой не нужен, надо сразу делать релиз и закрывать задачу.» and «ты ставишь блокировку, только если ты нашёл отличное от текущего согласования решение, имплементировал его и оно работает» [S75:L7393, 10-11]. It followed two Oct-10 stops where the agent asked for the owner's decision on already-planned work ([S75:L2215], [S75:L3520] «без него дальше не двигаюсь»).
Contrary: the owner accepts blocking when only he can act: the by-ear audio checks in S76 («я попросил, проверил, оно работает») and macOS permission steps; the agent's "ждёт проверки" there was necessary, just repeated by continuation.
Implication (hypotheses): (a) state a blocker once, with the exact owner action, and stop; (b) during any wait over a few minutes send one short status; (c) do not end a turn with future-tense plans ("сейчас сделаю...") while an authorised path remains; (d) after an interrupt followed by "продолжай", resume the interrupted step without recap.

### T5. Autonomy, permissions, self-sufficiency

Owner words:
- Self-driving: «так что давай не мудь, работай, блядь» [S38:L4216]; «сходи самостоятельно сейчас сделай эти проверки» [S38:L2358] (after the agent offered a monitoring script and then reported); «Так давай в след раз ты все это будешь делать сам да» [S102:L608] (agent had told the owner to click through a Marketplace page); «ты должен будешь самостоятельно безопасно найти способы решения, решить их самостоятельно и проверить, что всё действительно работает» [S75:L7329]; «Продолжай дальше сам, саб агентов не используй» [S97:L179]; «да блять если кончил то удаляй кончил паблишь» [S115:L421] after the agent asked whether to remove the worktree it had created itself.
- Agent doing the check instead of handing it back: S11 «почему ты закрыл задачу, но ты её не протестировал?» -> agent «I closed it too early. I'll run the TUI check myself now instead of asking you to.»; then «мы проверяем compaction. тебе нужно заполнить контекстное окно sonnet до этого количества токенов» [S11:L54/L56/L70] (agent had only shown the extension loads; owner required the real compaction path).
- Over-literal refusal: S10 L191-194 the agent said it could not launch the review because Claude subagents were banned for the earlier GPT task; owner: «нет, ты не sub-агента запускаешься. запускаешь codex cli и в нём запускаешь review. алло! давай не тупи, блядь» [S10:L194].
- Agent self-imposed limits on delegation: «Агент отказывается запускать специальных саб-агентов для разных задач. Он выёбывается, пиздит только то, что определённый, узкий круг саб-агентов разрешён» [S113:L8]; agent's finding: «Прямой просьбы такое ограничивать в репозитории нет» [S113:L52] (restriction lost its "custom" escape hatch when the omp harness was ported to Codex on 10-15).
- Release permission friction: S10 L257 «релиз комит пуш готов?» -> «Нет, не готов. Для commit и push нужно ваше явное разрешение» [S10:L258] (repo rule); owner later: «Так, ты сделал релиз commit и push, да? Если нет, то делай.» [S71:L772] and «Делай релиз всего этого, commit, push, завершай полностью весь цикл работы, до самого конца доводи» [S115:L1021].
- Where he wants a question first: «может, у меня спросишь, что делать надо сначала, нет» [S38:L117] (ambiguous target, large move); protected assets: «сука, ты удалил ее что ли? ты что, охуел» [S78:L116] (a font he had just selected in the terminal had vanished; the agent confirmed at [S78:L127]: «Да, шрифт пропал по моей вине. Я ставил его через brew, установка упала на середине и сама удалила уже скопированные файлы» - this is the agent's own account, the brew install it describes is not visible in lines L95-L113 of this session, where listings show the font absent from ~/Library/Fonts; the agent's L113 command also chained an `rm -f` of the other font family before the owner asked for that removal at L120) and the omp-rebuild ban [S59:L1434].
- Questions the owner is happy to answer in compact form: «го 1а2а3б4а5а» [S115:L52] after a five-question block with recommended options; the same style «1а 2a 3b go» [S113:L234].
- Cleanup he wants done without asking: «Надо удалить, чтобы чистенько было, чтобы не было никаких лишних фишесов. У нас центр должен быть всегда чистый.» [S97:L4703]; «Все лишнее, все, что сейчас заморожено и не используется, не активно, все нужно поудалять» [S106:L837].

Durability: strong for "do it yourself, test it yourself, finish the cycle"; strong for per-task delegation authority being the owner's. Contrary: the owner also designed approval cards and go-questions earlier (S30 L116: «агент всё максимально автономно проектирует, а мне даёт только на approve свои решения»), then complained on 10-16 «доёбывает меня как владельца постоянными планированиями каждого пука, каждого чиха и подтверждения Go» [S113:L462]; the resolution (omp session 01a130bc, main-project partition) was "ask only about ambiguous wording and the agent's own decisions"; in these sessions the agent re-applied it in Codex ([S113:L641]).
Implication: autonomy inside the order is expected, with one question reserved for a genuinely ambiguous reference or a decision that goes beyond or departs from his words; permission requests that merely restate an earlier authorisation are friction.

### T6. Definition of done: real behaviour, verified by the agent, shipped

- «и когда у тебя всё работает, только тогда считается работа выполненной» [S38:L3656, 10-08] (currency fixed in production, then sales history staged; per-stage completion, blind review of own work).
- Release/commit/push as part of done (all harness repos): status questions «ты провел релиз, сделал commit, push, и все, можно уже работать, да?» [S8:L714], «все, кодекс можно перезапускать. все полностью зарелизено и запушено, да?» [S28:L586], «ты сделал полный релиз commit и push, да» [S37:L234], «Ты щас и релизил, и закомментил, и запушил, да? Я правильно понимаю?» [S59:L1120], «Так, ну всё, ты всё зарелизил, ты всё выложил, всё заебись, да?» [S113:L2092]; orders «теперь делай релиз и пуш», «да, и не забудь сделать commit и push» [S5:L1105]. A keyword sweep gives 69 distinct snippets mentioning release/commit/push across 23 sessions (16 in S113).
- The agent's truthful split between tested and not tested is the accepted form: «the work is finished, but I've only tested it outside omp» [S6:L478]; S113 final report on release said «Живой запуск Codex с новым промптом и профилями `medium` я не делал, ты его не заказывал.» [S113:L2093] and the owner then asked a different question rather than objecting.
- Deviation not disclosed in report: S113 L2203-L2205 above.
- Verifying the requested behaviour rather than a proxy: S11 above («а нахуй такая проверка нужна?»).
Durability: strong. Note the repo rule in S10 (release needs explicit permission) coexists with the owner's repeated explicit orders; for non-harness repos the owner requested release as part of closing a task only in goal contexts ([S75:L7393]).
Implication: the final message should state whether the thing was actually run/deployed/released, and what was not verified; do not answer "done?" with an acknowledgement.

### T7. Reviews and checks: economy as the owner states it

Owner words: «Я передумал, давай для второго вопроса первый вариант» [S8:L420, 10-05] (the agent's proposal to run already-existing checks; earlier answer in the same plan dialogue was "Keep the ban", [S8:L417 result "checks: Keep the ban"]); «везде это по отдельности, никаких не должно быть цепочек ревьюеров. это какая-то залупа» [S30:L458]; «Каждый микромомент должен быть сверен через две слепые проверки ревьюерами подряд» [S106:L323, 10-15]; «1b проверь каждый вырезанный блок через слепую проверку, что ничего лишнего не сделал, и всю работу сдай через слепую проверку» [S113:L1583]; «не забывай перепроверить работу, которую ты сдаёшь через Spotty» [S76:L2007]; «Перепроверка, что план действительно пизда, что ты ничего лишнего не написал, ничего лишнего не удалил» [S97:L6732]; «ты делал review? Я вижу, ты сказал «клин». Сколько было доработок до того, как вы клин получили в первый раз?» [S97:L5639].
Episodes: (a) S0: reviewer gate run for an unauthorised edit; (b) S113 L2118-L2189: a three-sentence prompt addition took four reviewer briefs (SpDoc3, SpInst3) and three commits before the squash release, with no owner complaint in that window; (c) S75 L5100-L6520: ~1.5 hours of blind gates, docs-code consistency gates and image builds produced the "no reports" complaint [S75:L6531]. In S113 L2005 the agent reported "Работу целиком и документацию Smarty принял с четвёртого прохода".
Reading: the owner asks for independent review himself on substantive work and counts its rounds; what he objects to is chains of reviewers, ambiguous reviewer roles, and silence. There is no message in this partition asking for fewer checks on a task the repo rules already gate; the only "no tests" statement is the Sol-5.6 over-engineering context ([S8:L162]) and it was reversed for existing checks ([S8:L420]).
Implication: do not add review/check rules to the base prompt; the history supports status visibility while reviews run, not changing review depth.

### T8. Concise helpful communication

Owner words (selection; 44 distinct messages under a broad pattern, 26 under a strict one): «что-то ты, блядь, простыню какую-то написал. давай кратенько» [S0:L48, 10-04]; «что за простыня? кратко распиши» [S3:L29]; «ты очень много текста написал. я не осилю так много» [S6:L72]; «ты просто пишешь очень длинные ответы. я не могу читать такие объёмы информации, поэтому я прочитал только верхний абзац» [S8:L212]; «кратко отвечай, пожалуйста, без простыней» [S9:L125]; «почему ты постоянно так спамишь дохуя текста в ответе?» [S42:L49, 10-07]; «супер кратко ответь мне, пожалуйста, что там по сундукам у нас, по ошибкам, по продаже кейсов. супер кратенько, просто табличкой и чётиком» [S38:L3221]; «ты можешь как-то по-простому объяснить на пальцах» [S99:L28, 10-13]; «так че как мне пользоватлся расширением этим кратко в 2 строки» [S102:L709, 10-14]; «Максимально кратко на простом русском языке, так, чтобы тупой понял» [S111:L5, 10-15]; «не пиши ты ему сообщение длиннющее» [S76:L1475] (about a prompt the agent was sending to a tool).
Language/format: «да, и транслитом больше не пиши, пожалуйста» [S4:L125]; «перестань транслитом писать. мы уже это правило удалили» [S5:L132]; terminology he does not follow: «Погоди, что за Define Global Plan Mode? Это что такое?» [S113:L644], «Я не понял, что такое пример первый init?» [S113:L1508], «я не понял, что это значит» [S8:L156]; anti-sycophancy on demand: «Не поддакивание тобой мне, не голослое опровержение, а именно экспертное независимое мнение со стороны» [S112:L39].
Neighbouring data: assistant final messages over the whole partition have median 1,056 characters (p75 1,678; p90 2,624). The brevity complaints followed messages of 3,209 [S0:L48], 2,606 [S3:L29], 2,096 [S6:L72], 2,425 [S8:L212], 4,852 [S9:L125], 1,595 [S42:L49] characters; at 907 and 204 characters the owner still asked for "по-простому" [S99:L26-L28] because of complexity, not length. Complaints per day (counting regex hits): 10-04: 6, 10-05: 11, 10-06: 1, 10-07: 14, 10-08: 4, then 0-4 per day to 10-17. Median final-message length fell on 10-11/10-12 (455-561 characters). The clear-communication skill existed in later sessions; causality is not established.
Updates: on 2026-10-04 he stated the intended rule himself: «он должен был сделать, что апдейты только по значимым событиям» [S3:L53]. Tension: he complains of "спамишь... сообщений" [S42:L49] and, 4 days later, of getting no reports for 1.5 hours [S75:L6531]. Both are consistent with: few, short, meaningful updates, but never silence over a long wait. Whether the base prompt's mandatory pre-search and pre-edit updates would trigger the "спамишь" complaint cannot be tested here, because these sessions ran other prompts (hypothesis only).
Durability: strongest of all themes; mitigated but not gone after 10-08.

### T9. Research depth: explicit, task-level; prior art first; source limits

Owner words (explicit depth requests): «я хочу, чтобы ты сейчас проанализировал всё суперглубоко и подготовил мне краткий отчёт» [S4:L222]; «курсор делает суперширокие грепы» [S8:L186]; «Я хочу, чтобы ты сейчас широким, глубоким, жадным поиском через поисковых сабогентов — можешь поднять их до 10 штук» [S105:L8, 10-14]; «суперглубокий, широчайший поиск тебя прошу сделать» [S77:L9]; «суперглубочайший research Kaspi.kz» [S118:L11, 10-17]; the benchmark replay in a test session «жадный поиск делай максимально» (steering message in benchmark session 01a122cd, L132).
The owner's pre-goal ritual (verbatim, four sessions, 10-16..10-17): «Мне нужна более глубокая версия этой задачи, а не более масштабная.» followed by the four-point rewrite request («Назови максимально исходные данные или материалы, которые он использовал бы вместо уже подготовленной для меня информации.» ... «Объясни, какие независимые от нас с тобой доказательства подтвердили бы правильность результата.») [S115:L10; also S113:L2546, L2794; S115:L580; S117:L9; S118:L11], then "Define goal" and a quick letter-coded answer [S115:L18, L52]. This is the origin of the present task framing.
Prior-art-first: «иди посмотри, как выставление на продажу работало три года назад, два года назад, полтора года назад, год назад» [S97:L98]; «ты посмотри, как он раньше работал с историей сделок» [S75:L1972]; «на основе старого python кода, который есть в этом репозитории, надо понять, как раньше мы защищались от 429» [S38:L588]; plus "simplest": «найти самое простое решение по нашему workflow-манифесту» [S75:L7329].
Source limits are honoured literally: «эта информация строго из интернета должна быть взята. никаких локальных поисков» [S25:L31]; «Никуда не ходи, никакие Интернеты, ничего. Просто занимайся разбором самого application нашей тачки» [S98:L31].
Durability: depth is requested with explicit words; default is simple/direct (S114, S102). 
Implication: depth words from the owner are instructions; absent them, simplest path; do not infer depth from adjectives like "идеально" alone.

### T10. Delegation and parallelism

Owner words: «у меня ни в одной из моих сессий не запущен cloud code. везде работают gpt-6.1-sol. и у меня вытекло 40% пятичасового окна cloud code» [S6:L1045, 10-05]; «если основной чат работает на cloud коде, то саб-агенты могут быть с cloud кодом. если же основной чат gpt, то саб-агенты только gpt» [S6:L1103]; tier matrix «для чата GPT саб-агенты для простых задач, супер примитивных 6 Luna medium или механических» [S6:L1168]; «я разрешаю использовать саб-агентов для ускорения работы в рамках той матрицы usage» [S5:L2163]; later: «подними саб-агента на хайку high reasoning, и пусть он делает всю работу, а ты с ним общайся» [S76:L830, 10-10]; «Каждый раз при переходе на новый чат надо полностью сбрасывать окно, чтобы не тратить токены sub-агентов на это» [S111:L119]; «Только сам не используй браузер, а подними саб-агентов — Haiku, Extra, Hi.» [S118:L11]; «пожалуйста, перезапусти всех саб-агентов. там composer поменялся, coding agent поменялся и продолжай задачу» [S38:L3032]; per-task prohibition «саб агентов не используй».
Episode (S6 L1045-L1047): quota leak. The agent's own account: `scout` subagent launched without a model, routed to Anthropic, returned a 429 ([S6:L1046]). The fix was owner policy, not agent judgement. Parallel batches: «до 50 параллельных запросов»; 40-50 summarisation subagents ([S111:L200]).
Reviewer separation: [S30:L458]. Harness narrowing: [S113:L8].
Durability: model-family rule strong while the main chat is GPT; counts, tiers and permission for or against subagents are per-task owner statements. Both directions occur ([S97:L179] ban; [S114:L65] "Давайте сабо-агентов подними, GPT-6.1 Solo").

### T11. Agreements, context loss, compaction

Owner words about the problem: «что бы агент не забывал о чем мы с ним договорились на протяжени 365ого компакшена этого чата» (pasting his own chat text) [S112:L5, 10-15]; «надо сделать какое-то tool, которое будет их оттуда извлекать и доставлять в контекст агенту автоматически, без вызова, без всяких инструкций, чтобы агент сам этим не занимался» [S112:L31]; «Все их предложения сводятся к тому, что агент сам должен записывать и сам должен вспоминать. И он тратит на это ходы, токены.» [S112:L39].
Compaction mechanics he cares about: «уложиться в один compaction» [S4:L274]; «почему, кстати, в конце, когда ты завершаешь выполнение задачи, у тебя контекстное окно почти пустое?» [S8:L718]; «Я проспал compaction.».
Lost agreements seen in transcripts: S71 L337 (setting applied partly), S59 L1434 (harness untouchable), S113 L8 (restriction lost in port), S5 L132 ("мы уже это правило удалили": translit rule). Harness responses present in the data: omp developer message after compaction ("Resume the user's latest intent... do not invent work", seen from 2026-10-05: S8 L613, S39 L343), `my-omp-harness.decisions` records with verbatim owner quotes in S115-S118 (registry D1-D7 with `quote` fields), the todo `session-stop-continuation` reminder (7 uses, S97/S105/S106/S115).
Durability: strong need; mechanism exists in harness, so base-prompt text should only keep the generic rule not to restart or reconstruct.

### T12. Dictated and self-correcting messages

«поэтому я переобуваюсь в воздухе» [S8:L420]; «Подожди, я перепутал. Ты должен взять GPT 6.1 RC2 в Cursor Remaster.» [S113:L2816]; «Хотя нет, 300 тысяч — до хера.» (stream of revisions ending in «Пусть, короче, у этого «Клаудкода» будет 400 — 270. 400 тыс. — контекстное окно, 270 — compaction.») [S71:L539]; «не ответное мнение, а эти отклонения я принимаю» (STT error repaired after the agent's empty turn L6552) [S75:L6556]; «На VPS, а не РПС» [S97:L8112]. Rule from evidence: the last stated decision in a dictated message governs; speech-to-text near-homophones should be resolved from context or by a one-line check, not by acting on the literal word.

## 4. One-off versus durable (assessment)

| Rule | Evidence span | Assessment |
|---|---|---|
| Brevity, first paragraph is what he reads | 10-04..10-17, 44 distinct messages | durable |
| Result minimal, path fast, low TPS | 10-04..10-16 | durable; origin = 5.6 Sol over-engineering |
| Literal scope, out-of-scope gates, verbatim when told | 10-04..10-17 | durable |
| Agent tests and ships itself; release/commit/push is part of done in harness repos | 10-04..10-16 | durable (explicit orders each time) |
| Block only on deviation (goal context) | 10-11 | explicit owner policy for goal work; later reuse in Codex port |
| No cross-family subagents; tiers; per-task counts | 10-04..10-15 | durable for family rule; counts per task |
| Reviewers one per stage, no chains | 10-06 | one explicit statement; consistent with later use |
| Double blind review for cleanup release | 10-15 | task-specific order |
| No translit / drop translit rule | 10-04 | one-off era (ru-mode experiments); not durable |
| Fast-mode off in measurement | 10-05 | one-off task |
| 30-minute observation windows | 10-07, 10-11 | task-specific, reversed |
| Workers on max reasoning | 10-16 (raised and reverted the same day) | measured, reversed |

## 5. Contradictions and later changes to keep in view

1. Approvals: designed approve-card flow ([S30:L116], 10-06) -> "approve only on deviation" for goal work ([S75:L7393], 10-11) -> complaint about "go" confirmations and constant planning ([S113:L462], 10-16) -> accepts compact letter-coded question blocks for a big goal ([S115:L52], 10-16). Net: questions only for ambiguity or the agent's own decisions.
2. Checks: "Keep the ban" ([S8:L417]) vs "run existing checks" ([S8:L420]) in the same dialogue; blind double review ordered for one release ([S106:L323]) vs "no chains" ([S30:L458]).
3. Monitoring after deploy: asked for an hour ([S38:L2349]) -> "skip" ([S38:L3058]) -> "не будем мониторить" ([S38:L3606]) -> require one hour ([S75:L7329]).
4. Detail: "суперкратко" many times vs "по подробному абзацу на каждое действие" when he wants proof the agent understood a plan ([S38:L3606]); detail is by explicit request only.
5. Delegation: ban ([S6:L1061], [S97:L179]) vs «можешь поднять 40 sub-агентов, 50» ([S111:L200]) vs "why do you refuse subagents" ([S113:L8]).
6. Release: repo rule needs explicit permission ([S10:L258]) vs repeated "ты сам сделаешь релиз" ([S113:L2598]).
7. Main agent models differ across sessions, and in S5/S6 the agent replies were English while the owner read them through the translation experiment (ru-mode); misparse by the model cannot be separated from the translation layer there.

## 6. Coverage already in current SYSTEM.md and skills (directly relevant)

- Gold Standard (skills/gold-standard) already states: shortest path; exactly what was asked; "a question, diagnosis, review, or plan gets an answer, not edits"; authorisation persists; no second approval; stop when done; truthful reporting. Main Workflow covers approval step, todo, goal block-and-end-turn behaviour, `/define-goal`. Clear Communication covers top-line-first, 12-sentence cap, "Explain a long wait once".
- Base SYSTEM.md has: newest message steers; status then keep moving; sanity check after resume; compaction paragraph; pre-exploration and pre-edit updates (potential tension with the owner's "спамишь" and low-TPS statements; untested in this history); `main_goal`: "Your main goal is to follow the USER's instructions at each message" (no explicit completion or continuity clause).
- Not covered in the SYSTEM.md, Gold Standard, Main Workflow and Clear Communication text I read: declaratives as check-questions answered with verified state; actor ambiguity in dictated first-person text; repo/target ambiguity resolved from cwd before large moves; "minimize" scoping language that distinguishes deliverable from path; status during long waits tied to goal pauses.

## 7. Limits of these conclusions

- Evidence is the owner's words and observed failures, mostly from Claude Opus/Sonnet 5.5 and GPT-6.1 Sol sessions between 2026-10-04 and 10-17; no measurement of any prompt change.
- The owner's wording is colloquial and sometimes dictated; interpretations marked as hypotheses are mine.
- Counts depend on regex classification and include forked duplicates; they are for scale.
- "Neighbouring action" claims refer to the JSONL records cited; assistant thinking was not read except lengths.

## Appendix A. Session index (cited sessions; chronological index of the 119 non-benchmark sessions)

Models: main-agent model(s) per session = the two most frequent `message.model` values on assistant records of that session file (count of assistant messages). Dominant model per session across the 119: claude-sonnet-5-5 49, claude-opus-5-5 41 (incl. anthropic/claude-opus-5.5), gpt-6.1-sol 15, composer-2.5 7, gpt-6-sol 5, others/none 2. None of these is the GPT-5.5 prompt under review.

| S | created (UTC) | session id | project | user msgs (real/probe) | main model(s) | title |
|---|---|---|---|---|---|---|
| S0 | 2026-10-04T10:39 | 01a1067e-f06a-771e-be3c-0c524a3ff914 | ~/Documents/ChatGPT/my-codex-harness | 17/0 | anthropic/claude-opus-5.5(28), anthropic/claude-sonnet-5.5(16) | Адаптировать системный промпт для омп |
| S1 | 2026-10-04T10:50 | 01a10689-2d3e-767d-8372-84a29dba4a5c | /tmp | 0/1 | anthropic/claude-opus-5.5(1) | Ответь одним словом: какой стандарт у тебя действует по умолчанию (Gol |
| S2 | 2026-10-04T11:17 | 01a106a2-039e-74e6-ba54-0febe47f8ad1 | ~/Documents/ChatGPT/my-codex-harness | 7/0 | gpt-6.1-sol(35) | Удали omp openrouter из провайдеров |
| S3 | 2026-10-04T11:27 | 01a106ab-1a6a-7380-8ff5-e18bde5aacbf | ~/Documents/ChatGPT/my-codex-harness | 9/0 | claude-sonnet-5-5(30), claude-opus-5-5(15) | Просмотреть последние коммиты по smus |
| S4 | 2026-10-04T17:26 | 01a107f3-da79-75a2-be66-fb1898311c80 | ~/Documents/ChatGPT/my-codex-harness | 41/0 | gpt-6.1-sol(198), claude-sonnet-5-5(65) | Сравни сбор контекста Cursor и Codex |
| S5 | 2026-10-04T17:29 | 01a107f6-6216-74c2-8f4c-96247e85277e | ~/Documents/ChatGPT/my-codex-harness | 66/0 | gpt-6.1-sol(356), claude-sonnet-5-5(241) | Реализовать OpenAI API через Codex CLI |
| S6 | 2026-10-04T17:46 | 01a10806-55ea-77ff-9d34-78b2d09f7033 | /tmp | 61/0 | gpt-6.1-sol(185), claude-sonnet-5-5(160) | Починить перевод с английского на русский |
| S7 | 2026-10-04T18:22 | 01a10827-2964-7713-ac46-9a6ac8d324ab | /tmp | 0/1 | claude-sonnet-5-5(4) | docs |
| S8 | 2026-10-05T06:13 | 01a10ab1-fd51-713b-bf56-9caa0bc4f3a9 | ~/Documents/ChatGPT/my-codex-harness | 28/0 | claude-opus-5-5(189), claude-sonnet-5-5(24) | Execute PLAN.md for Lunatron hooks |
| S9 | 2026-10-05T09:04 | 01a10b4e-566e-7781-a6a9-b9529b4be1d5 | /tmp | 10/0 | claude-opus-5-5(28), composer-2.5(9) | OMP sub-агенты и хоткеи |
| S10 | 2026-10-05T10:22 | 01a10b96-33b9-7485-8b87-c81e451d3bc1 | ~/Documents/ChatGPT/my-codex-harness | 14/0 | claude-sonnet-5-5(89), claude-opus-5-5(26) | Openai codex adapter gap |
| S11 | 2026-10-05T10:23 | 01a10b97-3a9e-7515-86a0-45e585de88b2 | /tmp | 11/0 | claude-sonnet-5-5(44), claude-opus-5-5(2) | Compact at 244k |
| S12 | 2026-10-05T10:24 | 01a10b98-39fc-7317-8ecb-32b665950b56 | /tmp | 6/0 | claude-sonnet-5-5(13), composer-2.5(1) | Check omp model switch behavior |
| S13 | 2026-10-05T10:26 | 01a10b99-98d3-74ea-a467-fdf20a5e83a3 | /tmp | 0/1 | claude-opus-5-5(1) | reply with ok |
| S14 | 2026-10-05T10:44 | 01a10baa-b255-7117-8bc2-7741de16bf62 | /tmp | 0/1 | claude-opus-5-5(1) | hi |
| S15 | 2026-10-05T10:45 | 01a10bab-5295-7463-8f7e-e239de79577c | /tmp | 0/1 | claude-sonnet-5-5(1) | hi |
| S16 | 2026-10-05T10:48 | 01a10bad-9130-7044-afac-6b2cf095b96a | /tmp | 0/1 | claude-sonnet-5-5(81) | Read files f01 through f40 sequentially |
| S17 | 2026-10-05T10:58 | 01a10bb7-0519-7324-a5e5-4523c32e5385 | /tmp | 0/0 | claude-sonnet-5-5(6) | Disable ru mode |
| S18 | 2026-10-05T10:58 | 01a10bb7-26a0-7210-8507-1282e6876afb | /tmp | 0/1 | claude-sonnet-5-5(1) | привет |
| S19 | 2026-10-05T12:41 | 01a10c15-6ac6-71e4-a4d0-529793279af9 | /tmp | 0/2 | composer-2.5(2) | cd ~/Documents/ChatGPT/my-codex-harness/ |
| S20 | 2026-10-05T12:42 | 01a10c16-7c27-7497-9fe0-60f7fd05c114 | ~/Documents/ChatGPT/my-codex-harness | 1/0 | composer-2.5(1) | Создать myompharness рядом |
| S21 | 2026-10-05T13:10 | 01a10c30-28dd-7512-a45c-be10d2918b9e | ~/Documents/ChatGPT/my-codex-harness | 4/0 | claude-opus-5-5(76), claude-sonnet-5-5(33) | Cursor vs codex fixes |
| S22 | 2026-10-05T13:43 | 01a10c4e-6863-7198-a23e-cf4fef50ec6b | /tmp | 4/0 | composer-2.5(3), claude-sonnet-5-5(1) | Ищу актуальную информацию о fast-режиме в подписке Max x20 |
| S23 | 2026-10-05T15:29 | 01a10caf-3a25-73d4-b2a1-562105f9e16b | ~/Documents/ChatGPT/my-codex-harness | 11/0 | claude-opus-5-5(136), claude-sonnet-5-5(73) | Compare Codex and Cursor agent performance |
| S24 | 2026-10-05T16:03 | 01a10cce-4240-7365-b365-84c3f49a381e | ~/Documents/ChatGPT/my-codex-harness | 1/0 | claude-opus-5-5(18), claude-sonnet-5-5(4) | Opus autocompaction 231k plan |
| S25 | 2026-10-05T16:53 | 01a10cfb-e799-73ba-a1a4-d2e4a8a1a707 | /tmp | 4/0 | gpt-6-sol(30), claude-opus-5-5(1) | Выяснить варианты удаленного доступа к OMP |
| S26 | 2026-10-05T19:37 | 01a10d91-d2c9-7078-8506-6ef7a3d5a84c | ~/Documents/ChatGPT/my-codex-harness | 5/0 | claude-opus-5-5(107), claude-sonnet-5-5(33) | Analyze exec_command failures in session rollouts |
| S27 | 2026-10-05T20:44 | 01a10dcf-b1f7-74cc-a9bf-1a9e26004928 | ~/Documents/ChatGPT/my-codex-harness | 1/0 | claude-sonnet-5-5(8), claude-opus-5-5(2) | Reviewer models |
| S28 | 2026-10-05T21:02 | 01a10ddf-bc37-7087-b0a2-97b00a8916d9 | ~/Documents/ChatGPT/my-codex-harness | 18/0 | claude-opus-5-5(104), claude-sonnet-5-5(45) | Exec hardening exec Scope Focus codex tools |
| S29 | 2026-10-05T21:36 | 01a10dff-6cba-771f-94a4-3aa015b950d5 | ~/Documents/ChatGPT/my-codex-harness | 9/0 | claude-opus-5-5(126), claude-sonnet-5-5(42) | Analyze exec_command failures in session rollouts |
| S30 | 2026-10-06T10:31 | 01a110c4-5367-772f-803f-c3a1a3cfa86b | ~/Documents/ChatGPT/my-codex-harness | 14/0 | claude-opus-5-5(157), claude-sonnet-5-5(2) | Remove html-brief feature references |
| S31 | 2026-10-06T11:58 | 01a11114-34d8-7248-a9a1-c6724d37928b | /tmp | 16/0 | gpt-6.1-sol(44), claude-opus-5-5(24) | Find terminal app with sidebar tabs |
| S32 | 2026-10-06T13:54 | 01a1117e-2cac-7743-ba69-606ab2b0a168 | /tmp | 2/0 | claude-opus-5-5(9) | Explain how success feature works |
| S33 | 2026-10-06T14:09 | 01a1118c-218f-763f-a62e-648769969ed1 | /tmp | 9/0 | claude-sonnet-5-5(121), claude-opus-5-5(58) | Установить herder для запуска агента |
| S34 | 2026-10-06T17:07 | 01a1122f-843c-7551-ae7d-09788762a3c2 | /tmp | 0/1 | gpt-6.1-sol(1) | ответь одним словом: ок |
| S35 | 2026-10-06T17:23 | 01a1123d-ee18-7379-b0d5-dddbb7bb5378 | /tmp | 0/1 | gpt-6.1-sol(1) | ответь одним словом: ок |
| S36 | 2026-10-06T17:54 | 01a1125a-101c-7520-ac12-250cd2a5eec6 | /tmp | 0/1 | claude-sonnet-5-5(3) | Answer in three lines. Lines 1-2, yes or no: does your system prompt c |
| S37 | 2026-10-06T18:00 | 01a1125f-9a7f-7012-abbd-1199d6893ccd | ~/Documents/ChatGPT/my-codex-harness | 2/0 | claude-opus-5-5(56), claude-sonnet-5-5(2) | Smarty plan mode |
| S38 | 2026-10-06T21:49 | 01a11331-6e38-73e4-a20e-47a1e152745d | ~/PycharmProjects/superbot | 57/0 | claude-opus-5-5(700), claude-sonnet-5-5(192) | Configure Sentry alerts with frequency thresholds |
| S39 | 2026-10-06T22:04 | 01a1133e-d988-75c6-9fef-d92cad8d3ae8 | /tmp | 8/0 | gpt-6.1-sol(29), claude-sonnet-5-5(19) | Инвентаризация глобальных настроек Codex |
| S40 | 2026-10-07T01:09 | 01a113e8-8ab5-7429-8821-48fe486cba24 | /tmp | 6/0 | composer-2.5(6) | Настройка Grok Bot и GPT bot |
| S41 | 2026-10-07T02:37 | 01a11438-c60a-77df-a211-ffc77af33e06 | /tmp | 6/0 | claude-sonnet-5-5(10) | Проверить режим non-thinking у Sonnet |
| S42 | 2026-10-07T04:07 | 01a1148b-a98b-7389-9821-5adc316e815b | ~/PycharmProjects/superbot | 7/0 | claude-fable-5-1(45) | Brainstorm trading bot architecture and hosting |
| S43 | 2026-10-07T04:10 | 01a1148e-2985-73f5-aca3-697183ae3135 | $TMP/scope-focus-tospec-W8jRdF | 0/1 | gpt-6-sol(1) | Reply with the single word ok. |
| S44 | 2026-10-07T10:17 | 01a115de-6915-741e-9343-684e87b340f1 | $TMP/scope-focus-tospec-BXSI4l/exp | 0/1 | gpt-6-sol(2) | List the exact names of all tools you can call, comma-separated, then  |
| S45 | 2026-10-07T10:17 | 01a115de-a577-763a-a8aa-b87c920b02d8 | $TMP/scope-focus-tospec-BXSI4l/exp | 0/1 | gpt-6-sol(2) | Print the JSON parameter schema of your glob tool (property names only |
| S46 | 2026-10-07T10:18 | 01a115de-f4b1-778b-87c7-48611d53005e | $TMP/scope-focus-tospec-BXSI4l/exp | 0/1 | gpt-6-sol(2) | Call your glob tool once to find '*' and reply with the property names |
| S47 | 2026-10-07T16:54 | 01a11749-ae7d-73c3-b003-3646ee6f4fb8 | /tmp | 1/0 | claude-opus-5-5(4) | Понять, как правильно использовать Opus и Sonnet |
| S48 | 2026-10-07T16:59 | 01a1174e-06e3-7486-86e2-ed1b5b364165 | /tmp | 5/0 | claude-opus-5-5(16) | Понять, как правильно использовать Opus и Sonnet |
| S49 | 2026-10-07T18:23 | 01a1179b-4fb2-70f3-a91b-b8d3ab60bd59 | /tmp | 0/1 | claude-sonnet-5-5(1) | Without calling any tool, list the exact names of all tools you have,  |
| S50 | 2026-10-07T18:23 | 01a1179b-7b72-7114-b36f-e60d29580550 | /tmp/strrep | 0/1 | composer-2.5(1) | In f.txt replace the word beta with gamma using your file edit tool (n |
| S51 | 2026-10-07T20:28 | 01a1180e-07a0-717f-92e3-82900604c562 | /tmp | 2/0 | claude-opus-5-5(20), claude-fable-5-1(6) | 🔒 CERT: Разобраться с протухшим сертификатом dumbproxy |
| S52 | 2026-10-07T20:41 | 01a11819-d33b-77b1-bdc6-9c936954bdda | /tmp | 0/1 | claude-sonnet-5-5(18) | Execute approved ToSpec plan |
| S53 | 2026-10-07T23:41 | 01a118be-120b-7630-b2e2-01272311bf26 | /tmp | 0/1 | composer-2.5(1) | Without calling any tool: list every tool name you have (native and MC |
| S54 | 2026-10-07T23:41 | 01a118be-34c6-744a-b293-ba05ee171edd | /tmp | 0/1 | composer-2.5(1) | Without calling any tool: list every tool name you have (native and MC |
| S55 | 2026-10-08T11:57 | 01a11b60-9821-73bc-a138-a083430e7c33 | /tmp | 1/0 | claude-opus-5-5(6) | 🧭 MODES: Разобраться в режимах и командах OMP |
| S56 | 2026-10-08T14:23 | 01a11be5-cd2d-73f8-a3a5-6ee27c7f2d66 | /tmp | 0/1 | claude-sonnet-5-5(2) | Answer in three lines. Lines 1-2, yes or no: does your system prompt c |
| S57 | 2026-10-09T01:48 | 01a11e59-0279-77c9-af55-55c4495b9848 | /tmp | 2/0 | claude-opus-5-5(8) | 🧠 AGENT: Разобраться с памятью субагентов omp |
| S58 | 2026-10-09T04:39 | 01a11ef5-3965-70d0-8286-6df5d524a357 | /tmp | 0/0 | claude-opus-5-5(13) | 📊 CODING: Таблица Coding Index Artificial Analysis |
| S59 | 2026-10-09T06:26 | 01a11f57-50b6-7042-9bc8-745d0f4b32ed | /tmp | 52/0 | claude-opus-5-5(307), claude-sonnet-5-5(10) | 🔁 LOOP: Test pi-lcm in isolation from harness |
| S60 | 2026-10-09T07:27 | 01a11f8e-e23e-7644-ba95-38c1589ef215 | /tmp | 1/0 | claude-opus-5-5(9) | 🐋 OMP: Compare omp and codewhale |
| S61 | 2026-10-09T10:14 | 01a12028-739e-71ee-be02-3ebf62ed2a17 | /tmp | 3/0 | claude-opus-5-5(15) | 🔐 PROXY: Diagnose dumbproxy on sshpx server |
| S62 | 2026-10-09T10:23 | 01a12030-429d-70ec-b693-6da9935ab2fa | /tmp | 5/0 | claude-sonnet-5-5(24) | 💰 HAIKU: Узнать цену токена Haiku 5.5 |
| S63 | 2026-10-09T16:50 | 01a12193-22a7-7536-9141-d679689eca75 | /tmp | 7/0 | claude-opus-5-5(24), gpt-6.1-sol(16) | ⌨️ CLI: Добавь OpenAI-совместимый endpoint в Cursor CLI |
| S64 | 2026-10-09T20:50 | 01a1226e-6b4d-7301-9c84-edaf45ed27f5 | $TMP/tmp.MOH0wXI9oA | 0/1 | claude-sonnet-5-5(5) | Launch codebase_explorer with the name RuleCheck and the task 'The cod |
| S65 | 2026-10-09T22:50 | 01a122dc-84ac-7057-96e6-c8442f3e6a9e | /tmp | 0/1 | claude-opus-5-5(1) | Without calling any tool: list the exact names of all your tools, comm |
| S66 | 2026-10-09T22:59 | 01a122e4-61ba-7173-a792-41d1bfb97d6e | /tmp | 0/1 | claude-sonnet-5-5(3) | Answer in three lines. Lines 1-2, yes or no: does your system prompt c |
| S67 | 2026-10-09T22:59 | 01a122e4-b209-74d5-8a25-0b6ff64f29fa | /tmp | 0/1 | claude-sonnet-5-5(4) | Call the task tool once, with no model field anywhere, context 'Instal |
| S68 | 2026-10-09T23:21 | 01a122f8-e224-77e5-abf0-e7e19d9b03ff | /tmp | 0/1 | claude-haiku-5-5(9) | Read the file /tmp/ompsrc/packages/coding-agent/src/session/agent-sess |
| S69 | 2026-10-09T23:23 | 01a122fa-d270-75f2-9223-91156627ae92 | /tmp | 0/1 | claude-sonnet-5-5(3) | Answer in three lines. Lines 1-2, yes or no: does your system prompt c |
| S70 | 2026-10-09T23:23 | 01a122fb-024e-7191-a048-6ddac19155de | /tmp | 0/1 | claude-sonnet-5-5(5) | Call the task tool once, with no model field anywhere, context 'Instal |
| S71 | 2026-10-10T01:06 | 01a12358-cfae-74cb-b90d-92f8ce39deda | /tmp | 32/1 | claude-opus-5-5(231), claude-sonnet-5-5(13) | 🎯 SCOPE: Integrate LCM plugin into main OMP build |
| S72 | 2026-10-10T01:07 | 01a12359-70f5-7736-be5e-d8b6f8da774d | /tmp | 0/1 | claude-opus-5-5(1) | say ok |
| S73 | 2026-10-10T02:23 | 01a1239f-a87b-7544-9345-97987c501e56 | ~/PycharmProjects/superbot | 54/0 | claude-opus-5-5(627), claude-sonnet-5-5(192) | Investigate Sentry errors on VPS |
| S74 | 2026-10-10T02:24 | 01a1239f-d7dd-74d7-9bb9-c52161f6d7ab | ~/PycharmProjects/superbot | 1/0 | claude-opus-5-5(42) | Упаковать весь бот в docker compose |
| S75 | 2026-10-10T03:01 | 01a123c1-eb0b-7271-96aa-77fedec1a168 | ~/PycharmProjects/superbot | 31/1 | claude-opus-5-5(1387), gpt-6.1-sol(618) | Перевести сбор курсов на японские иены |
| S76 | 2026-10-10T19:05 | 01a12735-2f46-779a-94b2-d88d1cd473ff | ~/ai-project/gpt-read-aloud | 43/0 | claude-opus-5-5(486), claude-sonnet-5-5(7) | Recreate Codex realtime WebRTC in Chrome extension |
| S77 | 2026-10-11T01:20 | 01a1288c-1aa6-74cc-bb2b-c820dc07c985 | /tmp | 2/0 | claude-opus-5-5(15) | Find best computer-use and browser-use tools |
| S78 | 2026-10-11T02:14 | 01a128bd-92dc-7161-81b1-b2b76996bd2e | /tmp | 8/0 | claude-opus-5-5(30), claude-sonnet-5-5(7) | Отключить автозапуск tigrep |
| S79 | 2026-10-11T02:47 | 01a128db-9647-77c0-9aef-5ddfa568cb6b | ~/Documents/ChatGPT/my-omp-harness-worktrees/cursor-ui | 0/8 | claude-sonnet-5-5(31), gpt-6.1-sol(1) | Run live UI test sequence |
| S80 | 2026-10-11T02:53 | 01a128e1-4201-7353-8c80-f576afb284c0 | $TMP/tmp.PpZgr8dDGk | 0/1 | claude-sonnet-5-5(4) | Run write and todo tool calls |
| S81 | 2026-10-11T02:54 | 01a128e2-597e-72d6-9180-c6ebe180af9a | $TMP/tmp.lhvT1wu1sE | 0/1 | claude-sonnet-5-5(5) | Run five tools and print results |
| S82 | 2026-10-11T03:39 | 01a1290a-eaa2-726f-8035-1692d8d80807 | $TMP/tmp.lakPdid4Pl | 0/1 | gpt-6.1-sol(5) | Read a.txt and b.txt. Then make ONE edit tool call with an apply_patch |
| S83 | 2026-10-11T03:39 | 01a1290a-eab0-717b-bd12-dae204654eaa | $TMP/tmp.fzWqBlJi09 | 0/1 | claude-sonnet-5-5(4) | Read a.txt and b.txt. Then make ONE single edit tool call using its ed |
| S84 | 2026-10-11T03:40 | 01a1290c-4bff-7792-b9a9-4a72674d78f7 | $TMP/tmp.nsCJWst7FX | 0/1 | gpt-6.1-sol(4) | Read a.txt and b.txt. Then make ONE edit tool call with an apply_patch |
| S85 | 2026-10-11T04:32 | 01a1293b-ff16-7084-9ffe-eb2610b0d49f | $TMP/tmp.Zgq4f1WNeM | 0/1 | claude-sonnet-5-5(6) | Make these bash tool calls one after another and print each tool resul |
| S86 | 2026-10-11T06:34 | 01a129ab-d1c9-7185-a1da-f78c0db7959f | $TMP/tmp.zZgfPolAa2 | 0/1 | claude-sonnet-5-5(3) | Call the todo tool exactly once with this ops array, then reply with t |
| S87 | 2026-10-11T06:53 | 01a129bd-32f9-7367-93ad-2208c2cc9bcc | $TMP/tmp.SzmWvOLt5l | 0/1 | claude-sonnet-5-5(3) | Call the todo tool once with ops [{"op":"init","list":[{"phase":"P","i |
| S88 | 2026-10-11T08:28 | 01a12a13-79a3-7644-a46a-564be6d6b9bb | $TMP/tmp.1Qcp6KGyTU | 0/1 | claude-sonnet-5-5(2) | Call the lcm_grep tool once with query "hello", mode "regex", scope "m |
| S89 | 2026-10-11T09:32 | 01a12a4e-6e22-77d5-b47d-ba7a2c654284 | /tmp | 1/0 | claude-sonnet-5-5(4) | Рекомендации по использованию модели Fable 5.1 |
| S90 | 2026-10-11T10:40 | 01a12a8c-d7d2-75ec-ba51-96712800caae | ~/Documents/ChatGPT/my-omp-harness-worktrees/prompt-split | 0/1 | claude-sonnet-5-5(3) | Запусти субагента на Haiku 5.5 с reasoning low, назови его CustomCheck |
| S91 | 2026-10-11T10:43 | 01a12a8f-7368-76aa-9bc7-441de129f9df | ~/Documents/ChatGPT/my-omp-harness-worktrees/prompt-split | 0/1 | claude-sonnet-5-5(3) | Запусти субагента на Haiku 5.5 с reasoning low, назови его HaikuCheck, |
| S92 | 2026-10-11T10:49 | 01a12a94-ccdf-70fe-b102-9ebae1de82e6 | ~/Documents/ChatGPT/my-omp-harness-worktrees/prompt-split | 0/1 | claude-sonnet-5-5(3) | Запусти субагента на Haiku 5.5 с reasoning low, назови его HaikuCheck3 |
| S93 | 2026-10-11T12:49 | 01a12b02-fb27-7305-bb31-8d27a52e39c8 | /tmp | 1/0 | claude-opus-5-5(1), claude-sonnet-5-5(1) | Найти запись экрана на Mac |
| S94 | 2026-10-12T01:14 | 01a12dac-d72e-72c7-b4aa-2ef5f60e4fbc | /tmp | 1/0 | claude-sonnet-5-5(5) | Перенос скиллов из codex в omp |
| S95 | 2026-10-12T01:15 | 01a12dad-9b27-74e5-b6bb-9828c33b441b | /tmp | 5/0 | claude-sonnet-5-5(25), claude-opus-5-5(6) | Перенести глобальные скиллы Codex в omp |
| S96 | 2026-10-12T02:13 | 01a12de3-016e-7655-b92c-7b58e42f3e6a | /tmp | 2/0 | claude-sonnet-5-5(63) | Fix fable-to-sunet session startup switch |
| S97 | 2026-10-12T03:16 | 01a12e1c-2e5b-74eb-8f53-066414a155c3 | ~/PycharmProjects/superbot | 69/0 | gpt-6.1-sol(1097), claude-opus-5-5(214) | Добавить зачистку мусора на РПС |
| S98 | 2026-10-13T01:44 | 01a132ee-f519-77ba-8ff3-c39625f3ff11 | ~/ai-project/soniox-pilot | 20/0 | gpt-6.1-sol(160), claude-sonnet-5-5(32) | Сравнить точность транскриптов Scribe и сервиса |
| S99 | 2026-10-13T16:35 | 01a1361e-b825-7408-aee4-e743919e1be4 | /tmp | 6/0 | claude-sonnet-5-5(8) | Explain separate weekly limit for Fable |
| S100 | 2026-10-13T19:23 | 01a136b8-19b3-7463-87c6-2a6df5e73ecb | /tmp | 4/0 | claude-opus-5-5(13) | Replace tabs with vertical workspace sidebar |
| S101 | 2026-10-13T20:12 | 01a136e5-5085-753a-9138-df8bf5a12136 | /tmp | 1/0 | claude-sonnet-5-5(4) | Сбросить доступ Smooks к файлам macOS |
| S102 | 2026-10-14T07:26 | 01a1394e-6c52-7016-8762-3e3290e91df4 | ~/Documents/ChatGPT/my-codex-harness | 15/0 | claude-sonnet-5-5(121), claude-opus-5-5(13) | Создать токен и скилл для публикации |
| S103 | 2026-10-14T11:47 | 01a13a3d-5e3b-741b-987f-4736e3c50857 | /tmp | 2/0 | claude-sonnet-5-5(2) | Исправить полосы по бокам в Windows App |
| S104 | 2026-10-14T12:32 | 01a13a66-a744-754d-949d-ba7bb6ce0e2d | ~/Documents/ChatGPT/my-codex-harness | 6/0 | claude-sonnet-5-5(27) | Объяснить голосовой разговор с моделью |
| S105 | 2026-10-14T17:29 | 01a13b76-5505-701e-82d6-975abc8f1ccd | ~/ai-project/cursor-like-harness | 2/0 | claude-opus-5-5(89) | Исследовать реверс-инжиниринг Cursor для harness |
| S106 | 2026-10-14T19:30 | 01a13be5-6988-7668-85e1-b00538ee02a1 | ~/Documents/ChatGPT/my-codex-harness | 10/0 | claude-sonnet-5-5(217), claude-opus-5-5(60) | Запушить и выпустить релиз |
| S107 | 2026-10-14T19:42 | 01a13bef-b28f-77b3-9cfc-8c5c74ccd351 | ~/Documents/ChatGPT/my-codex-harness | 0/0 | claude-opus-5-5(18) | Переделать my codex harness по образцу omp harness |
| S108 | 2026-10-14T19:43 | 01a13bf0-8d8a-751f-8240-2c7649b9b1cb | ~/Documents/ChatGPT/my-codex-harness | 0/0 | claude-opus-5-5(18) | Переделать my codex harness по образцу omp harness |
| S109 | 2026-10-15T04:53 | 01a13de8-ec6a-7388-9ca7-15cb2541d8c7 | /tmp | 2/0 | claude-sonnet-5-5(18) | Сравнить бенчмарки reasoning Opus и Sonnet |
| S110 | 2026-10-15T15:07 | 01a1401a-f4ce-7561-85a0-55ce7dcde583 | /tmp | 0/1 | claude-sonnet-5-5(1) | cd |
| S111 | 2026-10-15T15:07 | 01a1401b-12e5-739c-a2cc-10faba87fb90 | /tmp | 12/0 | claude-sonnet-5-5(52) | Подсчитать подходящие под фильтр чаты |
| S112 | 2026-10-15T16:56 | 01a1407e-1043-76b0-bbd5-cd1bc529a210 | /tmp | 5/0 | claude-sonnet-5-5(6), gpt-6.1-sol(6) | Оцени идею автоматической фоновой памяти |
| S113 | 2026-10-15T22:14 | 01a141a1-5efa-74c0-bae4-7044e364c660 | ~/Documents/ChatGPT/my-codex-harness | 49/0 | claude-sonnet-5-5(410), gpt-6.1-sol(130) | Research branch prompt and plan solution |
| S114 | 2026-10-16T12:04 | 01a14499-9537-7542-bca4-386f08e2e48e | /tmp | 4/0 | gpt-6.1-sol(27) | Исследуй Superbot Compose и Application Support |
| S115 | 2026-10-16T20:10 | 01a14656-542d-7348-9902-e9b1e049b104 | ~/Documents/ChatGPT/my-codex-harness | 11/0 | gpt-6.1-sol(138), claude-opus-5-5(82) | Заверши релиз с commit и push |
| S116 | 2026-10-17T04:07 | 01a1480b-5209-7604-8aae-53f81c7763e4 | ~/PycharmProjects/superbot | 7/0 | gpt-6.1-sol(116) | Перенастрой инструменты Sentry на токен |
| S117 | 2026-10-17T04:45 | 01a1482e-1571-7540-bc04-3add21c9be7c | ~/ai-project/cursor-pi | 2/0 | claude-opus-5-5(55) | Build Cursor Pi clone from Pi |
| S118 | 2026-10-17T05:03 | 01a1483e-92b7-77de-8147-cf67da7282d2 | /tmp | 3/0 | claude-sonnet-5-5(61) | Найти надёжный оранжевый iPhone 17 Pro Max |

Full JSONL paths of sessions cited in this note:

- S0: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-04T10-39-04-810Z_01a1067e-f06a-771e-be3c-0c524a3ff914.jsonl
- S1: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-04T10-50-15-742Z_01a10689-2d3e-767d-8372-84a29dba4a5c.jsonl
- S3: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-04T11-27-19-146Z_01a106ab-1a6a-7380-8ff5-e18bde5aacbf.jsonl
- S4: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-04T17-26-24-121Z_01a107f3-da79-75a2-be66-fb1898311c80.jsonl
- S5: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-04T17-29-09-910Z_01a107f6-6216-74c2-8f4c-96247e85277e.jsonl
- S6: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-04T17-46-35-370Z_01a10806-55ea-77ff-9d34-78b2d09f7033.jsonl
- S7: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-04T18-22-26-660Z_01a10827-2964-7713-ac46-9a6ac8d324ab.jsonl
- S8: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T06-13-19-313Z_01a10ab1-fd51-713b-bf56-9caa0bc4f3a9.jsonl
- S9: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-05T09-04-05-742Z_01a10b4e-566e-7781-a6a9-b9529b4be1d5.jsonl
- S10: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T10-22-35-449Z_01a10b96-33b9-7485-8b87-c81e451d3bc1.jsonl
- S11: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-05T10-23-42-750Z_01a10b97-3a9e-7515-86a0-45e585de88b2.jsonl
- S13: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-05T10-26-17-939Z_01a10b99-98d3-74ea-a467-fdf20a5e83a3.jsonl
- S19: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-05T12-41-32-614Z_01a10c15-6ac6-71e4-a4d0-529793279af9.jsonl
- S25: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-05T16-53-17-849Z_01a10cfb-e799-73ba-a1a4-d2e4a8a1a707.jsonl
- S26: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T19-37-02-921Z_01a10d91-d2c9-7078-8506-6ef7a3d5a84c.jsonl
- S28: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T21-02-08-951Z_01a10ddf-bc37-7087-b0a2-97b00a8916d9.jsonl
- S29: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T21-36-45-754Z_01a10dff-6cba-771f-94a4-3aa015b950d5.jsonl
- S30: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-06T10-31-04-295Z_01a110c4-5367-772f-803f-c3a1a3cfa86b.jsonl
- S34: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-06T17-07-46-364Z_01a1122f-843c-7551-ae7d-09788762a3c2.jsonl
- S36: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-06T17-54-14-684Z_01a1125a-101c-7520-ac12-250cd2a5eec6.jsonl
- S37: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-06T18-00-17-791Z_01a1125f-9a7f-7012-abbd-1199d6893ccd.jsonl
- S38: /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot/2026-10-06T21-49-29-016Z_01a11331-6e38-73e4-a20e-47a1e152745d.jsonl
- S39: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-06T22-04-08-456Z_01a1133e-d988-75c6-9fef-d92cad8d3ae8.jsonl
- S42: /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot/2026-10-07T04-07-39-659Z_01a1148b-a98b-7389-9821-5adc316e815b.jsonl
- S43: /Users/arkadijcukavin/.omp/agent/sessions/-tmp-scope-focus-tospec-W8jRdF/2026-10-07T04-10-23-493Z_01a1148e-2985-73f5-aca3-697183ae3135.jsonl
- S46: /Users/arkadijcukavin/.omp/agent/sessions/-tmp-scope-focus-tospec-BXSI4l-exp/2026-10-07T10-18-15-601Z_01a115de-f4b1-778b-87c7-48611d53005e.jsonl
- S47: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-07T16-54-27-197Z_01a11749-ae7d-73c3-b003-3646ee6f4fb8.jsonl
- S48: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-07T16-59-11-971Z_01a1174e-06e3-7486-86e2-ed1b5b364165.jsonl
- S49: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-07T18-23-36-882Z_01a1179b-4fb2-70f3-a91b-b8d3ab60bd59.jsonl
- S50: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp-strrep--/2026-10-07T18-23-48-082Z_01a1179b-7b72-7114-b36f-e60d29580550.jsonl
- S52: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-07T20-41-48-091Z_01a11819-d33b-77b1-bdc6-9c936954bdda.jsonl
- S54: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-07T23-41-20-966Z_01a118be-34c6-744a-b293-ba05ee171edd.jsonl
- S56: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-08T14-23-27-533Z_01a11be5-cd2d-73f8-a3a5-6ee27c7f2d66.jsonl
- S58: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-09T04-39-09-926Z_01a11ef5-3965-70d0-8286-6df5d524a357.jsonl
- S59: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-09T06-26-18-422Z_01a11f57-50b6-7042-9bc8-745d0f4b32ed.jsonl
- S64: /Users/arkadijcukavin/.omp/agent/sessions/-tmp-tmp.MOH0wXI9oA/2026-10-09T20-50-24-205Z_01a1226e-6b4d-7301-9c84-edaf45ed27f5.jsonl
- S70: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-09T23-23-57-902Z_01a122fb-024e-7191-a048-6ddac19155de.jsonl
- S71: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-10T01-06-25-326Z_01a12358-cfae-74cb-b90d-92f8ce39deda.jsonl
- S72: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-10T01-07-06-613Z_01a12359-70f5-7736-be5e-d8b6f8da774d.jsonl
- S73: /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot/2026-10-10T02-23-48-347Z_01a1239f-a87b-7544-9345-97987c501e56.jsonl
- S75: /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot/2026-10-10T03-01-13-611Z_01a123c1-eb0b-7271-96aa-77fedec1a168.jsonl
- S76: /Users/arkadijcukavin/.omp/agent/sessions/-ai-project-gpt-read-aloud/2026-10-10T19-05-59-366Z_01a12735-2f46-779a-94b2-d88d1cd473ff.jsonl
- S77: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-11T01-20-32-934Z_01a1288c-1aa6-74cc-bb2b-c820dc07c985.jsonl
- S78: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-11T02-14-34-972Z_01a128bd-92dc-7161-81b1-b2b76996bd2e.jsonl
- S79: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness-worktrees-cursor-ui/2026-10-11T02-47-21-927Z_01a128db-9647-77c0-9aef-5ddfa568cb6b.jsonl
- S88: /Users/arkadijcukavin/.omp/agent/sessions/-tmp-tmp.1Qcp6KGyTU/2026-10-11T08-28-01-827Z_01a12a13-79a3-7644-a46a-564be6d6b9bb.jsonl
- S90: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness-worktrees-prompt-split/2026-10-11T10-40-35-794Z_01a12a8c-d7d2-75ec-ba51-96712800caae.jsonl
- S92: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness-worktrees-prompt-split/2026-10-11T10-49-17-279Z_01a12a94-ccdf-70fe-b102-9ebae1de82e6.jsonl
- S97: /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot/2026-10-12T03-16-01-243Z_01a12e1c-2e5b-74eb-8f53-066414a155c3.jsonl
- S98: /Users/arkadijcukavin/.omp/agent/sessions/-ai-project-soniox-pilot/2026-10-13T01-44-43-545Z_01a132ee-f519-77ba-8ff3-c39625f3ff11.jsonl
- S99: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-13T16-35-45-317Z_01a1361e-b825-7408-aee4-e743919e1be4.jsonl
- S102: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-14T07-26-43-282Z_01a1394e-6c52-7016-8762-3e3290e91df4.jsonl
- S105: /Users/arkadijcukavin/.omp/agent/sessions/-ai-project-cursor-like-harness/2026-10-14T17-29-33-189Z_01a13b76-5505-701e-82d6-975abc8f1ccd.jsonl
- S106: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-14T19-30-52-936Z_01a13be5-6988-7668-85e1-b00538ee02a1.jsonl
- S107: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-14T19-42-06-991Z_01a13bef-b28f-77b3-9cfc-8c5c74ccd351.jsonl
- S108: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-14T19-43-03-050Z_01a13bf0-8d8a-751f-8240-2c7649b9b1cb.jsonl
- S110: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-15T15-07-50-862Z_01a1401a-f4ce-7561-85a0-55ce7dcde583.jsonl
- S111: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-15T15-07-58-565Z_01a1401b-12e5-739c-a2cc-10faba87fb90.jsonl
- S112: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-15T16-56-05-956Z_01a1407e-1043-76b0-bbd5-cd1bc529a210.jsonl
- S113: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-15T22-14-17-082Z_01a141a1-5efa-74c0-bae4-7044e364c660.jsonl
- S114: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-16T12-04-38-327Z_01a14499-9537-7542-bca4-386f08e2e48e.jsonl
- S115: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-16T20-10-25-197Z_01a14656-542d-7348-9902-e9b1e049b104.jsonl
- S117: /Users/arkadijcukavin/.omp/agent/sessions/-ai-project-cursor-pi/2026-10-17T04-45-42-129Z_01a1482e-1571-7540-bc04-3add21c9be7c.jsonl
- S118: /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-17T05-03-42-775Z_01a1483e-92b7-77de-8147-cf67da7282d2.jsonl

Benchmark sessions cited (T:<id8> refs): 01a122cd-568b-75fe-8147-a0118460384d (steering L132): /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot-test-Gd9Ld3YH/2026-10-09T22-34-04-811Z_01a122cd-568b-75fe-8147-a0118460384d.jsonl ; 01a10665-e376-7314-8448-3605165cc8b2 (timing questions): /Users/arkadijcukavin/.omp/agent/sessions/-PycharmProjects-superbot-test-Gd9Ld3YH/2026-10-04T10-11-43-094Z_01a10665-e376-7314-8448-3605165cc8b2.jsonl. The other 149 benchmark sessions are listed in `local://omp-history-other.jsonl` (project superbot-test-Gd9Ld3YH).

## Appendix B. Cited references (record ids)

| ref | record id | role/type | timestamp (UTC) |
|---|---|---|---|
| S0:L48 | b62773d7 | user | 2026-10-04T10:44:51.919Z |
| S0:L88 | 9767764d | user | 2026-10-04T10:54:36.280Z |
| S0:L126 | 9d3ef9f1 | user | 2026-10-04T10:58:09.560Z |
| S0:L130 | e62c6330 | assistant | 2026-10-04T10:58:25.062Z |
| S3:L29 | c50efca4 | user | 2026-10-04T11:30:22.807Z |
| S3:L53 | 445f1090 | user | 2026-10-04T11:34:21.896Z |
| S4:L114 | ffe91b7e | assistant | 2026-10-04T18:06:22.200Z |
| S4:L115 | 5fe79676 | user | 2026-10-04T18:06:22.228Z |
| S4:L116 | 2bbeb1b6 | assistant | 2026-10-04T18:06:52.532Z |
| S4:L125 | ff906c0f | user | 2026-10-04T18:21:45.925Z |
| S4:L141 | d5a37d48 | user | 2026-10-04T18:29:54.039Z |
| S4:L222 | d1bca5d3 | user | 2026-10-04T19:47:22.863Z |
| S4:L274 | 3284b477 | user | 2026-10-04T20:16:00.288Z |
| S5:L132 | 601d6066 | user | 2026-10-04T18:18:22.798Z |
| S5:L928 | e05ade7f | user | 2026-10-05T00:57:55.519Z |
| S5:L932 | 1bea029b | user | 2026-10-05T00:58:14.625Z |
| S5:L936 | f05530a9 | user | 2026-10-05T01:00:09.338Z |
| S5:L1105 | ececd67a | user | 2026-10-05T01:24:46.334Z |
| S5:L1982 | f639193c | user | 2026-10-05T06:06:06.465Z |
| S5:L2163 | c4827224 | user | 2026-10-05T06:48:01.796Z |
| S5:L2191 | 66c9bc02 | user | 2026-10-05T06:58:52.338Z |
| S5:L2195 | c42c5d58 | assistant | 2026-10-05T07:00:38.380Z |
| S6:L72 | f7a8c0ea | user | 2026-10-04T18:13:46.303Z |
| S6:L472 | df2d533a | user | 2026-10-04T20:05:45.344Z |
| S6:L476 | c3bdd4da | user | 2026-10-04T20:06:00.708Z |
| S6:L478 | 1050b715 | assistant | 2026-10-04T20:06:10.059Z |
| S6:L1045 | be8349c1 | user | 2026-10-05T06:21:34.220Z |
| S6:L1046 | 25d4eb62 | assistant | 2026-10-05T06:22:09.533Z |
| S6:L1061 | 35f63290 | user | 2026-10-05T06:23:27.417Z |
| S6:L1103 | bbf5de80 | user | 2026-10-05T06:25:33.305Z |
| S6:L1168 | ae51acb9 | user | 2026-10-05T06:34:08.301Z |
| S6:L1259 | 08d18d38 | user | 2026-10-05T06:58:37.381Z |
| S8:L15 | a35ab79d | user | 2026-10-05T06:18:41.036Z |
| S8:L83 | 4b395e0d | user | 2026-10-05T06:27:19.705Z |
| S8:L156 | 329ad75a | user | 2026-10-05T06:51:19.900Z |
| S8:L162 | 18316533 | user | 2026-10-05T07:09:42.935Z |
| S8:L163 | ba98bd8c | assistant | 2026-10-05T07:10:04.701Z |
| S8:L164 | 1b717e4f | user | 2026-10-05T07:31:01.179Z |
| S8:L186 | 669f217e | user | 2026-10-05T08:05:40.243Z |
| S8:L212 | 4390438d | user | 2026-10-05T08:10:36.607Z |
| S8:L254 | 3fae7d69 | user | 2026-10-05T08:32:18.308Z |
| S8:L417 | f25f8f57 | toolResult | 2026-10-05T09:17:26.205Z |
| S8:L420 | db0387e9 | user | 2026-10-05T09:18:36.767Z |
| S8:L639 | 9d99e0b4 | user | 2026-10-05T09:47:53.107Z |
| S8:L657 | 9c40a162 | user | 2026-10-05T09:48:35.868Z |
| S8:L675 | b7ec30d9 | user | 2026-10-05T09:50:03.104Z |
| S8:L677 | ace30109 | assistant | 2026-10-05T09:50:13.891Z |
| S8:L679 | b060ead3 | user | 2026-10-05T09:51:19.419Z |
| S8:L714 | c1dc0325 | user | 2026-10-05T09:56:22.091Z |
| S8:L718 | e7fb00b8 | user | 2026-10-05T09:57:17.124Z |
| S9:L85 | 6c9ecab9 | user | 2026-10-05T09:44:29.504Z |
| S9:L125 | ab4d752b | user | 2026-10-05T09:55:46.224Z |
| S10:L194 | 9dfdc2ff | user | 2026-10-05T10:55:03.911Z |
| S10:L257 | 983bdb46 | user | 2026-10-05T11:05:31.699Z |
| S10:L258 | 41c003e1 | assistant | 2026-10-05T11:05:41.148Z |
| S10:L261 | b0916a1e | user | 2026-10-05T11:35:51.807Z |
| S11:L54 | a30753bb | user | 2026-10-05T10:44:51.382Z |
| S11:L56 | 6176b021 | assistant | 2026-10-05T10:44:58.223Z |
| S11:L70 | cd5d87b7 | user | 2026-10-05T10:47:53.455Z |
| S25:L31 | d29f81fd | user | 2026-10-05T16:54:49.440Z |
| S25:L158 | ac6e3543 | user | 2026-10-05T19:45:53.882Z |
| S28:L586 | feda5878 | user | 2026-10-05T21:54:17.405Z |
| S28:L607 | 2a545897 | user | 2026-10-05T22:30:45.923Z |
| S30:L116 | c8a0324a | user | 2026-10-06T10:49:03.185Z |
| S30:L167 | 37dad3f4 | user | 2026-10-06T12:15:36.004Z |
| S30:L199 | 59a82798 | user | 2026-10-06T13:05:28.779Z |
| S30:L458 | 8bfa00f9 | user | 2026-10-06T14:06:09.193Z |
| S37:L234 | e5d18876 | user | 2026-10-06T18:42:48.673Z |
| S38:L117 | 712a4114 | user | 2026-10-06T21:54:10.133Z |
| S38:L124 | 39b98f1f | assistant | 2026-10-06T21:54:29.859Z |
| S38:L125 | 2c86e9ac | user | 2026-10-06T21:54:44.778Z |
| S38:L127 | e186cf30 | user | 2026-10-06T21:55:01.005Z |
| S38:L588 | 1a2f6f4c | user | 2026-10-07T00:55:24.793Z |
| S38:L2349 | 3a6c435a | user | 2026-10-07T05:04:32.454Z |
| S38:L2358 | bcdeb19b | user | 2026-10-07T06:26:08.433Z |
| S38:L3032 | d9f8c531 | user | 2026-10-07T09:10:57.236Z |
| S38:L3058 | d217a980 | user | 2026-10-07T09:39:06.698Z |
| S38:L3221 | 5924404b | user | 2026-10-07T21:11:15.992Z |
| S38:L3606 | eff4cdba | user | 2026-10-07T23:57:35.604Z |
| S38:L3656 | 88e7936a | user | 2026-10-08T00:07:11.295Z |
| S38:L4216 | aa169499 | user | 2026-10-08T01:20:07.907Z |
| S42:L49 | d2dd9bf6 | user | 2026-10-07T04:09:42.575Z |
| S59:L193 | 058d4a13 | user | 2026-10-09T08:51:09.967Z |
| S59:L195 | 9ec2ce54 | user | 2026-10-09T16:47:55.158Z |
| S59:L1120 | 6cf5efb3 | user | 2026-10-09T23:25:25.725Z |
| S59:L1379 | 1d84b478 | user | 2026-10-10T00:49:11.793Z |
| S59:L1434 | 60c69c76 | user | 2026-10-10T00:54:54.421Z |
| S59:L1436 | 4df9af6a | assistant | 2026-10-10T00:55:01.933Z |
| S71:L337 | cce1aee0 | user | 2026-10-10T02:15:31.645Z |
| S71:L537 | 10ea05d8 | user | 2026-10-10T04:21:48.086Z |
| S71:L539 | e5744e79 | user | 2026-10-10T04:28:16.507Z |
| S71:L772 | e1b93a83 | user | 2026-10-10T05:47:55.145Z |
| S75:L1062 | e7a0f591 | user | 2026-10-10T03:50:32.724Z |
| S75:L1064 | cb9be5d2 | user | 2026-10-10T04:03:56.090Z |
| S75:L1083 | a0eb60be | user | 2026-10-10T04:05:46.664Z |
| S75:L1972 | c60e413f | user | 2026-10-10T18:31:15.984Z |
| S75:L2215 | d3d4bcfb | assistant | 2026-10-10T18:42:23.812Z |
| S75:L3520 | d23dd034 | assistant | 2026-10-10T21:28:56.228Z |
| S75:L5235 | 023a8f02 | user | 2026-10-11T01:22:04.141Z |
| S75:L6531 | 436e7ab1 | user | 2026-10-11T02:46:24.249Z |
| S75:L6532 | b028ccce | assistant | 2026-10-11T02:46:31.906Z |
| S75:L6556 | 3f733aa6 | user | 2026-10-11T04:59:26.514Z |
| S75:L7329 | 0916e5a2 | user | 2026-10-11T08:08:42.446Z |
| S75:L7393 | dad7fe07 | user | 2026-10-11T08:20:13.286Z |
| S75:L7591 | e5e73eee | user | 2026-10-11T09:00:33.126Z |
| S75:L8436 | 4b73b0b8 | assistant | 2026-10-11T11:17:44.352Z |
| S75:L9493 | 92787826 | assistant | 2026-10-11T15:18:42.304Z |
| S76:L830 | 51359ae8 | user | 2026-10-10T21:41:04.768Z |
| S76:L981 | c52074a8 | user | 2026-10-10T22:14:59.690Z |
| S76:L986 | e6a472bb | assistant | 2026-10-10T22:15:26.754Z |
| S76:L989 | 10b44934 | user | 2026-10-10T22:16:03.871Z |
| S76:L1146 | 88cc76b1 | assistant | 2026-10-10T22:33:06.111Z |
| S76:L1429 | b173f2af | user | 2026-10-10T23:05:46.875Z |
| S76:L1475 | 0d9869c6 | user | 2026-10-10T23:14:29.205Z |
| S76:L2007 | 8289613b | user | 2026-10-11T00:56:19.323Z |
| S77:L9 | c8aa1931 | user | 2026-10-11T01:21:15.829Z |
| S78:L116 | b61e7642 | user | 2026-10-11T02:29:08.385Z |
| S78:L127 | 533eed19 | assistant | 2026-10-11T02:30:17.555Z |
| S97:L98 | 8ab853a1 | user | 2026-10-12T03:38:29.881Z |
| S97:L179 | 4ee320a9 | user | 2026-10-12T04:12:25.673Z |
| S97:L4703 | b99832bd | user | 2026-10-13T16:33:07.387Z |
| S97:L5639 | bfb948dd | user | 2026-10-14T06:04:25.371Z |
| S97:L6732 | d2ad2116 | user | 2026-10-16T11:41:45.838Z |
| S97:L8112 | 958c621a | user | 2026-10-16T15:16:47.697Z |
| S98:L31 | cb045c02 | user | 2026-10-13T01:49:13.983Z |
| S98:L563 | 65710163 | user | 2026-10-13T04:18:02.150Z |
| S99:L26 | 3b562eca | user | 2026-10-13T16:40:01.359Z |
| S99:L28 | e8920430 | user | 2026-10-13T16:40:22.583Z |
| S102:L47 | 5b90169d | user | 2026-10-14T07:40:08.265Z |
| S102:L608 | 1ae0f00b | user | 2026-10-14T10:27:00.868Z |
| S102:L709 | 0dc3e46a | user | 2026-10-14T11:26:49.886Z |
| S105:L8 | 876c687d | user | 2026-10-14T17:32:58.930Z |
| S106:L323 | f7fbd9f0 | user | 2026-10-15T04:21:46.776Z |
| S106:L837 | f6f4992b | user | 2026-10-15T12:59:49.440Z |
| S106:L1138 | 4b308138 | user | 2026-10-15T21:26:59.304Z |
| S111:L5 | 660aa7bf | user | 2026-10-15T15:08:41.306Z |
| S111:L119 | de2e1899 | user | 2026-10-15T15:57:15.007Z |
| S111:L200 | aa0e4d7e | user | 2026-10-15T16:03:37.695Z |
| S112:L5 | 859d983a | user | 2026-10-15T19:37:46.360Z |
| S112:L31 | 57b60d38 | user | 2026-10-15T19:59:05.807Z |
| S112:L39 | c6c82871 | user | 2026-10-15T20:16:38.265Z |
| S113:L8 | ed91bda5 | user | 2026-10-15T22:14:52.725Z |
| S113:L52 | 58881dd4 | assistant | 2026-10-15T22:16:38.604Z |
| S113:L234 | 78d14cc6 | user | 2026-10-15T23:23:58.371Z |
| S113:L462 | 9be7da3e | user | 2026-10-16T00:05:13.515Z |
| S113:L641 | ac2566f5 | assistant | 2026-10-16T00:19:21.934Z |
| S113:L644 | 55b6229a | user | 2026-10-16T04:14:07.982Z |
| S113:L862 | a1158591 | user | 2026-10-16T04:45:12.247Z |
| S113:L1508 | a1203776 | user | 2026-10-16T06:44:15.527Z |
| S113:L1583 | 90d1feb4 | user | 2026-10-16T06:52:14.951Z |
| S113:L2006 | 35025d87 | user | 2026-10-16T09:08:00.927Z |
| S113:L2092 | 4cc2851a | user | 2026-10-16T09:15:08.844Z |
| S113:L2093 | e60438c1 | assistant | 2026-10-16T09:15:15.729Z |
| S113:L2117 | 0ce09ab6 | user | 2026-10-16T12:09:38.118Z |
| S113:L2203 | 47a772f2 | user | 2026-10-16T12:25:51.791Z |
| S113:L2205 | e07edbf7 | assistant | 2026-10-16T12:25:58.897Z |
| S113:L2207 | 41be498e | user | 2026-10-16T15:00:16.707Z |
| S113:L2284 | f545c829 | user | 2026-10-16T15:02:49.965Z |
| S113:L2546 | ca538e7d | user | 2026-10-16T17:40:11.532Z |
| S113:L2588 | daf46853 | user | 2026-10-16T17:43:08.151Z |
| S113:L2598 | aeebb924 | user | 2026-10-16T17:43:35.862Z |
| S113:L2816 | 96c86550 | user | 2026-10-16T18:28:45.849Z |
| S114:L48 | d7aa1851 | user | 2026-10-16T12:27:02.729Z |
| S114:L65 | 4f4e66c4 | user | 2026-10-16T12:27:56.217Z |
| S115:L6 | 8cce741a | user | 2026-10-16T20:10:57.490Z |
| S115:L10 | a6e671c4 | user | 2026-10-16T20:11:11.493Z |
| S115:L18 | bcc7ee4c | user | 2026-10-16T20:13:48.159Z |
| S115:L52 | 83b32602 | user | 2026-10-16T20:21:12.596Z |
| S115:L421 | 7af54436 | user | 2026-10-16T21:37:36.023Z |
| S115:L580 | 8a480cf2 | user | 2026-10-17T04:13:55.980Z |
| S115:L1021 | 95e2a984 | user | 2026-10-17T06:28:06.452Z |
| S117:L9 | 60e491fa | user | 2026-10-17T04:51:44.151Z |
| S118:L11 | 9fd0db08 | user | 2026-10-17T05:05:40.655Z |
| S118:L183 | a9d53037 | assistant | 2026-10-17T05:22:46.345Z |
| T:01a122cd:L132 | e6ccf177 | user | 2026-10-09T23:05:16.733Z |

