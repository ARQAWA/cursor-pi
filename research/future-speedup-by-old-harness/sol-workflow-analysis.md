# Sol workflow mechanisms: source and current coverage

## Provenance established by direct reading

Current source availability: the Cursor research extraction path below disappeared while the neighbouring project was being changed. The primary local Codex catalog remains readable. A fresh structured read again confirmed its gpt-6.1-sol template equals the previously read extracted original exactly. The unchanged 21,779-byte catalog template is now available as local://gpt-6.1-sol-original.md; use that exact source copy or the catalog itself for current verification. References to the former extraction path below describe the initial provenance investigation, not a currently usable link.

Original text: /Users/arkadijcukavin/ai-project/cursor-pi/research/cursor/reverse/codex-prompts/gpt-6.1-sol.md (170 lines).
Extraction context: sibling README.md, section Current GPT-6 and GPT-6.1 extraction. It records OpenAI Codex commit 6ae8b8aa7c608730d4315d59c5c081897ae02780 and field model_messages.instructions_template of slug gpt-6.1-sol.
Primary local source: /Users/arkadijcukavin/Documents/ChatGPT/codex-harness/codex-rs/models-manager/models.json. A structured JSON read in Main's JS eval found the gpt-6.1-sol entry and established byte-for-byte string equality of its model_messages.instructions_template with the extracted text. The text begins 'You are Codex, an agent based on GPT-6.'; the generic identity line does not rename its catalog slug.

Do not confuse this with Cursor's captured gpt-5.6-sol text in reverse/runs-2026-10-16/sol/system-prompt-15499.md, or remaster/prompts/gpt-6.1-sol.md, which remaster/README.md says is a GPT-5.5-derived OMP adaptation with a model-name substitution. RC and RC2 are further adaptations, not primary GPT-6.1 instructions. The source is a native Codex catalog prompt stored in the Cursor research folder, not evidence of a captured Cursor GPT-6.1 wire request.

Current comparison source: /Users/arkadijcukavin/Documents/ChatGPT/my-omp-harness/SYSTEM.md, read in full in this session. Directly dependent contracts already in context/read: WORKFLOW-MANIFEST.md, gold-standard, main-workflow, subagents and clear-communication.

## Mechanisms and coverage

1. Identity anchored to outcome. Original: 'your job is to collaborate with them until their intended goal is completely handled.' Current SYSTEM main_goal only says 'Your main goal is to follow the USER\'s instructions at each message.' It does not explicitly carry a task to completion. Gold Standard already says to finish the whole requested task, stop when done, not add scope. Candidate: replace the generic main_goal sentence with a compact explicit continuity/completion rule, without copying the whole Gold Standard.

2. Persistent authorization. Original: 'User authorization and preferences persist across turns. Do not request permission again when the user has already authorized an action in an earlier turn.' Already explicit in Gold Standard Act on your own, including permission boundaries. Native instruction that skills cannot create an extra gate must not be imported wholesale: current adopted class/review procedures and safety permissions remain binding. Only propose a base sentence if an actual missing general behavior remains after reading history; do not duplicate all approval policy.

3. Intent to action and completeness. Original: 'Do not stop at acknowledging capability ... proposing a plan, or offering to continue.' Also: 'Do not settle for a partial or "helpful enough" solution ... to save time, effort or tokens.' These are already substantially in Gold Standard. SYSTEM lacks a direct autonomy/completion section. Candidate for a short base goal contract, not a new step or repeated skill mechanics.

4. Steering versus replacement. Original: 'By default, treat it as steering the active task rather than replacing it.' And: 'Abandon or replace the active task only when the user clearly cancels it or requests an incompatible new objective.' Current SYSTEM says newest conflicting messages steer; status answer then continue; sanity check latest request. It preserves nonconflicting requests but does not state a default against discarding active work. Candidate: replace the existing user-message paragraph in place with an explicit steering/continuity paragraph. A material ambiguity still needs clarification; do not blindly assume all new topics are compatible.

5. Compaction as one task chain. Original: 'preserve the original objective, accepted corrections, current constraints, completed work, and outstanding work.' Also: 'Do not restart from scratch, redo completed work, or repeat commentary updates already delivered.' Current SYSTEM says assume compaction, don't restart, recover missing requirements from available sources; it lacks the specific task-state inventory and no repeated work. Candidate: replace its compaction paragraph in place with that explicit state preservation. Reject the donor's 'make reasonable assumptions about anything missing' for agreements: do not reconstruct missing approved wording; recover the readable source or ask.

6. Permission at the risk point. Original asks to complete authorized preparation so approval is of a concrete reviewable result. Potentially useful but do not adopt its statement that reversibility alone grants permission or skills can authorize external sends. No such transfer should expand current user's scope or safety authority. History must establish whether this is a genuine missing workflow problem.

7. Parallel independent work, sequential dependencies. Original: 'Batch independent searches and reads ... inspect every result. Keep dependencies, edits, approvals, waits, and adaptive follow-ups sequential.' Current SYSTEM already says parallelize independent reads; omp-tools/Gold Standard specify detailed batch mechanics. No new base rule needed unless replacing a less precise existing sentence; do not copy functions.exec or tool names that don't exist in omp.

8. Proportionate checks and reuse. Original: 'Once those pass, broaden or repeat testing only when new changes, failures, or unresolved concerns justify it'. Current Gold Standard and AGENTS are narrower and already explicit on existing covering checks and reuse. No stronger testing rule from Sol is needed, especially not 'unresolved concerns' as an open-ended expansion.

9. Routine implementation choices versus questions. Already in Gold Standard and main-workflow. Native async-question tools, timeout examples and skill discovery machinery are not available omp workflow; exclude them.

10. Communication. Native outcome-first, meaningful progress and limited routine verification reporting already in clear-communication and SYSTEM. No need to transfer its longer prose/style sections, visualization, apps/plugins or product-specific instructions for this task.

## Initial judgment, pending history

Strongest structural gap is SYSTEM's weak final goal contract, plus less explicit treatment of steering and continuity across compaction. The best proposal may be replacements of existing paragraphs, not appended blocks. Existing Gold Standard already carries most native autonomy/scope/check policy. Do not turn every supported preference into another duplicated instruction. Actual workflow improvement remains a hypothesis from rules and observed failure patterns, not measured model performance.
