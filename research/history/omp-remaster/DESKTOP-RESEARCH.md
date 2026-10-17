# Cursor Desktop local code: research notes

What the installed Cursor Desktop app contains about its agent, read on 2026-10-17 for the remaster plan ([PLAN.md](PLAN.md)). This file holds module paths, function names, constant values and short texts only; no Cursor code is kept in this repository.

## Reference install

- Cursor Desktop 3.25.6, `/Applications/Cursor.app`, commit `f0df777c412b670d09e3eaf214967d779e67c080`.
- Agent bundles under `Contents/Resources/app/extensions/`:
  - `cursor-agent-host/dist/agent-host-daemon/dist/bin/daemon.cjs` (18.5 MB): the agent loop, prompts, tools, actions and summarization, as the `@anysphere` agent package;
  - `cursor-agent-host/dist/main.js`, `cursor-agent-exec/dist/main.js`, `cursor-local-agent-runtime/dist/main.js`: the host, tool executors and local runtime.

## Extraction method

1. Pretty-print `daemon.cjs` with Bun's transpiler into the OS temp folder (about 439 000 lines).
2. Split it at the esbuild markers `var init_x = __esm({ "<path>"() {` … `} });` into one file per module path: 2 603 modules, among them 414 under `agent/`, 239 under `agent-host/` and 15 under `agent-summarization/`. Module paths below are these marker paths without the `../` prefix and `dist/`.
3. The other three bundles have no such markers and stay as one pretty-printed file each.

A constant defined inside a module's init body belongs to that module; attributing a string by the nearest following marker can be off by one module.

## Runtime boundary

The daemon routes each turn to a runtime (`agent-host/agentAdapter/routing/local-loop-turn-router.js`, `agent-host/agentAdapter/shared/turn-router.js`): `connect` (Cursor's backend), `managed-local` (the local daemon) or `fail`. All 58 "Selected Agent Host turn runtime" lines in Cursor's logs on the development machine chose `connect` with reason `managed-local-unavailable`, so Cursor's backend built every captured request. The local package is the same agent code; its constants match the captures (Glob 5 000 and rg 15 000 characters, every tenth line numbered). The local code is the specification; where it differs from a capture, the capture wins.

Model-dependent behavior comes from server metadata (`managed-local-model.js`, `promptModelInfoFromWire`): `promptVersion` (`latest`, `gpt5-codex`, `haiku`, `codex-cloud`, `cursor-0226`, `dsv3-1018`, `dsv3-1205`), the vendor and flags such as `isGpt55`, `isGpt56`, `isOpus5`. The name the model is told to call itself defaults to `Cursor`.

## Code map

| Mechanism | Module | Notes |
|---|---|---|
| System prompt choice | `agent/prompts/system.js` `systemPromptGenerator` | GPT-5: `gpt5.js`; Codex family, GPT-5.5 and GPT-5.6: `codex.js`; Computer Use subagent: its own prompt; every other model, Claude included: `default.js`, with branches for Opus and Sonnet versions |
| Shared prompt blocks | `agent/prompts/gpt-helpers.js`, `agent/prompts/shared.js` | Captured system-prompt lines trace here |
| Context message | `agent/prompts/user-info.js` | `<user_info>`, `<git_status>` (`GIT_STATUS_CHARACTER_LIMIT = 10000`), `agent_transcripts`, `always_applied_workspace_rules`, agent-requestable rules, skills |
| Edit tools by model | `agent/configs/tool-config.js` `defaultAgentEditToolGenerator` | OpenAI GPT-5 family: ApplyPatch; Anthropic and others: StrReplace and Write; EditNotebook except Gemini 3 |
| Glob | `agent/tools/core/glob/glob.js` `formatFilesForGlob` | `TOTAL_CHARACTER_BUDGET = 5000`; `0 files found`; `at least`; `[Results truncated.` |
| rg | `agent/tools/core/grep/formatters.js` `buildResultFooter` | `GREP_CHAR_BUDGET = 15000`; `No files with matches found`; `Narrow the search to see the rest.`; `Error running tool: ` |
| ReadFile | `agent/tools/core/read/read.js`, `read/common.js` | `READ_LINE_NUMBER_INTERVAL = 10`; `READ_CHAR_HARD_LIMIT`; `Offset ${offset} is beyond file length (${totalLines} lines)`; `Cannot read binary files of type` |
| Omitted lines | `agent/tools/core/formatting.js` | `... N line not shown ...` for one line, `lines` otherwise |
| Shell | `agent/tools/core/shell/formatters.js`, `shell/shell.js` | `SHELL_CHAR_HARD_LIMIT = 20000`; `Command output has been written to:`; `Command aborted after`; `The command did not complete in Nms and was sent to the background.`; `DEFAULT_TIMEOUT_MS = 30000`; output notifications: debounce at least 5 s, pattern at most 500 characters |
| ApplyPatch | `agent/tools/core/edit/apply-patch.js` | `Invalid patch format. Your diff must begin with …`; `There was an error applying the patch, and it was NOT applied.` |
| AwaitShell | `agent/tools/core/await.js` | `DEFAULT_BLOCK_UNTIL_MS = 30000`; model name `AwaitShell`; `running_for_ms` refreshed every 5 s; `Prefer NOT to poll reflexively …` |
| Subagent | `agent/tools/task.js`, `agent/tools/core/subagent/*.js`, `subagent-config.js` | `Subagent is running in the background.`; `Agent ID: …`; resume sentinel `self`; types generalPurpose, explore, shell, browser-use, cursor-guide, debug, computerUse, videoReview, watchVideo, custom, plus bugbot, security-review and ci-investigator modules |
| Completion notices | `agent/actions/background-task-completion-action-handler.js` | `The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.`; `Perform any necessary follow-up actions in response to the subagent completion above.` |
| AskQuestion | `agent/tools/core/ask-question/index.js` | `User questions responses:`; `Question <id>: …` forms; `Questions skipped by the user, continue with the information you already have` |
| Dynamic tools | `agent/tools/mcp/get-mcp-tools.js`, `mcp.js` | Descriptions shortened to 200 characters ending `... [truncated]` |
| WebFetch | `agent/tools/core/web-fetch/web-fetch.js` | Fetches locally after an http/https URL check; long content goes to an agent tools file |
| WebSearch, SearchConversations | `agent/tools/core/web-search.js`, `search-conversations` | Call executors supplied by the host (`conversationSearchExecutorResource` is wired to the editor surface) |
| External summarizer | `agent-summarization/summarization-handler.js` | `SUMMARIZATION_SYSTEM_PROMPT` (`You are an intelligent assistant, tasked with summarizing the following conversation…`), `MORE_PROMPT`, and the summary prefix `[Previous conversation summary]:` (`PREVIOUS_CONVERSATION_SUMMARY_PREFIX`) |
| Self-summary by the working model | `agent/self-summary/` | Flavor from server metadata `selfSummaryFlavor`: `openai-compact`, `anthropic-explicit`, `xai-compact`; otherwise the external summarizer runs |

## Compaction texts against Codex and Claude Code

- `OPENAI_COMPACTION_PROMPT` (`agent/self-summary/openai-compaction-handler.js`) is Codex's local compaction prompt (`reference/cursor/codex-prompts/compaction/compaction-prompt.md`) plus ` Do not make any tool calls.` Its `SUMMARY_PREFIX` shares Codex's first sentence (`Another language model started to solve this problem and produced a summary of its thinking process.`) and then differs. User messages are kept up to `COMPACT_USER_MESSAGE_MAX_TOKENS = 10000` tokens.
- `CLAUDE_CODE_COMPACTION_PROMPT` (`agent/self-summary/constants.js`) equals, after whitespace normalization, the first 5 113 characters of Claude Code 2.1.301's compaction instruction after its no-tools preamble (`reference/cursor/claude-code-prompts/compaction/prompts/arm-control.txt`); Cursor then ends with its own no-tools reminder.

So Cursor's own self-summary is close to the provider-native compaction the owner chose; the native Codex remote path (`compaction_trigger`, encrypted result) is not in Cursor's code.

## `parallel_tool_calls`

The agent package never sets it; only the bundled AI SDK passes a provider option through. The prompts carry a `maximize_parallel_tool_calls` section. The capture adapter logs, per request, `request_received` (auth and model only) and `incoming_request` (the raw input array and its own parsed request, where a missing value becomes `false`), so the raw value Cursor's backend sent is not recoverable from the 309 logged requests.

## Captured lists

- Subagent types in the captured context (both runs of 2026-10-16): generalPurpose, explore, browser-use, cursor-guide, ci-investigator, bugbot, security-review, best-of-n-runner.
- `cursor` namespace catalog (`runs-2026-10-16/{sol,gpt-5.5}/cursor-namespace-catalog.json`): AwaitShell, ConnectScm, CreateGoal, Delete, EditNotebook, FetchMcpResource, SearchConversations, SetActiveBranch, Subagent, SwitchMode, TodoWrite, UpdateGoal, WebFetch, WebSearch.

## CLI exclusion

`reference/cursor/bench-luna/` came from the Cursor CLI (its runner spawned `agent -p --force --trust --model … --output-format stream-json`) and is not a source. Every other capture folder was matched to Desktop chats through `composerData:` rows in Desktop's `state.vscdb` and `~/.cursor/projects/*/agent-transcripts`.
