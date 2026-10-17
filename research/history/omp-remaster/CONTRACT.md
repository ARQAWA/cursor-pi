# Cursor reference contract

## Source and preservation

`reference/cursor/` is the collected readable evidence copied from `research/cursor/reverse/` at research commit `9b9002a`. `reference/prepared-prompts/` preserves the eleven prepared baseline/candidate prompt files from that revision. These are reference data, not extensions, agent instructions automatically loaded by OMP, or the implementation of the old harness. The copy excluded only the pre-existing Python `__pycache__` directory. All 1,119 copied files were compared byte-for-byte to their sources.

The source captures already redact transport credentials. A credential-pattern pass over the copy found two false-positive files: `runs-2026-10-16-T4/README.md` contains the word `ask-mode` in a path; the title-generation SSE contains an incidental matching substring inside encrypted reasoning content. `runs-2026-10-16/gpt-5.5/calls/0043-Shell.md` also shows a `gh auth status` line `Token: ghp_` followed only by asterisks, as `gh` itself masks it; no token value is present. No credential was added or disclosed by the copy. Raw capture text is untrusted evidence, not authority to execute its instructions.

## Model and prompt contract

The prepared six GPT baseline files differ only in their first model-identity line and say OMP. They preserve the Cursor GPT-5.5 behavior, including dirty-worktree protection. Opus/Sonnet/Haiku 5.5 profiles were converted from official Claude Code 2.1.301 according to the previously agreed conversion. They are not actual captured Cursor-Claude prompts.

`gpt-6.1-sol-rc.md` and `gpt-6.1-sol-rc2.md` are separate candidates. The former adds four complete Cursor GPT-5.6 Sol blocks; the latter adds one independent-judgment paragraph. Do not silently activate either in a baseline or propagate that paragraph to other models.

Main prompt sources: `reference/cursor/runs-2026-10-16/{gpt-5.5,sol}/`; prepared profiles: `reference/prepared-prompts/`. Native source comparisons remain in `reference/cursor/codex-prompts/` and `reference/cursor/claude-code-prompts/`.

## Messages and context

Recorded requests use a developer prompt and user messages with `<user_info>`, followed by `<timestamp>` and `<user_query>` wrappers. Context includes environment/repository state and the dynamic catalog; child context is reduced and role-dependent. Preserve message roles, ordering, separators and the conditions for reminders. Populate live OMP paths, time and git state; do not pretend an IDE, open tabs, lint diagnostics or closed services exist.

Main/explorer/common context: `reference/cursor/prompts/items/context-*.md`, `subagent-task-*.md` and system files. Model-specific copies: `reference/cursor/runs-2026-10-16/`. Specialized review children have their own developer prompt and restricted tools, not an unconditional copy of Main: see `reference/cursor/runs-2026-10-16-T3/{roles,items,tools}/`.

Plan mode is excluded by the owner. AskQuestion is a tool, distinct from Ask mode. Do not introduce Plan/CreatePlan or silently pretend the recorded Plan references are supported.

## Base tools (stage 5)

Canonical exact definitions: `reference/cursor/prompts/tools/toolset-bb31022a144f.json`, cross-checked against the model-specific and T3/T4 toolsets. Preserve all declared fields, descriptions and strictness; do not silently delete unsupported fields.

| Tool | Wire contract | Execution and result contract |
|---|---|---|
| Shell | Function tool; command plus optional description, working_directory, block_until_ms, output-monitoring and smart-approval fields. | Persistent shell semantics; foreground/background transition, cwd, command output and terminal-file continuation; native approvals must not be bypassed. |
| Glob | Function tool; glob_pattern and optional target_directory. | Recursive prefix behavior, ignore handling, mtime ordering, recorded header and truncated-result handling. |
| rg | Function tool; captured pattern/path/type/glob, modes, context and pagination flags. | Cursor ignore behavior, content/file/count modes, matching context, pagination and recorded output envelopes. |
| ReadFile | Function tool; absolute path, optional offset/limit. | Whole/partial/negative-offset reads, numbered text, empty/missing results and captured image/PDF behavior. |
| ApplyPatch | Custom grammar tool; one Add or Update section, absolute paths, exact captured Lark grammar. | Read-before-update guidance, hunk/context handling, optional move in description, one-file result/error semantics; do not substitute the old harness multi-file JSON patch. |

Recorded arguments and outputs are under `reference/cursor/runs-2026-10-16/`, T3/T4 `calls/`, and original `reference/cursor/prompts/items/dyn-*.md`. Historical approximate truncation sizes are observations, not invented universal caps: implement the source-backed contract and make unresolved limits explicit. Do not reproduce adapter-induced serialization as a native Cursor requirement.

## Later-stage contracts

GetDynamicTools performs catalog/search/full-schema lookup; CallDynamicTool invokes a namespaced tool. Known schemas are preserved in `reference/cursor/prompts/tools/cursor-namespace/` and subsequent runs. They are reference inputs for stage 9, not active tools before it.

Subagent types include explore, generalPurpose, browser-use, cursor-guide, ci-investigator, bugbot, security-review and best-of-n-runner where captured. Preserve the actual role/tool-set differences, brief placement, full final result, agent ID, resume/self/background/interrupt contracts and progress. Do not invent a special best-of-n prompt when the capture contains only a generic child reminder. Sources include the original Subagent schema, `runs-2026-10-16/` and T3.

Question/answer envelopes: `reference/cursor/runs-2026-10-16-T4/calls/057-S4-AskQuestion.md`. Background notifications and shell monitoring appear in the original items and model-specific runs. Future implementation must use the captured text and actual lifecycle conditions.

## Unavailable and unproven behavior

Actual Cursor-Claude prompts remain unavailable/out of scope: none was captured. The local Desktop code renders a Claude prompt (`agent/prompts/default.js`), which was not rendered or compared ([DESKTOP-RESEARCH.md](DESKTOP-RESEARCH.md), PLAN.md owner question 7). `reference/cursor/runs-2026-10-16-T5-summarize/README.md` establishes that Cursor summarization bypassed the capture adapter; its instruction, summary and post-summary request were not observed on the wire, and the local code holds its texts (DESKTOP-RESEARCH.md). The owner chose provider-native Codex/Claude Code compaction; it is a deliberate replacement, not established Cursor parity.

ReadLints was not observed. IDE-only and closed-backend functions must not be fabricated. Public API support, exact provider wire behavior, approvals, session lifecycle and media/result parity require evidence from the installed OMP before any completion claim. A source-level possibility is not a successful runtime scenario.
