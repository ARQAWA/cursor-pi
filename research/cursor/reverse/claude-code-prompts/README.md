# Claude Code system prompts and tools

Requests that the Anthropic Claude Code CLI sent to the Anthropic Messages API, recorded on the wire: the system blocks, the `tools` array, and the context messages that Claude Code puts in front of the user's text. They are kept for later comparison with the prompts of other coding agents. Nothing was reformatted in `request.body.json` and in the `system/` and `messages/` text files; the redactions are listed in the last section.

## Capture facts

| Item | Value |
|---|---|
| Claude Code version | 2.1.294. Every captured request carries `User-Agent: claude-cli/2.1.294 (external, cli)` (`sdk-cli` for the `-p` run), and the billing block of the system prompt says `cc_version=2.1.294.<hash>`. The process was `~/.local/share/claude/versions/2.1.294`. |
| Main-agent model | `claude-opus-5-5` ("Opus 5.5"), the default of the account: claude.ai login, Max subscription, first-party API (`api.anthropic.com`), no `~/.claude` directory (so no user settings or CLAUDE.md) before the first run, no project files in the working directory. `max_tokens` 128000, `thinking` `{"type":"adaptive","display":"omitted"}`, `output_config.effort` `medium`, permission mode auto. |
| Subagent model | `claude-opus-5-5` (inherited). |
| Helper models | `claude-haiku-5-5` (session title), `claude-haiku-4-5-20251001` (quota check), `claude-opus-5-5` (prompt suggestion). |
| Capture date | 2026-10-16, 09:13–09:16 local time (06:13–06:16 UTC), macOS 26 (Darwin 25.6.0), arm64. |
| Source | New runs. Nothing from the earlier material was usable (see Method). |

## Method

**Existing material, not used.** `/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/tmp.nYLKqglBdx/` holds omp (oh-my-pi) sessions that call `anthropic/claude-sonnet-5-5` through omp's own prompt; it has no request that Claude Code sent. The tracing script `/Users/arkadijcukavin/Documents/ChatGPT/oh-my-pi/scripts/claude-trace.ts` (implementation: `packages/coding-agent/src/cli/claude-trace-cli.ts`) runs `claude` behind a local HTTPS-intercepting proxy (`HTTPS_PROXY` plus `NODE_TLS_REJECT_UNAUTHORIZED=0`), but it needs `bun` and omp's native PTY package (`bun` is not installed), prints the `Authorization` header, and keeps only the first non-haiku `/v1/messages` exchange. Its approach was reused in a standalone Node script.

**Proxy.** `scripts/capture-proxy.mjs` listens on `127.0.0.1`, answers `CONNECT api.anthropic.com:443` with a throw-away self-signed certificate, saves the decoded body and the headers of every `POST /v1/messages*`, and forwards the request unchanged to `api.anthropic.com` (the real OAuth token reaches Anthropic and is never written to disk; `Authorization`, `x-api-key`, `cookie` header values are written as `<REDACTED>`). All other hosts are tunnelled without inspection. Responses are not saved.

**Runs** (all with `HTTPS_PROXY`/`HTTP_PROXY` pointing to the proxy, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS=<proxy cert>`, `CLAUDECODE` unset, a fresh empty directory with two empty files `alpha.txt` and `beta.txt` as working directory):

1. `main-print/`: `claude -p "say ok"`. One main request.
2. `main-interactive/` and the rest: the real TUI (`claude`, entrypoint `cli`) started in a pty (`scripts/drive-tui.py`). The first-run onboarding was clicked through (theme, security notes, "trust this folder"), then the prompt `say ok`, then: *"Using the Agent tool, launch four subagents in parallel in one message, with subagent_type general-purpose, Explore, Plan and claude. Each one should only list the file names in the current directory and report them in one line. Then reply with the word done."*

`scripts/extract.mjs` split the raw captures into the files below.

## Files

Each directory holds the same set of files (a file is absent when the request has no such part):

| File | Content |
|---|---|
| `request.body.json` | The request body as sent, after the redactions. Byte-exact apart from them. |
| `request.headers.json` | Request headers in order, as `[name, value]` pairs. `Authorization` is `<REDACTED>`. `Content-Length` is the length of the unredacted body. |
| `system.json`, `system/NN.txt` | The `system` array (pretty-printed) and the exact text of each block, in order, with no newline added. |
| `tools.json` | The `tools` array, pretty-printed with 2 spaces. |
| `messages.json`, `messages/NN-<role>[-PP].txt` | The `messages` array (pretty-printed) and the exact text of each message or content part (`NN` message index, `PP` part index). |

| Directory | Request | Entrypoint / class | System blocks | Tools |
|---|---|---|---|---|
| `main-interactive/` | First request of the main agent in the TUI, thread `create` | `cli` / main | 4 | 16: Agent, Artifact, AskUserQuestion, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup, SendFeedback, Skill, ToolSearch, Workflow, DeferredToolPlaceholder, Write, advisor |
| `main-print/` | First request of `claude -p` | `sdk-cli` / main | 4 | 13: Agent, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup, Skill, ToolSearch, Workflow, DeferredToolPlaceholder, Write, advisor |
| `subagents/general-purpose/` | First request of the `general-purpose` subagent | `cli` / subagent | 3 | 11: Agent, Artifact, Bash, Edit, Read, Skill, ToolSearch, Write, DeferredToolPlaceholder, SubagentHandback, advisor |
| `subagents/claude/` | The `claude` subagent | `cli` / subagent | 3 | same 11 as `general-purpose` |
| `subagents/Explore/` | The `Explore` subagent | `cli` / subagent | 3 | 7: Bash, Read, Skill, ToolSearch, DeferredToolPlaceholder, SubagentHandback, advisor |
| `subagents/Plan/` | The `Plan` subagent | `cli` / subagent | 3 | same 7 as `Explore` |
| `auxiliary/session-title/` | Session naming call (`claude-haiku-5-5`, JSON-schema output) | `cli` / auxiliary | 3 | none |
| `auxiliary/prompt-suggestion/` | "Suggest what the user might type next" call, reuses the main system blocks and tools with the whole conversation (`claude-opus-5-5`) | `cli` / auxiliary | 4 | 16 |
| `auxiliary/quota-check/` | The one-token `quota` probe (`claude-haiku-4-5-20251001`) | `cli` / auxiliary | 0 | none |
| `thread-continuation/main-turn-2/` | Second user turn of the main agent, thread `continue` | `cli` / main | 1 | none |
| `thread-continuation/subagent-tool-result/` | Follow-up request of the `Plan` subagent carrying a tool result | `cli` / subagent | 1 | none |
| `scripts/` | `capture-proxy.mjs`, `drive-tui.py`, `extract.mjs`, `run-by-model.sh`, `compare-by-model.mjs` | | | |
| `by-model/` | Claude Code 2.1.301 on Opus, Sonnet and Haiku 5.5 (see "By model") | | | |

Sizes of the main files in bytes: `main-interactive/request.body.json` 106,334, `tools.json` 76,008, `system.json` 8,144; `main-print/request.body.json` 47,713, `tools.json` 31,350, `system.json` 6,940; subagent bodies 39,890 (Explore) to 73,754 (claude).

## What the captured requests show

- **System array.** Block 0 is a billing line `x-anthropic-billing-header: cc_version=…; cc_entrypoint=…; cch=…; cc_prompt_id=…` (it changes with every request). Block 1 is the identity line: `You are Claude Code, Anthropic's official CLI for Claude.` in the TUI, `You are a Claude agent, built on Anthropic's Claude Agent SDK.` in `-p` and in every subagent. Block 2 is the core instructions of the main agent (identical in the TUI and `-p`, `cache_control` scope `global`), and for a subagent the prompt of that agent type. Block 3 (main agent only) holds session guidance, memory instructions and the environment notes; the TUI and `-p` versions differ (5,865 and 4,669 bytes).
- **Messages.** Message 0 is a `user` message of three text parts: a `<system-reminder>` with the account context (`userEmail`), a `<system-reminder>` with the commit-attribution rule, and the user's text. A subagent has two more parts: its task prompt and a `<system-reminder>` about `SubagentHandback`. Message 1 is a `role: "system"` message (beta `mid-conversation-system`) with the environment (working directory, platform, shell, OS version, scratchpad), the list of deferred tools, the available agent types, the available skills, the MCP server instructions, and `<total_tokens>`. In the TUI and in subagents it also carries `tool_addition` parts, which are the definitions of the MCP tools `mcp__claude_ai_Claude_Docs__batch`, `__guide` and `__update` that the account's claude.ai connector provides.
- **Threads.** The first request of an agent has `"thread": {"type": "create"}` and carries system and tools. Later requests of the same agent have `"thread": {"type": "continue", "previous_message_id": …}`, one system block (the billing line) and only the new messages (`thread-continuation/`).
- **Deferred tools.** `ToolSearch` loads the schema of a deferred tool on demand. `DeferredToolPlaceholder` and `advisor` (`advisor_20260301`) are sent with `"defer_loading": true`.
- **Account-specific content.** The TUI capture includes content that depends on the logged-in claude.ai account: the connector `claude.ai Claude Docs` (instructions, five deferred and three added tools) and the `anthropic-skills:*` skills. The `-p` capture has none of it. The system blocks 1–3 and `tools.json` of the main agent do not depend on the account except through the memory path (`~/.claude/projects/<cwd>/memory/`) and the model ids.

## By model (2.1.301)

Claude Code 2.1.301 (`~/.local/bin/claude`, `DISABLE_AUTOUPDATER=1` in every run, `User-Agent: claude-cli/2.1.301 (external, sdk-cli)`) was captured on `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`; all three models were available to the account. Files are in `by-model/<model>/` with the layout described above: `main/` (first request of `claude -p "say ok"`), `subagents/Explore/` and `subagents/general-purpose/` (first request of each subagent, from one `claude -p` run that launched both in parallel). Every run used the same empty working directory (`/private/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/cc-by-model.F48Sbsa6eF/work`), the same proxy and the same redactions as the rest of this directory. The subagent prompt was: *"Using the Agent tool, launch two subagents in parallel in one message: one with subagent_type Explore and one with subagent_type general-purpose. Each one should only list the file names in the current directory and report them in one line. Then reply with the word done."* The subagent runs on the same model as the main agent (`model` is identical). `scripts/run-by-model.sh` runs one capture, `scripts/compare-by-model.mjs` prints the byte comparison below.

Each configuration was captured more than once (`say ok` runs / subagent runs: Opus 2 / 4, Sonnet 4 / 2, Haiku 2 / 2; every subagent run also yields a main request, 32 first requests in all); a difference is listed as a model difference only when it held in every run. Opus is the baseline.

| Part | Sonnet 5.5 vs Opus 5.5 | Haiku 5.5 vs Opus 5.5 |
|---|---|---|
| `main/` system[1] (identity line), system[2] (core instructions, `cache_control` scope `global`) | byte-identical | byte-identical |
| `main/` system[3] (session guidance, memory, environment notes) | byte-identical | **differs**: 8,199 bytes instead of 5,407. Haiku carries the Opus text plus 2,792 bytes inserted after the paragraph that ends "…give a recommendation, not an exhaustive survey" and before `<total_tokens>`: five paragraphs on what the reasoning-effort setting does not change, when to end a turn, when to ask before starting, that file edits are undoable so the choice is the model's, and how to handle a blocked part of a task |
| `main/` tools (13, same names and order on all three models) | 12 tools byte-identical; **`Agent` differs** | same as Sonnet: 12 identical, **`Agent` differs** (Haiku's `Agent` is byte-identical to Sonnet's) |
| `subagents/Explore/` system[1], system[2] (the 3,263-byte file-search prompt) | byte-identical | byte-identical |
| `subagents/general-purpose/` system[1], system[2] (the 2,720-byte prompt) | byte-identical | byte-identical |
| `subagents/Explore/` tools (6) | byte-identical | byte-identical |
| `subagents/general-purpose/` tools (9) | **`Agent` differs**, the other 8 identical | same as Sonnet |
| Messages, all three request kinds | message 0 part 1 (commit attribution) names the model: `Co-Authored-By: Claude Sonnet 5.5`; message 1 (environment) has the line "You are powered by the model named Sonnet 5.5. The exact model ID is claude-sonnet-5-5." Nothing else differs | the same two lines with `Haiku 5.5` / `claude-haiku-5-5` |

The `Agent` tool difference is its "When to use" section. Opus has one paragraph (1,668 characters for the whole description): "Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files… For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result." Sonnet and Haiku have four paragraphs (2,906 characters): a warning that a fresh agent costs more than it looks (handoffs drop detail, results come back confirmed, tokens are spent in bursts), the same "reach for this" rule with a side-quest case added, a "do the work yourself … when in doubt, don't spawn" paragraph, and a paragraph on how to brief the agent. The rest of the description and the input schema are identical.

Other facts that hold for all three models:

- The 12 other main tools, `Bash`, `Read`, `Skill`, `ToolSearch` and the rest, are byte-identical. `max_tokens` (128000), `thinking` (`adaptive`, `display: omitted`), `output_config` (`effort: medium`), `context_management`, `thread`, `diagnostics`, `stream` are identical.
- `anthropic-beta` carries the same 17 values (16 in subagent requests, which lack `extended-cache-ttl-2025-04-11`). Haiku lists `claude-code-20250219` sixth, after `prompt-caching-scope-2026-01-05`, instead of first.
- System block 0 (the billing line) differs in every request because of `cch` and `cc_prompt_id`; `cc_version=2.1.301.<hash>` depends on the entrypoint and is the same for all models.
- The task prompt of a subagent (message 0 part 2) is written by the main agent, so its wording differs per run ("List only the file names in the current directory (…/work), non-recursive…" on Opus, "(no recursion)" on Sonnet, "comma-separated" on Haiku).

**Variation between runs of the same model** (not model differences; one example of each kind is kept in `by-model/<model>/variants/`):

| Variation | Seen on | Effect |
|---|---|---|
| `claude.ai Claude Docs` connector not yet connected when the first request is built | main requests: Opus 3 of 6, Sonnet 4 of 6, Haiku 2 of 4 (never in subagent requests) | Message 1 of the main request has no `tool_addition` parts, no `mcp__claude_ai_Claude_Docs__*` names in the deferred list and no "MCP Server Instructions" section (19,334–19,338 bytes instead of 21,692–21,694). `main/` holds a run with the connector for every model; `variants/main-without-connector/` holds one without (the Haiku one comes from the subagent run, so its message 0 carries the subagent prompt) |
| `ListAgents` and `ReportFindings` in the tools of a subagent | Opus 1 of 4 runs, Sonnet 1 of 2, Haiku 1 of 2 | `Explore` gets 8 tools instead of 6, `general-purpose` 11 instead of 9, and the deferred-tool list of message 1 gains CronCreate, CronDelete, CronList, DesignSync, PushNotification and RemoteTrigger. `subagents/` holds a run without it for every model; `variants/subagents-with-ListAgents/` holds one with it |

Not captured in this part: the continuation requests of the runs, auxiliary requests (session title, quota check; the `-p` runs sent none), the subagent types other than `Explore` and `general-purpose`, the TUI, and the schemas of deferred tools. The 2.1.294 captures in the top-level directories (Opus 5.5 only) were not redone.

## Redactions

Applied to the raw body text before it was split into files:

| Replaced | By |
|---|---|
| `device_id` inside `metadata.user_id` | `<REDACTED_DEVICE_ID>` |
| `account_uuid` inside `metadata.user_id` | `<REDACTED_ACCOUNT_UUID>` |
| The account e-mail address in the `userEmail` system-reminder (message 0, part 0) | `<REDACTED_USER_EMAIL>` |
| `Authorization` header value (OAuth bearer token) | `<REDACTED>` (never written to disk) |

Everything else is as sent, including the local paths (`/Users/arkadijcukavin/…`, the temp working directories under `/private/tmp/cc-trace/`), the session id and the `safeguards.classifier_context` object of the TUI and `-p` main requests.

## Not captured

- Responses of the API (only requests were recorded).
- Schemas of the deferred tools. They are not part of the first request: in the TUI CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, NotebookEdit, RemoteTrigger, SendMessage, TaskStop, WebFetch, WebSearch, ArtifactComments, ArtifactData, EndConversation, EnterPlanMode, ExitPlanMode, Monitor, PushNotification and five more `mcp__claude_ai_Claude_Docs__*` tools; in `-p` the first twelve. No request that loads them through `ToolSearch` was made.
- Subagent types `statusline-setup` and `claude-code-guide` (listed in the agent-type section of message 1, never launched), and any custom or plugin agent.
- Other prompt families: context compaction (`/compact`), plan mode, the output style / learning-mode variants, hooks, slash-command prompts, skills bodies, the server-side `dangerous_tool_use` classifier (only the `safeguards` object that Claude Code sends to it is in the main requests).
- Most continuation requests of the run (only two examples are kept); they hold only new messages and no system prompt.
- Runs with a CLAUDE.md, a git repository, non-default settings or an API key instead of the claude.ai login.

## Side effects on the machine

The first interactive start created `~/.claude/` and `~/.claude.json` (none existed before) and recorded `/private/tmp/cc-trace/work-tui` as a trusted folder. During the session the Claude Code auto-updater installed 2.1.301 into `~/.local/share/claude/versions/` and repointed `~/.local/bin/claude` to it, so `claude --version` now prints 2.1.301. All captures come from processes that were already running 2.1.294.
