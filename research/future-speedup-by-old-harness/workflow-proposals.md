# Workflow proposals for the GPT-5.5-based SYSTEM.md

Research result, not implementation. The project working tree is unchanged. Proposed runtime text is English; source quotations remain verbatim Russian/English. No prompt performance test, benchmark or new code check was run or is claimed.

## Result and recommendation

Keep the GPT-5.5-derived base. Transfer three focused mechanisms from native GPT-6.1 Sol by replacing existing paragraphs in SYSTEM.md: an explicit bounded task-completion contract, new-message steering that retains the active task, and state preservation through compaction/interruption/handoff. Update the adjacent final-response sanity check to match the steering paragraph. Do not append a second large autonomy, testing, search or memory procedure.

These are wording hypotheses supported by the owner's statements and relevant failure episodes, not measured improvements. Much of Sol's useful workflow is already enforced for Main by the Gold Standard and other skills. The residual gap is in the shared base text: its final main_goal is per-message instruction following, and its continuity paragraphs do not explicitly name the cumulative task state. Replacing those existing clauses gives the base a coherent task anchor without copying the execution procedure. Some high-level overlap with the Gold Standard is deliberate: the base also reaches subagents that do not receive Main's procedural skills. Do not duplicate Main's concrete tool, goal, approval or review mechanics.

## 1. Source identity and scope

The native donor was initially read at /Users/arkadijcukavin/ai-project/cursor-pi/research/cursor/reverse/codex-prompts/gpt-6.1-sol.md. Its sibling README documented extraction from OpenAI Codex commit 6ae8b8aa7c608730d4315d59c5c081897ae02780, slug gpt-6.1-sol, field model_messages.instructions_template. That neighbouring project changed while this research was running and the extracted file is no longer at that path. The authoritative source remains readable: /Users/arkadijcukavin/Documents/ChatGPT/codex-harness/codex-rs/models-manager/models.json, gpt-6.1-sol entry at line 178. Main freshly parsed that catalog after the path disappeared, selected the same template and confirmed exact string equality with the previously read extracted original (21,779 UTF-8 bytes). An exact readable copy from the current catalog, without any text edits, is saved at local://gpt-6.1-sol-original.md. This is source extraction, not reconstruction from memory. The generic identity 'based on GPT-6' is in that primary catalog text.

Important distinction: this is the native Codex GPT-6.1 Sol prompt originally found in the Cursor reverse-engineering materials; that secondary source file is now unavailable, so the current donor is the exact matching template from the readable codex-harness models.json catalog, also extracted to local://gpt-6.1-sol-original.md. It is not evidence of a captured Cursor-specific GPT-6.1 prompt. The previously inspected Cursor Sol system-prompt-15499.md was GPT-5.6; remaster/prompts/gpt-6.1-sol.md was an OMP GPT-5.5-based adaptation with a changed identity line, and RC/RC2 were further adaptations. None is substituted for the native donor.

Current target read: /Users/arkadijcukavin/Documents/ChatGPT/my-omp-harness/SYSTEM.md. Direct dependencies checked for coverage: WORKFLOW-MANIFEST.md, gold-standard, main-workflow, subagents, clear-communication and omp-tools. No unrelated repository consistency audit was performed.

Detailed donor map: local://sol-workflow-analysis.md.

## 2. History coverage and interpretation

All 405 nonempty local OMP sessions across 24 project entries were researched in three disjoint partitions on anthropic/claude-sonnet-5-5 with effort=xhigh, after the Sol analysis. All 2426 user-role records were examined; source records include synthetic probes, copied material, duplicates and forks and must not be called 2426 independent preferences. The 12 remaining top-level session files contain no user messages, as independently checked by Main. Sources range from 2026-10-04 through the current 2026-10-17 snapshot. Full inventory and limits: local://omp-workflow-coverage.md.

Evidence notes:
- local://history-early-findings.md, with local://history-early-quotes.md, local://history-early-episodes.md and local://history-early-coverage.md.
- local://history-late-findings.md.
- local://history-other-findings.md.

The researchers read raw owner messages, searched across all assigned files with multiple formulations, and examined neighbouring agent/tool actions for relevant episodes. Injected goal reminders, model probes and copied prompt documents were not counted as independent owner preferences. Contrary and later-changing requirements are retained. Main directly checked selected decisive quotations and neighbouring records against the JSONL, not every researcher finding again.

### Durable preferences and actual failure mechanisms

A. Speed means the fastest path to the requested result, not starving the agent of information or minimizing useful parallel reads. Owner: 'а минимальное количество действий — это, блядь, не про общую работу, а именно про конечный результат. что мы не пишем дохуя кода ненужного, а мы пишем только минимально необходимый код.' Source: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-05T06-13-19-313Z_01a10ab1-fd51-713b-bf56-9caa0bc4f3a9.jsonl:162, record 18316533. The same message explains that unsolicited tests, a test rig, fixtures and benchmarks motivated the Gold Standard. Later he narrows default gathering to minimum necessary information, deepening at a contested point or on direct order (history-early quotes Q01-Q07, Q89). These are compatible: wide/parallel gathering can be shallow and decision-scoped. Existing Gold Standard/omp-tools already encode this; no new search ritual is proposed.

B. Ordered work was dropped while another result was reported complete. In /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-07T16-19-08-966Z_01a11729-5c26-7524-a98d-2fed8cd3c58f.jsonl:132, the agent's final said 'Предыдущий запрос я не выполнил' and ended 'Скажи, если нужно продолжить.' At line 133, record 72fa1df4, the owner objected: 'так ты долбоеб, а с хуя ли ты не сделал запрос предыдущий про effort на sonnet и про смену лучей'. This is an actual unfinished-request episode, not an inference from a bare 'continue'. It supports P1 and P2.

C. The active target and source findings drifted. Owner: 'Давай ты сейчас полностью прочитаешь историю текущей сессии, все мои сообщения, отправленные мною, и все сообщения, которые ты мне в ответ написал. И залайним всё это дело на основную core-цель.' Source: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-12T15-30-39-654Z_01a130bc-c3a6-7101-b570-e995b9c08136.jsonl:4516, record cbf96386. Earlier at lines 2415 and 2419 he challenged the agent's guesses against its own prior research and asked to recover the actual source research. These messages prove the drift complaint and required repair; they do not independently prove every disputed technical fact about Cursor. The temporal association with compaction is not proof that compaction alone caused it. Supports P2 and P3.

D. The desired memory is the latest cumulative agreement, not every old instruction forever. Owner: 'И агент должен помнить про конечное кумулятивное решение. А оно должно быть обосновано.' Source: /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-13T05-25-23-731Z_01a133b8-fc93-71e4-bac8-8f3869437458.jsonl:1683, record c9f2ec86. The full message gives a sequence of changed choices that return to an earlier design with a later workflow constraint. At line 2011 he says 'Только мои слова меняют decision, а не агента', while permitting a change he approves. Supports preserving latest accepted decisions, their reasons and cancellations; not preserving superseded decisions as active requirements.

E. The owner rejects extra manual memory work. At /Users/arkadijcukavin/.omp/agent/sessions/--private-tmp--/2026-10-15T16-56-05-956Z_01a1407e-1043-76b0-bbd5-cd1bc529a210.jsonl:39, record c6c82871: 'Все их предложения сводятся к тому, что агент сам должен записывать и сам должен вспоминать. И он тратит на это ходы, токены.' He wants automatic cumulative context, not an agent-maintained notebook ritual. P3 therefore says use available state and recover only missing material information. It does not create files, a registry, a new tool or a per-turn restoration routine. Existing task-state mechanics stay in their current skills.

F. Continuation pings need causal care. Many bare 'продолжай' messages follow user interrupts, model switches, errors or restarts, not spontaneous model abandonment. Early and late notes preserve the neighbouring abort/exit records. In the other-project partition, a scan found 30 of 63 short continue/status pings after owner aborts and 4 after API errors. This is contextual evidence, not a performance estimate. P1 does not claim a prompt can repair environment failures, only that an interruption or failed approach is not task completion.

G. Questions and discussion must not become edits. In /Users/arkadijcukavin/.omp/agent/sessions/-Documents-ChatGPT-my-codex-harness/2026-10-04T10-39-04-810Z_01a1067e-f06a-771e-be3c-0c524a3ff914.jsonl:126, record 9d3ef9f1, the owner says: 'вообще я тебе не говорил с ними ничего делать. ты не должен был сейчас никак менять вообще ничего. мы это пока только обсуждали'. Main checked that exact record directly. Further episodes are catalogued in early T4 and late T3. No new default-to-edit-on-any-defect rule is proposed: the active authorized deliverable may be an answer, review, plan or change. Persistence cannot broaden that authorization.

## 3. Exact proposed replacements

These are adaptations of donor mechanisms, not claimed verbatim transplants. No other SYSTEM.md wording is proposed to change.

### P1. Replace the entire single sentence inside <main_goal>

Current:
> Your main goal is to follow the USER's instructions at each message.

Proposed:

Carry the active, authorized task through to its requested result, satisfying every agreed requirement and adding nothing outside its scope. Do not stop at a plan, progress report or partial result when execution is still required and an authorized path remains. Completion means the requested result and already-required checks are done. If progress genuinely depends on required input or an external event, state the concrete blocker and wait without claiming completion.

Origin: Sol identity 'until their intended goal is completely handled'; its Autonomy and persistence section 'Do not stop at acknowledging capability ... proposing a plan, or offering to continue' and 'Do not settle for a partial or "helpful enough" solution'. Exact quoted clauses can be read at donor lines 1, 17-25.
History basis: B (unfinished earlier order), A (no unsolicited work), early T2/T6 and late T4. Mechanism: replace a per-message target with one bounded task outcome; distinguish plan-only assignments from tasks that still require execution. The words 'authorized', 'requested', 'agreed', 'nothing outside its scope' and 'already-required' are essential safeguards against Sol-style overbuilding and new checks.
Existing coverage: Gold Standard already has completion, scope and blocker policy for Main; this replaces an insufficient shared base anchor, not the skill procedure. No automatic release, unlimited retries, additional review or new verification requirement follows from this wording.

### P2. Replace the new-user-message paragraph and its adjacent final-response sanity-check paragraph in <working_with_the_user>

Proposed new-message paragraph:

Treat new user messages as steering the active task unless the user clearly cancels it or requests an incompatible objective. Apply corrections and changed decisions to the parts they affect, and preserve all other still-applicable requirements, constraints and authorizations within their original scope. Answer questions as requested, without treating them as authorization for changes. If the user requests status during active work, answer briefly, then continue unless the user asks to pause, stop or only report status. After an interruption, a request to continue resumes the unfinished task from its current state.

Proposed adjacent sanity-check paragraph:

Before sending a final response after a resume, interruption or context transition, check it against the active objective, all still-applicable requirements and the user's latest steering.

Origin: Sol lines 69-73: 'By default, treat it as steering the active task rather than replacing it', 'preserving the original objective', and 'Only replace the active task when the user clearly cancels it or requests an incompatible new objective.'
History basis: B, C and D; additive mid-run corrections, deliberate stops and bare-resume episodes in all three partitions. Mechanism: update the cumulative agreement selectively instead of making the newest message the entire task or carrying obsolete decisions forever. The original scope bounds authorizations; a past release permission does not automatically authorize a new task. Explicit pauses remain binding. A materially incompatible new objective is not forced into the old one.
Existing coverage: the current SYSTEM paragraph already preserves nonconflicting requests and answers status then continues; main-workflow already maintains goal/todo. This is an in-place refinement, not a new tracker or more procedure. The adjacent final check must change with it: checking only that the answer addresses the 'newest request' invites replacing a long task with its latest status ping.

### P3. Replace the current compaction paragraph in <working_with_the_user>

Proposed:

Treat work across compactions, interruptions and handoffs as one continuing task. Preserve the active objective, latest accepted decisions and their reasons, relevant cancellations, constraints, prohibitions, established facts, outcomes of resolved issues, completed work and outstanding work. Keep superseded and cancelled decisions inactive. Use the task state already available to you; recover missing material information from its readable sources instead of guessing or reconstructing an unavailable approved target. Resume from the current state without restarting, redoing completed work or repeating updates already delivered.

Origin: Sol lines 71-73: 'preserve the original objective, accepted corrections, current constraints, completed work, and outstanding work' and 'Do not restart from scratch, redo completed work, or repeat commentary updates already delivered.'
History basis: C, D, E, handoffs and compaction episodes in early T7/T15 and late T5. History adds reasons, prohibitions and established facts, because the owner reports losing the basis of a decision, not merely a task label. The current target's prohibition on reconstructing missing approved text is deliberately retained, replacing Sol's unsafe 'make reasonable assumptions about anything missing'.
Mechanism: make explicit what survives a context transition and which state is authoritative. Preserve previous findings as findings with their uncertainty; do not turn an old hypothesis into fact or make earlier facts immune to new evidence. This names state to retain, not a command to enumerate/re-read/archive all of it every turn. No memory plugin is introduced or changed. Recovery is conditional on material information actually being missing.
Existing coverage: current SYSTEM already says compaction is not a restart and missing requirements must be recovered. main-workflow has todo/goal and note mechanics. Refine the existing general paragraph; leave concrete recovery-tool/registry mechanics in those owners.

## 4. What not to transfer, and why

- Sol's whole autonomy/permission block: persistent authorization and routine choices are already in Gold Standard/main-workflow. 'Reversible' does not itself authorize unrequested changes, and invoking a skill does not itself authorize an external message. No authority expansion.
- The donor's instruction to assume reasonable defaults for missing context: conflicts with exact approved wording and the observed guesses against source facts.
- Tests for 'unresolved concerns': open-ended checking is not this task. Existing covering checks, class reviews and evidence reuse already have policy. No new check/reviewer round.
- The donor's tool-specific parallel-call shell recipes, async-question tool, 60-second timing example, skills discovery, apps/plugins and visualization policy: not missing general task workflow in this harness; some are unavailable product APIs. Existing omp-tools supplies omp mechanics.
- A new search/delegation recipe: speed-first, minimum necessary information and independent parallel calls already have a primary owner. The current 'Read the codebase first' is not evidence of a mandate for exhaustive study; replacing it solely to add the whole Gold Standard again is not warranted.
- A larger style rewrite: brevity and self-contained questions are already in clear-communication. The base's 50-70-line ceiling is looser, but the injected communication rule is stricter, so a useful new workflow mechanism does not require another style edit.
- New automatic release, cross-task authorization, persistent memory database, per-turn agreement reconstruction, always-on deep research or per-item blind reviews. Those are not authorized by this research or by old task-scoped instructions.

## 5. Contradictions resolved rather than silently averaged

- Deep research is explicitly ordered in some tasks; the durable default is minimum sufficient gathering. The current task explicitly orders depth over all accessible OMP history, so the deep search here is not a proposal to make it universal.
- More autonomous action is desired within an order, while discussion-only messages require answers without edits. Do not infer authorization from reversibility or the mere words 'can you'. P1's bounded active task and 'when execution is still required' preserve this distinction.
- Existing checks are allowed despite the origin story of a ban against Sol's unsolicited tests: the owner reversed his earlier option in 01a10ab1:420. Current check policy, not an earlier isolated prohibition, controls.
- Heavy/double/per-stage reviews were ordered in specific tasks, and later defaults were reduced. No fixed heavy-review rule is extracted from those task orders.
- Many explicit release orders exist alongside task-scoped 'only my branch' or 'no release' boundaries. They cannot become blanket permission to publish.
- Older bottom-up-reading wording was explicitly retracted; latest top-down concise/self-contained communication governs. Detail and rich artifacts are requested separately.
- Cost caps, model-family preferences, reasoning levels and subagent counts evolved by task and time. Do not hardcode those historical values in the base prompt.

## 6. Independent grounds and limits

The independent grounds are the original catalog string, attributable dated raw user messages and observable neighbouring records, including contrary cases. They let a reader inspect whether the proposal addresses an observed requirement without relying on Main's or another model's agreement. The research includes preference statements and agent self-reports; a self-report of a tool failure or cause is not independent proof of that cause. Prompt-lineage metadata is not a measured runtime comparison.

The final blind reviewer checks fidelity to the current agreement, directly dependent rules, evidence and scope. CLEAN cannot prove these are globally optimal phrases or guarantee speed/goal retention. There was no candidate installation or A/B run, so causal benefit remains a mechanism-based hypothesis. A stronger runtime claim would require separately authorized comparative runs; none is proposed as an extra deliverable here.

Sources and current project state will be rechecked narrowly before completion. Since no source/configuration changed, project code tests do not cover a behavioural change made by this task and are not run for this research-only result.
