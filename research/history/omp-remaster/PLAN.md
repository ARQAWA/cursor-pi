# OMP remaster plan

## Status

Stopped on 2026-10-17 by the owner's decision: the Cursor Desktop clone will be rebuilt from scratch on plain Python instead of OMP. Stages 1–5 are done on OMP in this branch ([README.md](README.md), [FEASIBILITY.md](FEASIBILITY.md), [CONTRACT.md](CONTRACT.md)). Stages 6–14 below are the OMP plan as it stood at the stop; they will not be run on OMP. The Cursor Desktop research behind this plan is in [DESKTOP-RESEARCH.md](DESKTOP-RESEARCH.md). The discrepancies R1–R9, the scope and the open owner questions are recorded here for reuse.

## Deliverable and boundaries

The result is this repository: extensions, settings and add-ons that turn stock OMP into a mechanical copy of the Cursor Desktop agent, in function, mechanics and prompts, using the prompts prepared in the first research (`reference/prepared-prompts/`). It is not a fork and not a patched build of OMP: only OMP's public extension API, its CLI flags and its settings are used.

- Reference: Cursor Desktop 3.25.6 (`/Applications/Cursor.app`, commit `f0df777c`). The Cursor CLI is out of scope, as if it did not exist: none of its runs, binaries or outputs is a source.
- Nothing beyond Cursor: every OMP mechanism that Cursor does not have is turned off. Only what was defined in the initial scope and chosen together in the owner's chat is built (see "Scope").
- Models: GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, Claude Opus, Sonnet and Haiku 5.5. Nothing below GPT-5.5.
- Commit and push only to `remaster`; no merge into `master`, no install over the current harness.
- This repository is public. It keeps the Desktop captures in `reference/cursor/` (published since stage 1) and, in its tool code and documents, Cursor module paths, function names, constant values and short result texts. It never keeps Cursor bundle code or extracted modules, credentials, or the capture adapter's logs.

## Sources and their roles

| Source | Role |
|---|---|
| Cursor Desktop's local agent code: `cursor-agent-host/dist/agent-host-daemon/dist/bin/daemon.cjs` (the `@anysphere` agent package: `agent/prompts`, `agent/tools`, `agent/actions`, `agent-summarization`, `agent/self-summary`) | Specification: texts, formats, constants, branches by model and conditions. Read locally from the installed app, split into its esbuild modules in the OS temp folder; the method and the code map are in DESKTOP-RESEARCH.md. |
| Captures in `reference/cursor/` from Desktop chats (adapter logs and Desktop transcripts) | Check of what Cursor actually sent. All 58 turn-routing lines in Cursor's current logs chose the `connect` runtime (`managed-local-unavailable`), so the backend, not the local daemon, built those requests; where the local code and a capture differ, the capture wins and the difference is recorded as drift. |
| New Desktop probes, driven with Computer Use in Cursor Desktop on GPT-5.5, GPT-5.6 Luna or GPT-5.6 Sol through the owner's provider, recorded by the capture adapter | Fills a gap that neither the code nor the existing captures settle. |
| OMP 18.10.1 source (tag `v18.10.1`, `5d0aaffa`) and the installed binary | Which public API reproduces each mechanism and which OMP mechanisms must be turned off. Stage 3 read the 18.10.0 source (`b83200eb`) and ran the installed 18.10.1 (FEASIBILITY.md). |

Excluded as CLI material: `reference/cursor/bench-luna/` (its runner spawned `agent -p … --output-format stream-json`). Desktop origin was confirmed for `sessions/`, `coverage/`, `REPORT.md`, `runs-2026-10-10/` and the `runs-2026-10-16*` folders by their chats in Desktop's `state.vscdb` and `~/.cursor/projects/*/agent-transcripts`. `codex-prompts/` and `claude-code-prompts/` are not Cursor; they are the conversion sources of the prepared prompts.

## Traceability and evidence

`TRACE.md` holds one row per requirement: ID, requirement, source (Cursor module and function, or capture file), plan step, test, evidence. A requirement without a source is not built; a source without a row is either out of scope or an owner question.

Evidence comes from outside the remaster's own reasoning:

1. Formatter equality: a private harness in the temp folder loads the named functions from the local Cursor bundle, feeds the same inputs to them and to the remaster's tool code, and compares the outputs byte for byte (Glob, rg, ReadFile, Shell, ApplyPatch results, AskQuestion and subagent result texts, notifications).
2. Paired requests: the same task in Cursor Desktop (Computer Use, research models above, adapter recording) and in the remaster (recording extension loaded last); the request bodies are compared after removing ids, times and cache keys. The expected diff is empty except for the agreed differences listed in `TRACE.md`.
3. Transcript replay: tool calls from Desktop `agent-transcripts` are replayed against the remaster's tools in a copy of the same repository state where that state is recoverable.
4. Drift check: a script records the content hashes of the Cursor modules named in `TRACE.md` and the app version; after a Cursor update it re-extracts, lists the changed modules and reruns check 1 for them.

The scripts of checks 1, 2 and 4 live in this repository and contain no Cursor code: they read the installed app at run time.

## Stage 1–5 discrepancies found in the Desktop code

| ID | Mechanism | Cursor code | Remaster now | Correction |
|---|---|---|---|---|
| R1 | Glob cut | `agent/tools/core/glob/glob.js` `formatFilesForGlob`: `TOTAL_CHARACTER_BUDGET = 5000` characters; zero files `Result of search in '<root>': 0 files found`; no `(total …)` when ripgrep was truncated; `... at least N more files ...`; `[Results truncated. …]` notice | cut at 100 files, `total 0 files` | Port the character budget and every branch |
| R2 | rg cut and footer | `agent/tools/core/grep/formatters.js`: `GREP_CHAR_BUDGET = 15000`; `Results truncated. ` lead; `Showing a-b of [at least] N <unit>s`; `Use offset=…`; `Narrow the search to see the rest.`; `No files with matches found`; `No more results at offset=…`; context separator `  --`; error `Error running tool: …` | no character cap, own footer, no separators, own errors | Port `buildResultFooter`, the three formatters and the empty-page texts |
| R3 | ReadFile limits | `agent/tools/core/read/read.js` and `read/common.js`: `READ_CHAR_HARD_LIMIT` (exceeded result), `Offset N is beyond file length (M lines)`, `Cannot read binary files of type …`, image and PDF text reads; omitted-lines text from `agent/tools/core/formatting.js`, which writes `... 1 line not shown ...` in the singular | no cap, offset past the end returns empty, images and PDF rejected, always `lines` | Port the cap, the error texts and the singular form; images and PDF as in `read.js` |
| R4 | Shell results | `agent/tools/core/shell/formatters.js`: `SHELL_CHAR_HARD_LIMIT = 20000` with its truncation line, output-file form `Command output has been written to: <file> (<size>, <n> lines)`, timeout, abort (`Command aborted after N ms.` and the new-shell state line), background move `The command did not complete in Nms and was sent to the background.` with the partial-output section | whole output, own background-move text, cancel as exit 130 | Port every formatter branch except the sandbox reminders |
| R5 | ApplyPatch errors | `agent/tools/core/edit/apply-patch.js`: `Invalid patch format. Your diff must begin with … and end with ….`; `There was an error applying the patch, and it was NOT applied. …` | own `Error: …` texts | Port the texts |
| R6 | Claude edit tools | `agent/configs/tool-config.js` `defaultAgentEditToolGenerator`: OpenAI GPT-5 family gets ApplyPatch; Anthropic gets StrReplace and Write; EditNotebook for both | Claude gets ApplyPatch with one `input` field | Owner question 3 |
| R7 | Tool descriptions per model | descriptions and schemas branch on `promptVersion` (`latest`, `gpt5-codex`, `haiku`, …) set by the server's model metadata | one captured GPT toolset for all models | Take the GPT branch from the captures; derive the Claude branch from the code, marked as uncaptured |
| R8 | `parallel_tool_calls` | not set anywhere in the agent package; built by Cursor's backend. The adapter keeps only the input array of the raw request and turns a missing value into `false`, so the 309 logged `false` values do not show what Cursor sent | sends `true` | Log the raw incoming body in a new Desktop probe; send the same (omitted or the same value) |
| R9 | `<git_status>` size | `agent/prompts/user-info.js` `GIT_STATUS_CHARACTER_LIMIT = 10000` | no cap | Port the cap and its marker |

Corrected at the stop: the README no longer cites the bench-luna analysis, the README and FEASIBILITY row B4 describe the adapter's `parallel_tool_calls` handling as above, and the stage numbers in README, FEASIBILITY and CONTRACT follow the stages below.

## Scope

Taken from the owner's words and accepted answers in this chat:

- Prompts: the prepared GPT baseline (Cursor GPT-5.5 prompt with OMP as product and the model's own name) for the six GPT models; GPT-6.1 Sol RC1 and RC2 as separate candidates; Claude Opus, Sonnet and Haiku 5.5 from the approved Claude Code conversion. Each converted block keeps its own blind check.
- Message layout, the eight main tools, the dynamic catalog behind GetDynamicTools and CallDynamicTool, subagents with their prompts, tool sets and result texts, background work, resume, self-fork, interrupt, AwaitShell, progress (UpdateCurrentStep), notifications, AskQuestion, and provider-native compaction.
- Compaction: the owner chose provider-native compaction over Cursor's summarizer: «в рот я ебал summarizer Cursor… Именно нативно, так, как делает сам Codex LLM и сам Cloud Code». Codex and Claude Code compaction, as captured in `reference/cursor/codex-prompts/compaction/` and `reference/cursor/claude-code-prompts/compaction/`, is a recorded difference from Cursor.
- Out: Plan mode, Ask mode and Debug mode, ReadLints and other IDE-only data, Cursor's own closed services (they are not faked), anything below GPT-5.5, the Cursor CLI. The capture adapter stays research equipment.
- Interface: OMP's terminal interface is the host and stays; Cursor's editor interface is not reproduced. Interface work comes after the mechanics, by separate request.

Open scope points are the owner questions below.

## Stages

Each stage: plan its steps and get light review; give every finished step light review; close it with light review of the whole stage and blind review of consistency across all finished stages; repair until CLEAN; commit and push to `remaster`. Owner-agreed differences go into `TRACE.md`.

| Stage | Result | Done when |
|---|---|---|
| 6. Re-baseline | CLI material removed from `reference/`; `TRACE.md` with rows for stages 1–5; the extraction, formatter-equality and drift scripts; Desktop probes with Computer Use on GPT-5.5, GPT-5.6 Luna or GPT-5.6 Sol, with the adapter logging the raw incoming body, for R8 and every other gap that blocks stage 7 | Every stage 1–5 behavior has a row with a Cursor code location or capture, checks 1 and 4 run, and the probe results are in `reference/` |
| 7. Stage 1–5 corrections | R1–R5 and R7–R9 fixed; R6 waits for owner question 3 and follows the option he chooses; README, CONTRACT and FEASIBILITY describe the corrected behavior | Check 1 is byte-equal for every ported formatter branch; one paired request (check 2) with the five tools shows only agreed differences; no document still describes a corrected behavior as before |
| 8. OMP beyond Cursor turned off | A settings overlay passed with `--config` and the launch flags turn off OMP's other tools and mechanisms: `ask`, `astEdit`, `async`, `archive`, `browser`, `debug`, `exa`, `fetch`, `find`, `glob`, `grep`, `goal`, `ida`, `launch`, `lsp`, `magicKeywords`, `plan`, `read.summarize`, `recap`, `todo`, `ttsr`, `skills`, `shellMinimizer`, `bash.autoBackground`, `eval.tools`, the model loop guards and compaction until stage 13, plus any other setting found on in OMP 18.10.1 that Cursor lacks | A run in the owner's environment sends only the remaster's messages and tools, and no OMP reminder, nudge, auto-background or loop-guard text appears in a long run |
| 9. Dynamic tools | GetDynamicTools and CallDynamicTool with Cursor's catalog block, schema lookup, search and errors (`agent/tools/mcp/get-mcp-tools.js`, `mcp.js`) and handlers for the agreed catalog tools (owner question 1) that need no later stage; the AwaitShell and Subagent entries join the catalog with their handlers in stages 11 and 10 | Check 1 for the catalog, lookup and error texts; check 2 for discovery and a call |
| 10. Subagents | Subagent tool and the agreed types (owner question 2) with the role texts from `agent/tools/core/subagent/*.js`, their tool sets, reduced `<user_info>`, result text with Agent ID (`agent/tools/task.js`), resume and self-fork | Check 2 for parent and child requests; self-fork follows owner question 4 |
| 11. Lifecycle | Background shell and subagent completion notifications (`agent/actions/background-task-completion-action-handler.js`), `notify_on_output`, AwaitShell (`agent/tools/core/await.js`: pattern, completion, timeout, `running_for_ms`), interrupt, UpdateCurrentStep | Check 1 for the notification and await texts; check 2 for timing: a completion arrives as a new user message after the turn ends, in interactive mode as well as RPC |
| 12. AskQuestion | Tool, real question in the OMP interface, answer envelope `User questions responses:` with the selected, freeform, skipped and no-answer forms (`agent/tools/core/ask-question/index.js`) | Check 1 for every answer form; a live answer returns that text |
| 13. Compaction | Provider-native compaction, the owner's choice: Codex compaction for GPT models, Claude Code compaction for Claude models | The compaction request and the request after it equal the captures in `reference/cursor/codex-prompts/compaction/` and `reference/cursor/claude-code-prompts/compaction/`, apart from the recorded differences |
| 14. Delivery | Short install instructions for this repository on stock OMP; final paired runs per GPT model; drift baseline for Cursor 3.25.6 | Check 2 for one GPT task end to end shows only agreed differences; Claude is checked as owner question 6 decides, because no Cursor request to a Claude model was captured; `TRACE.md` has evidence in every row |

Known blockers carried from FEASIBILITY.md: the developer role and subscription wire changes on Anthropic (A2a, X1, owner question 5), the unproven OpenAI API developer role (A2o), AwaitShell pattern and timeout (C4, stage 11), self-fork without in-flight messages (D3, stage 10, owner question 4).

## Owner questions

Open at the stop; none was asked yet.

1. Dynamic catalog: some catalog tools need Cursor's closed services (WebSearch, SearchConversations, ConnectScm, SetActiveBranch, Cursor's MCP namespaces). Proposal: build the tools with a local implementation in the Cursor code (AwaitShell, Subagent, TodoWrite, CreateGoal, UpdateGoal, Delete, EditNotebook, WebFetch, FetchMcpResource for the user's own MCP servers) and leave the service-backed ones out of the catalog. Alternatives: also keep WebSearch with a substitute search provider (a difference from Cursor), or list them without a working backend (not allowed: no fakes).
2. Subagent types: proposal: explore, generalPurpose, shell, bugbot, security-review, ci-investigator and best-of-n-runner, whose prompts and tools exist locally; leave out browser-use (no browser) and cursor-guide (answers about the Cursor product). Alternative: all captured types.
3. Claude edit tools: proposal: StrReplace and Write for Claude, as Cursor's code chooses for Anthropic, with their descriptions from the code (not captured). Alternative: keep ApplyPatch for Claude as now.
4. Self-fork (FEASIBILITY D3): OMP's public API forks only the persisted session, without the parent's in-flight tool call and the context messages. Proposal: fork from the session file and add the missing parent messages to the child's context, recorded as a difference until a check shows the child sees the whole conversation. Alternative: leave self-fork out.
5. Anthropic prompt placement (FEASIBILITY A2a, X1): OMP sends `developer` messages to Anthropic as `user`. Proposal: keep the prompt as the system prompt after the provider's Claude Code identity block, as stage 4 does, recorded as a difference. Alternative: send it as the first `user` message.
6. Claude verification: no Cursor request to a Claude model was captured, because the capture adapter serves only OpenAI requests. Proposal: check Claude requests against this repository's own contract and record them as unverified against Cursor. Alternative: build a Claude capture path for the adapter and pair Claude runs as for GPT.
7. Claude prompt source: the owner decided that Cursor's Claude prompt is unavailable and that Claude prompts come from the Claude Code conversion. The local Desktop code renders a prompt for Claude models (`agent/prompts/default.js`, with Opus and Sonnet branches); it was not rendered or compared. Proposal: keep the approved conversion. Alternative: render Cursor's own Claude prompt from the local code and use it instead.
