# Build status and plan

State at commit `84158db` and the commit that adds this file. Work stopped by the owner; it continues on his word.

## Goal

Cursor Pi is built in this repository on pinned Pi v1.3.0 and pushed to `ARQAWA/cursor-pi`. It covers stages 1-8 of the approved plan: Cursor prompt only, rules and AGENTS.md as in Cursor Desktop, permanent tools byte-exact with Cursor, the context message, dynamic tools, subagents, background work, compaction as in Codex and Claude Code, and a final request comparison. Each stage is done when its request matches the Cursor capture.

## Plan and state

| Stage | Result | State |
|---|---|---|
| 1. Cursor prompt only | Per-model Cursor prompt, nothing from Pi in the request, rules and AGENTS.md read as Cursor Desktop reads them | Done |
| 2. Permanent tools | Shell, Glob, rg, ReadFile, ApplyPatch, AskQuestion, GetDynamicTools, CallDynamicTool, UpdateCurrentStep with Cursor's names, descriptions, schemas, outputs and error texts; StrReplace and Write for Claude in ApplyPatch's slot | Done |
| 3. Context message | `user_info`, `git_status`, `agent_transcripts`, `rules`, `agent_skills`, the timestamp and `user_query` wrapper, transcripts in Cursor's format | Done |
| 4. Dynamic tools | Catalog, GetDynamicTools, CallDynamicTool, the user's MCP servers from `mcp.json` with OAuth, cursor namespace (TodoWrite, Delete, EditNotebook, AwaitShell, CreateGoal, UpdateGoal), local WebSearch, WebFetch, SearchConversations, the `cursor-ide-browser` namespace on local Chrome | Done |
| 5. Subagents | Subagent tool, the 8 Cursor types in the catalog, child sessions with their own transcripts, result texts, resume, self-fork, background subagents | Partial |
| 6. Background work | Completion notices, `notify_on_output`, output suppression, 1 MiB trimming, interrupt | Done, one gate open |
| 7. Compaction | Codex remote compaction for GPT models, Claude Code `short` arm for Claude models; Pi's own compaction never runs | Partial, check fails |
| 8. Final comparison | Paired live requests from Cursor Desktop and Cursor Pi | Not started, needs the owner's login |

## Owner decisions in this session

- Built-in Cursor tools (TodoWrite, Delete, EditNotebook, AwaitShell, CreateGoal, UpdateGoal) stay, because the real Cursor request carries them.
- `mcp.json` is read as Cursor reads it; no server is created by Cursor Pi.
- Tools that run on Cursor's servers get local backends with Cursor's names, descriptions and texts: «всё, что мы можем запилить самостоятельно, пилим самостоятельно. А всё, что не можем запилить, оставляем на потом и потом решим уже в итоге.»
  - WebSearch: the native web search of the current model's subscription.
  - WebFetch: fetched from this machine, HTML turned into markdown.
  - SearchConversations: searches Cursor Pi transcripts.
  - Browser: local Google Chrome over CDP, profile `~/.cursor-pi/browser`.
- Claude models get StrReplace and Write, as Cursor's code chooses for Anthropic.
- Plan mode and SwitchMode stay excluded ([D7](decisions.md)).

## Remaining work

1. Stage 5: the browser-use subagent on the `cursor-ide-browser` namespace; the best-of-n-runner worktree flow; generalPurpose's tool set as Cursor builds it; Cursor's texts for cloud placement and attachment rejections if they exist. The last subagent pass was stopped mid-run; its partial edits are in `84158db` and are not checked.
2. Stage 6: `notify_on_output` notices are recorded but not sent, because Cursor sends them only with the `enableBackgroundTaskProgress` flag and no capture proves it is on (`BACKGROUND_TASK_PROGRESS_ENABLED` in `extensions/cursor-pi/background/shell-notice.ts`).
3. Stage 7: finish compaction until `tools/check-compaction.mjs` passes. Last known failures: the Codex compaction request keeps the `developer` item; the Anthropic run fails with `Compaction cancelled` because the tool set changes mid-conversation.
4. Stage 8: the owner runs `bin/cursor-pi` and `/login` for ChatGPT and Claude; then paired requests are captured and compared.
5. Deferred, to decide with the owner at the end: ConnectScm, SetActiveBranch, `cursor-app-control`, `cursor-subscriptions`, `cursor-origin`, Cloud, Debug, Triage and Multitask modes.
6. Docs: update [project.md](project.md) "Boundaries of this preparation", the evidence cells in [traceability.md](traceability.md), [verification.md](verification.md) with the new checks, and a README section on running `bin/cursor-pi`.
7. Cleanup: about 75 transcript folders in the real `~/.cursor-pi/projects/` were written by check runs before the checks got a temp HOME.

## Checks

Every `tools/check-*.mjs` compares Cursor Pi with Cursor's own functions through `tools/cursor-oracle.mjs` or with captures. Run each with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/check-<name>.mjs`. The last full run before the final passes had every check green except `check-compaction`; no full run was made after the last subagent pass was stopped.

## How to continue

1. Run every check and note the failures.
2. Finish stages 5 and 7 by the remaining work above.
3. Ask the owner to log in, then run stage 8.
