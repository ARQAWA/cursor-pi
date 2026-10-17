# Codex CLI system prompts

Base instructions for GPT-5.5 and newer from the OpenAI Codex CLI (`openai/codex`), saved verbatim for comparison with the captured Cursor prompts. These are catalog instruction texts, not complete requests with tool definitions and environment messages.

Initial GPT-5.5/GPT-5.6 snapshot: `openai/codex` `main`, HEAD `a45b8ccb016fb74f63a6bc29e701568e387cbe38`, committed 2026-10-16T04:42:32Z. Cloned with full history on 2026-10-16.

## Files

| File | Model slug | Source in repo | Text last changed in | How it was produced |
|---|---|---|---|---|
| `gpt-5.5.md` | `gpt-5.5` | `codex-rs/models-manager/models.json`, entry `gpt-5.5`, field `model_messages.instructions_template` | `c18277043e52ff4a81fdf2f039ddef85e3a6fd3e`, 2026-09-11T22:29:54Z ("Embed friendly instructions in bundled GPT-5.4 and GPT-5.5", #44930) | JSON string decoded, written as is (21,473 bytes, 148 lines, UTF-8, ends with a newline). Identical at HEAD `a45b8ccb01`. |
| `gpt-5.5.as-sent.md` | `gpt-5.5` | same field, then `codex-rs/prompts/src/update_plan_instructions.rs` | same | `gpt-5.5.md` after Codex's default runtime filter `without_update_plan_instructions`, run by compiling the repo's own function. It removes one line (146 of `gpt-5.5.md`, the bullet "If you create a checklist or task list, you update item statuses incrementally…"). 21,313 bytes, 147 lines. |
| `gpt-5.6-sol.md` | `gpt-5.6-sol` (also `gpt-5.6-terra`, `gpt-5.6-luna`) | `codex-rs/models-manager/models.json`, entry `gpt-5.6-sol`, field `model_messages.instructions_template` | `24462234b2aeeb27373e17bbe226baf9c0e97d3b`, 2026-09-23T00:07:56Z ("Refresh bundled model metadata and instructions", #47397) | JSON string decoded, written as is (17,766 bytes, 168 lines, UTF-8, ends with a newline). Identical at HEAD `a45b8ccb01`. The runtime filter changes nothing in this text, so the as-sent text equals this file. |

SHA-256: `gpt-5.5.md` `2351631dfc5644dc5a45eaaca4139475bd02810ee6cb792d058b551559b3242e`; `gpt-5.5.as-sent.md` `804aa6a08813023776647c3247bdee485fb8c95e834443252dfbd9943dd4b1b7`; `gpt-5.6-sol.md` `a91357a1cd2727a0be06d461248d6e3a7274746e38108f548a3adf2cc2430415`.

`source/` holds the raw source parts:

| File | Content |
|---|---|
| `source/gpt-5.5.models-json-lines-1339-1463.txt` | Lines 1339–1463 of `models.json` at HEAD: the whole `gpt-5.5` catalog entry, template included in its JSON-escaped form. |
| `source/gpt-5.6-sol.models-json-lines-690-830.txt` | Lines 690–830 of `models.json` at HEAD: the whole `gpt-5.6-sol` catalog entry. |
| `source/update_plan_instructions.rs` | `codex-rs/prompts/src/update_plan_instructions.rs` at HEAD, the filter described below. |

## Which GPT-5.6 variants have their own text

Only one text exists. The `instructions_template` of `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna` is byte-identical (same SHA-256), and so is the one of the hidden `codex-auto-review` entry. The variants differ only in metadata (reasoning defaults, multi-agent version, an `auto_review` policy on Luna, upgrade target). Earlier Sol, Terra and Luna texts differed (16,299 / 16,270 / 16,270 characters in the 2026-07-14 revision of the catalog) and were identical by 2026-07-18.

## GPT-5.5 came from HEAD

GPT-5.5 is still in the bundled catalog at HEAD. It is marked "Legacy coding model", has an `upgrade` to `gpt-6-sol`, and `retirement_at` is `null`. No older commit was needed. History of its text: first added in `c10f95ddac7b35095d334dece2ebcf69bcde61fc` (2026-04-24); until `c18277043e` it was a template containing `{{ personality }}` plus selectable `personality_default`, `personality_friendly` and `personality_pragmatic` variants; `c18277043e` embedded the friendly personality as fixed text. The `gpt-5.5` text is unchanged since then. The pre-embedding template rendered with the friendly personality differs from HEAD by one blank line only.

## How the initial GPT-5.5/GPT-5.6 texts are used

1. **Source.** Each catalog entry has `model_messages.instructions_template`. Since `df72fdb415` (2026-08-03) it is the only in-memory instruction source, and a template without variables is literal text. The top-level `base_instructions` field was removed from the bundled catalog in `8e694e955a` (2026-09-07). `d63a9b8344` (2026-10-06) removed the remaining `instructions_variables` machinery. The GPT-5.5 and GPT-5.6 templates above contain no placeholders (no `{{ … }}`), so nothing is concatenated from parts.
2. **Slug mapping.** `codex-rs/models-manager/src/manager.rs` picks the catalog entry by longest slug prefix of the requested model (also by namespaced suffix). The bundled catalog is `models.json`, loaded with `include_str!` in `models-manager/src/lib.rs`. Codex also fetches a remote catalog from the `/models` endpoint (cached) and accepts a user `model_catalog_json`, so a live session may use newer or different text than this snapshot. An unknown slug falls back to `codex-rs/models-manager/prompt.md`, not to these templates.
3. **Rendering.** `render_model_instructions` (`codex-rs/prompts/src/model_instructions.rs`) returns the template unchanged. A `config.base_instructions` override or the base instructions saved in a resumed session take priority (`core/src/session/mod.rs`, around line 832).
4. **Default runtime filter.** `Session::get_prompt_base_instructions` (`core/src/session/mod.rs`) applies `without_update_plan_instructions` when `update_plan_enabled` is false, no custom `model_catalog_json` is set, and the instructions came from the model catalog. `update_plan_enabled` is false unless `tools.update_plan.enabled` is set (`core/src/config/mod.rs`, `resolve_update_plan_enabled`). The filter drops the sections `## Planning` (only when it describes the `update_plan` checklist), ``## `update_plan` ``, `## Plan tool` and `## Plan Mode vs update_plan tool`, bullets starting with "Use the plan tool " or "If you create a checklist or task list,", and the "Progress visibility:" block. In the GPT-5.5 text it matches one bullet. In the GPT-5.6 text it matches nothing. With `update_plan` enabled, the model receives `gpt-5.5.md` as saved. Setting `personality = "none"` would additionally strip the `# Personality` section (`models-manager/src/model_info.rs`); this is not the default.
5. **Wire format.** `core/src/client.rs` (`build_responses_request`) inserts the text as the first item of `input`: a message with role `developer` and no wrapper markers, so the text is sent unchanged. `ResponsesApiRequest` has no separate `instructions` field. GPT-5.6 entries set `use_responses_lite: true`; GPT-5.5 sets it to `false`. Both use this same placement of the base instructions.

## Other model-specific text that is not part of the base instructions

These are sent as separate developer or context messages and are not saved here: permission and approval messages (`codex-rs/prompts/templates/permissions/`), collaboration modes, persistent-mode instructions (`templates/persistent_mode.md`), multi-agent role text, the token-budget reminder (`token_budget.reminder_message_template` in the 5.6 entries), tool descriptions, AGENTS.md and environment context, and the Guardian / auto-review policies (`auto_review` in the Luna entry).

## Current GPT-6 and GPT-6.1 extraction

`git fetch origin main` on 2026-10-16 returned commit `6ae8b8aa7c608730d4315d59c5c081897ae02780`, committed 2026-10-16T06:06:54Z. The source is [codex-rs/models-manager/models.json at that commit](https://github.com/openai/codex/blob/6ae8b8aa7c608730d4315d59c5c081897ae02780/codex-rs/models-manager/models.json), field `model_messages.instructions_template` of each named entry. The local Codex 0.162.0 catalog fetched from the server at 2026-10-16T06:28:27.013889Z has byte-identical templates for all three new models and both GPT-5.6 models. No account identity or authentication data from that cache is saved.

| File | Slug line / template line in the source | UTF-8 bytes | SHA-256 |
|---|---|---:|---|
| [gpt-6.1-sol.md](gpt-6.1-sol.md) | 177 / 250 | 21,779 | `e1bdd4f8f0df4b20f4a0ffc8a861ce819df45325d8cecdfb92e80379cf8d142e` |
| [gpt-6-sol.md](gpt-6-sol.md) | 353 / 424 | 18,998 | `b1dd8718c037906c53a305c5cbccb4a4be35ccbb7837461ec349bfc495412f0d` |
| [gpt-6-luna.md](gpt-6-luna.md) | 524 / 591 | 18,043 | `b707476816bfe5e571a1bd2179f130fff2b132da5ab8e61063acdb7fd24daf12` |

The files contain the JSON-decoded strings without text edits. `render_model_instructions` in `codex-rs/prompts/src/model_instructions.rs` returns each string unchanged; the `{{connector_id}}` text is a literal app-link example, not a runtime substitution. None of these three texts matches the removal rules in `without_update_plan_instructions`. They are therefore also the default catalog-derived base instructions, subject to the config/resumed-session overrides described above. This extraction did not run a model session or capture a fresh wire request.

GPT-5.6 Sol and Luna remain byte-identical to each other and to the previously saved [gpt-5.6-sol.md](gpt-5.6-sol.md): 17,766 UTF-8 bytes, SHA-256 `a91357a1cd2727a0be06d461248d6e3a7274746e38108f548a3adf2cc2430415`. Their template lines in the current source are 767 and 1045; a duplicate Luna prompt file is unnecessary.

## Which current prompts are closest

This comparison concerns the native Codex texts. The captured Cursor texts and the separately prepared [OMP release candidate](../../remaster/prompts/gpt-6.1-sol-rc.md) are different artifacts and are not substituted for native instructions.

| Pair | Finding |
|---|---|
| GPT-5.6 Sol / GPT-5.6 Luna | Exactly the same base instruction text. There is no text-based reason to say another prompt is closer to one than to the other. |
| GPT-6 Sol / GPT-6 Luna | Closest nonidentical pair: only three groups of behavioral differences, listed below. |
| GPT-6.1 Sol / GPT-6 Sol | Same GPT-6 product and workflow structure, with substantial rewriting and additions, especially communication. |
| GPT-6.1 Sol / GPT-6 Luna | The same shared structure; GPT-6 Sol is the more relevant comparison for permission continuity and testing policy, while most sections are identical across Sol/Luna. |
| GPT-6 family / GPT-5.6 family | A broader rewrite of permissions, task continuity, skills, product integration and visualizations, not a model-name substitution. |

These conclusions follow from the actual changed clauses and shared sections. A percentage of identical lines would penalize moved sections and rewritten paragraphs and would not measure behavioral similarity. No inference about model intelligence, speed or actual performance follows from prompt similarity.

### GPT-6 Sol versus GPT-6 Luna: all three differences

1. **Continuing authorized work.** Luna's permission paragraph ends with “like a competent colleague would.” Sol appends: “Once evidence in a session supports authorization for a next step or action, you should continue work without ending the turn to clarify with the user.” Sol makes continued execution explicit rather than leaving it to judgment.
2. **Tests.** Luna says: “Do not add or run tests unless the user asks you to test or verify implementation.” Sol instead discourages tests for reversible, low-impact changes or tests mirroring implementation, permits meaningful necessary tests, and limits broader/repeated testing to a concrete risk or a required gate. This is a substantive difference in default workflow.
3. **Responding to corrections.** Only Sol adds a rule to interpret a correction, questioned approach, mistake or unmet requirement as a request to fix it, while honoring requests for explanation only, stopping, narrowing or approval. Luna has the shared conversation-steering rules but not this extra fix-oriented paragraph.

The remaining text is unchanged between these two files.

### GPT-6.1 Sol versus GPT-6 Sol

| Area | GPT-6 Sol | GPT-6.1 Sol |
|---|---|---|
| Order | Personality and writing style precede permission and autonomy | Permission and autonomy come first, followed by personality and communication |
| Personality | “simple, clear communicator”; own judgment without flattery | “lucid communicator”; explicit warmth and candor, with the same independence |
| Writing | Shorter paragraph-level guidance on clear explanations | A larger prose-focused style section: active voice, connected paragraphs, no section headings, fewer formulaic phrases and unnecessary apologies |
| Technical communication | Included in general writing instructions | Separate section on outcome, evidence, practical limits and nonchronological reporting; routine verification should be summarized |
| PR descriptions | No dedicated subsection | Two paragraphs on concrete problem/result, before/after examples, validation and rewriting around the final implementation |
| Requests for action | Persistence and completion rules | Adds an explicit instruction that “can you”, “I want to” and “help me” request action, not a capability acknowledgment or a plan alone |
| External messages | Requires explicit authorization | Also names instructions in an explicitly invoked skill/plugin, with a final citation of that source |
| Approval rejection explanation | Explain action and reason | Additionally specifies a separate paragraph at the end of commentary and final |
| Async questions | `send_user_message_async` or `request_user_input_async`; 30 seconds as an example for optional clarification | Only `request_user_input_async` is named; no file/screenshot upload requests through it; optional example becomes 60 seconds |
| Tests | Meaningful necessary tests; broader/repeated tests only for concrete risk or gates | Explicitly run appropriate tests and required checks; repeat/broaden after new changes, failures or unresolved concerns |
| Corrections | Extra rule that questions/corrections usually call for a fix | That dedicated paragraph is absent; shared steering and explicit action-request rules remain |
| Skills causing a pause | Name the skill and summarize its relevant instruction | Link the exact source, quote the relevant instruction, distinguish explicit requirements from interpretation and do not infer approval gates |

Several differences in whitespace and spelling are not behavioral changes. The two versions retain the same main conversation-steering and post-compaction continuity paragraphs, connector/plugin sections and the substance of their visualization guidance. Moving permission rules earlier changes presentation priority; its effect on a model was not measured.

### GPT-6 family versus GPT-5.6 Sol/Luna

| Area | GPT-5.6 base text | GPT-6 family base texts |
|---|---|---|
| Independent judgment | A richer “old friend”/subjectivity personality | Explicitly keep judgment, disagree for a reason, reconsider with evidence and avoid flattery |
| Authorization | Distinguishes answer/diagnosis/change/wait and bounds actions by the request | Dedicated permission and autonomy sections emphasize persistent authorization, finishing authorized preparation before approval and continuing independently |
| New user messages | Decide whether the latest request replaces or adds to unfinished work | Default to steering the active task; replace it only on clear cancellation or an incompatible objective |
| Compaction continuity | Says to assume the latest request is current, while retaining useful earlier context | Explicitly preserve the original objective, corrections, constraints, completed and outstanding work across compaction |
| Clarification | No async-question instructions in the base text | Dedicated async-tool guidance, continued independent work and the distinction between optional clarification and mandatory approval |
| Communication | Minimal formatting and plain technical explanation | More explicit rejection of canned AI phrases and invented compound labels; GPT-6.1 expands this further |
| Progress | Introductory update and no more than 60 seconds without commentary | Same 60-second cadence remains; GPT-6 is not a change to silent execution |
| Parallel calls | Generic preference for parallel tool calls | Explicit `functions.exec` / `Promise.allSettled` instructions, inspection of every result and sequential dependencies/approvals/mutations |
| Shell use | Escaping, short waits and environment-variable warnings | Adds `JSON.stringify()`-is-not-shell-escaping and multiline publication-text handling |
| Test scope | Verify changes in proportion to risk | Different Sol/Luna rules as above; a separate restriction on unsolicited hypothetical-risk checklists |
| Editing/deletion | Dedicated dirty-worktree and destructive-action sections | Those dedicated sections are absent from these base strings; this does not establish their absence from separate tool/permission messages |
| Skills | Automatic matching by task description and a detailed reading procedure | A shorter relevance-based policy, explicit instruction priority and clearer handling of skill-caused stops |
| Apps/plugins | No corresponding sections | New connector discovery, app links, plugin capabilities and naming rules |
| Visualizations | Only when materially clearer; smallest useful static visual | Prefers interactive visuals for explanation and scenarios, standard plotting tools for export, and Mermaid for small static engineering diagrams |

GPT-6.1 does not contain an XML block named `epistemic_rigor`; its personality paragraph nevertheless explicitly requires independent judgment and evidence-based reconsideration. This is related to, but not text-identical with, Cursor Sol's more explicit anti-agreement block.

### Runtime metadata limits

The same base text does not imply identical complete sessions. In this catalog, GPT-5.6 Sol defaults to low reasoning with multi-agent version v2, while GPT-5.6 Luna defaults to medium with v1. GPT-6 Sol and Luna both default to medium/v2; GPT-6.1 Sol defaults to low/v2. All five entries use `code_mode_only`, freeform patches and Responses Lite. These are catalog settings, not evidence of which effort a user selected in a particular run, nor a comparison of role prompts or complete tool arrays.

The later-mentioned “GPT-5” comparison has not been performed: the owner previously excluded everything below GPT-5.5, and the exact intended reference needs clarification.
