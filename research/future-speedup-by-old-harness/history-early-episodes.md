# History-early episodes: neighbouring actions behind the findings

Line numbers are 1-based JSONL lines in the session file named in local://history-early-coverage.md; times UTC. "A:" is the agent's visible text, "TOOL" a tool call, "CM" a harness `custom_message`. Owner text is quoted by Q id from local://history-early-quotes.md. Agent text is paraphrased, not quoted.

## E1. Plan scope check, first session (T2, T3)
`01a10c21` L235 (10-05T13:31, rec 1bc77c52, Q78). Before: plan-mode context, plan written and sent for review (L231-234). After: the agent diffed the plan against the source codex-harness plugin files (L237-244). Durable: the same demand reappears as the manifest rule.

## E2. HTML briefs removed, reports only on asked blocks (T10, T2)
`01a10c5a` L771 (10-06T09:34, rec ee3bc75f, S, Q74). Before: agent editing (L767). After: grep for html across skills/extensions (L772); compaction at L775. Language question at L179 (Q126) is the first appearance of the language preference.

## E3. Status ask ignored, then an explicit hold (T7, T4)
`01a110c6` L1067 (10-06T19:18:28, S, Q47). The agent's next records are nine `write` calls creating skills/tospec files (L1068+), no text. Same text typed into the concurrent session `01a11256` at 19:19:20 (L822) and again as a longer ask at 19:21:42 (L834, Q48). `01a110c6` L1186 (19:37:03, S, Q46): hold. L1187 A: states it stopped and lists done work; L1188 developer reminder "You stopped with 15 incomplete todo items" (harness); L1190 (19:41:50) «продолжай работу, пожалуйста»; L1192 A: continues, makes `code_writer` available and edits Gold Standard. In `01a11256` the hold arrived at 19:37:24 (L954); the agent stopped and, at L959, asked a design question ending `и я продолжаю?`; L960 (19:39:56) Q49 «продолжай работу над задачей» and it resumed (L961+).

## E4. Dropped earlier request, closing with an offer (T2, T6)
`01a11729` L110 (10-07T16:31 S) release request; L132 A final: release done, but states the previous request (Sonnet effort and labels) was not done and ends asking to continue; L133 (16:51:28, Q31); L134-139 the agent starts the missing work (rg in omp source). L239-L250: GitHub 500 on push; the agent proposes the owner retry later; Q50 (L240) → L241 a 120-try retry loop; L248 «ты мне скажи, локально все работает или что?»; Q51 (L250) → L255 diagnoses via gh api.

## E5. Extra change and verification overreach on small edits (T2, T9)
`01a1155d` L301-303: after a release the agent, asked whether finalization was complete, listed unverified items and, among known inaccuracies, that `lunatik_high` now equals `lunatik`; L304 (10-07T10:01, Q142) the owner reacts. L328 (10:04, Q141): he re-pastes the 16-item model matrix request and asks for a table of what was done; L329 A returns the table, all rows done; L330 «да все так а че ты сказал где какой проеь?»; L331 A: the one miss was an unrequested change of Composer on `lunatik_high` that «всё остальное оставь, как есть» forbade, fixed locally but not committed, and it ends by asking whether to fix the leftover names, run finalization and push. `01a1183f` L300 (Q132) rename of model labels: agent edited, reverted twice (L337, L344), then used `strings` on the omp binary (L337-350) and started a throwaway omp session (L353); L358 (10-07T21:40:58, S, Q32); L359 cat settings, L362 pkill + rm -rf /tmp/omp-ui.

## E6. Irreversible cleanup by skill step (T5, T3)
`01a11410` L1746 (10-07T09:22, Q66). L1743 A final reported the work and Smarty/Bossy; L1751 A: deleted `scope-focus-tospec-h19D8N` with `rm -r` because ToSpec step 06 says to; earlier work folder already gone; text partly recoverable only from the conversation, verbatim approved version cannot be guaranteed.

## E7. Push only own edits (T2, T6)
`01a11b33` L99 (S «и сделай пуш потом») and L263 (Q99 context). L264-270 TOOL: todo init limited to communication files; commit of communication rules only. L281 A: pushed `690bf31`; mentions other uncommitted edits left untouched because the release rule allows only the task's own edits. L282 (10-08T12:29:05) «я же сказал запушить надо все правки»; L283 todo + goal create "all uncommitted edits tested, gate, committed".

## E8. Communication format flip-flop (T10)
`01a11b33` L140 (10-08T11:17) three paragraphs; L177 A proposes the rule goes into clear-communication; L178 (11:39, Q70) conclusion at the end; L179 A agrees, writes it into its own reply in that shape; L180 (Q) discuss first and apply to ToSpec; L205 only in ToSpec. `01a12842` L7 (10-11T00:02, Q69); L30 A offers three options; L31 (00:09, Q68) retraction «это был обман»; L35 A lists seven requirements and asks acceptance through `ask`; L41 aborted.

## E9. Review loop, then redesign (T9)
`01a11bba` L5420 (10-09T18:46, Q13). L5422 A: diagnoses three causes (contract wording, fresh reviewer per round, own over-broad briefs) and proposes a full pass; L5425-5426 background reviewers still finishing; L5430 (18:48, S) stop everything; L5509 (Q147) concept; L5517 (18:50:32, S, Q18) analysis only: L5518 todo init "Анализ ревью (без правок)" and a read-only history task; L5525 (Q) one independent blind reviewer, whole-work each round; L5566 A suggests narrow briefs and drop nits; L5567 (Q) the point of the blind loop is that different passes catch different things; L5568-5570 A realises the word "surface" had been read as skim, proposes removing it; L5569 (Q15) his meaning of «поверхностный»; L5571 (Q16) split big work, 100-200k tokens, document the concept as a manifest; L5577 goal create; L5656 (Q17) manifest in English, immutable.

## E10. Review loop after the redesign: Main accepts everything (T9, T2)
`01a122a9` L45 (10-09T21:56, Q154) points at `01a11bba`; L46-L98 the agent reads that JSONL with JS. L98 A: 81 passes and 116 findings before the redesign, about five rejections; the plan passed 15 reviews, RequirementsReview 9 (8-28 minutes each), StatusReview 8; Main accepted nits (quote spelling, line numbers) and changed approved decisions (harness.ts, AGENTS.md MCP exception, a SYSTEM.md sentence, D-002, AC-005); it proposes three outcomes: fix, reject, ask owner. L99 (22:21:23, Q22) no third outcome. L101-L103 team and code-review analogy (Q23, Q24). L455 (23:25:43, S, Q29) the agent had started a `task` while planning was unfinished; L456 TOOL goal drop, todo drop; L473 return to planning. L538/L540/L542 (Q25, Q26, Q27) quotes as armour, vague requests refused, size classes. L546 (Q28) plan phase removed. L838 (10-10T00:03): release done but no push; L941 (Q96): ambiguous «только два без дрочи»; L942 the agent launched a finalization gate task.

## E11. Edge-case question about the gate (T5)
`01a11f9c` L317-325 (10-09T08:56-58): the agent explained a goal rule (stop and ask after three non-CLEAN checks; five had happened), described the `OMP: Run` window-vs-tab edge case, asked `Устраивает?`. L321 (Q35) «а решение-то я какое должен принять?»; L322 A gives two options and recommends one; L325 (Q36) he decides in one line.

## E12. Chat-scoped instruction turned into rule edits (T12)
`01a11f9c` L745 (10-09T10:06, S, Q37) «В следующий раз каждый раз, когда что-то меняешь...»; L756 A edits `AGENTS.md` and `.agents/skills/finalize-work/SKILL.md` (smarty -> bossy); L772 (10:08:23, S, Q34); L773 the agent reverts both files. L860 (10:41, S, Q38) lighter reviewer for this chat because of time.

## E13. Cost ceiling invented by the agent (T5)
`01a12323` L1638 (10-10T08:26, Q120) fewer runs; L1639 A proposes 8 tasks x 3 agents = 24 calls per iteration, about $1.5 each; L1640 up to 200 iterations; L1641 A states success thresholds and asks to confirm a $300 ceiling; L1642 (Q83) parallel subagents hang; L1643-1645 A drafts the goal; L1647 (08:31:23, Q44) limit is iterations.

## E14. Question answered with tool calls (T4)
`01a1171c` L9965 (10-11T08:16:53, Q57): preceding record L9961 aborted; L9966 A text answer (`find` duplicates `glob`, propose removal); L9969 harness `session-stop-continuation`; L9970 todo block "waits for owner's answer"; L9981 «да убираем». `01a1171c` L10697 `ask` tool call, L10700 aborted; L10701 (Q58) discuss in text; L10706 A text proposal; L10707 (Q85) decision.

## E15. Goal and todo behaviour (T13, T6)
`01a1171c` L9596 (Q55): A explains it stopped deliberately on a blocked item; hidden continuations were answered without tool calls per rule. `01a12842` L3716-3722: background job HerdrLook (code_writer) finished; L3717 A final says edits are uncompiled and will be built `Когда ты возобновишь цель`; L3721 harness goal-mode-context; L3722 (10-11T04:35:35) «Продолжай работу»; L3723 todo unblock + build task. L3822 (Q67) crash; L3875 «продолжай» (model switched to Sol; L3876 A admits the inherited server address). L6625 (Q97): L6627 A says it records stages in advance and marks the current one when moving; the marks had lagged in this task, fixes by blocking the dependent item.

## E16. After a long run (T6, T13)
`01a12842` L8815 goal complete; L8820 A final (release `857d60c`); L8823 «Так че дальше*»; L8825 (Q140) «ты задачу закончила или нет?» (Sol main); L8832 (S, Q106) screenshots: todo panel residue and image-preview placement; L8835 «да»; L8837+ the agent reads panel.ts; L8847 compaction; L8849 «продолжай» -> L8850 todo init, worktree creation.

## E17. Continuations by cause (T6, T7)
Bare «продолжай» (43 short ones): examples. Abort, no new instruction: `01a110c6` L3392/L3395/L3439/L3494/L3799/L3802 (assistant `aborted` each time; `session_exit` records at L3394, L3438, L3493, L3801); after model switches: `01a115ec` L385/L388/L391/L393/L455 (model changes at L382-383, L389, L451-453); `01a123de` L7, `01a12323` L1398; after compaction: `01a11b33` L563 compaction, L564 «продолжай», L565 «что происходит?», L566-573 model/thinking changes, L574 «продолжай», L581 aborted assistant text "Спека v2 принята. Записываю это и перехожу к плану."; after an agent stop: `01a1226a` L290, `01a12842` L3722; after toolUse stalls: `01a11410` L1283, L1601 (S). Compaction is `snapcompact`: history archived as image frames plus text; the goal context carries owner quotes verbatim (e.g. `01a12842` L3721).

## E18. Synthetic prompts (not evidence)
Pairs of sessions started within the same second (for example `01a12732-f9eb...` x2 at 10-10T19:03:34.635Z): one asks whether the system prompt contains two exact phrases and runs an `InstallCheck` task, the other creates `ReuseCheck#1/#2` markers. Smoke sequences "Do these steps without asking: read package.json; ..." (`01a1244b`, `01a12479`, `01a12482`). Others test `diagram`, `grep` availability, an elk bundle read. They carry no owner workflow statements and confirm only that the owner installs and checks prompt composition with scripted prompts.
