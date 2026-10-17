# Cursor T4 capture (2026-10-16): Plan, Debug, Ask, summarize

Source: adapter log `kimi-codex-proxy-73117.jsonl` (24,191 lines). T4 is every `incoming_request` after 10:20 (UTC+3): 74 requests in 4 sessions, all `incoming_model = gpt-5.5`, upstream `gpt-6.1-sol`, between 10:25:21 and 10:32:59. The log was silent for 10 minutes after 10:32:59. The folder was produced by streaming the log and keeping each distinct text once; the layout matches `../runs-2026-10-16-T3/`.

## Which chat is which

The conversation id comes from the `cursor_agent_stores/<id>` path inside each `<user_info>` block. The owner gave `35834585…` and `e38cb780…`; the log shows two more.

| Session | Conversation id | Requests | Time (UTC) | First user query | Mode actually seen | Tools array |
|---|---|---|---|---|---|---|
| S1 | `35834585-f561-44e9-b86e-ae98a9449508` | 19 | 07:25:21–07:26:52 | "Составь план добавления в модуль workers/wallet повторных попыток…" | **Agent**: no mode reminder; the model's `SwitchMode(plan)` was rejected | `tools-1` (8 tools) |
| S2 | `e38cb780-0574-4ec5-a930-4e8dd5dd0ae3` | 23 | 07:25:26–07:27:56 | "Разберись, почему wallet_sync может пропускать кошельки…" | **Agent**: no Debug reminder | `tools-1` |
| S3 | `73e640d3-b952-44eb-ac06-16c3e212e0df` (the id the owner did not list) | 11 | 07:25:49–07:26:45 | "Что делает workers/wallet и как он связан с wallet_sync?" | **Agent**: no Ask reminder | `tools-1` |
| S4 | `3b530fd7-8e54-4a54-b72e-8ba090968695` (a second Plan chat, started 10:28) | 21 | 07:28:03–07:32:59 | the same plan query as S1 | **Plan** | `tools-2` (9 tools) |

`sessions.json` holds the same mapping in machine-readable form.

## Checklist

| Item | Appeared? | Where |
|---|---|---|
| Plan mode reminder | **Yes** (S4 only) | `roles/01-plan-mode-reminder.txt` (full `<system_reminder>`, ends with `<begin_plan_mode/>`); in context as the second user message, `items/017-S4-user-d4efb4aa.txt`, placed before the `<timestamp>`/`<user_query>` block. It tells the model not to edit, to ask questions via `AskQuestion` first, and to finish with `CreatePlan`. It contains a `<mermaid_syntax>` block. |
| Plan-mode addition to the developer prompt | **Yes** (new) | The S4 developer message (19,719 chars, `items/015-S4-developer-ec703596.txt`) equals the Agent one (19,362 chars, `items/001-S1-developer-260171f2.txt`) plus a `<plan_mode_guardrails>` block: only edit markdown files, stay in plan mode while refining, call `SwitchMode(target_mode_id=agent)` before non-markdown edits. Diff: `roles/02-plan-mode-developer-prompt-added-block.diff`. |
| Plan tool schema (CreatePlan) | **Yes** | In `tools/tools-2-13103e63.json` (object with `name: "CreatePlan"`; parameters `name`, `overview`, `plan` (required), `todos[{id, content}]`). It is a top-level tool, not a dynamic one. |
| CreatePlan call | **Yes** | `calls/071-S4-CreatePlan.md`: arguments `{name:"Wallet Exponential Retry", overview, plan (markdown, ~4 KB), todos[4]}`. |
| CreatePlan output | **Did not appear** | The call is the last event of S4 (request 73); the follow-up request that would carry the tool output never arrived. `calls/071` says so. |
| Text sent after Build | **Did not appear** | No request after the CreatePlan call, so no Build message, no `<end_plan_mode/>` and no switch to agent. The log's last S4 request ends with the `AskQuestion` answer (`calls/057-S4-AskQuestion.md`). |
| Tools array: Plan vs Agent | **Yes** | Plan (`tools-2`) = Agent (`tools-1`) + `CreatePlan`, inserted after `AskQuestion`. The other eight tools are byte-identical: Shell, Glob, rg, ReadFile, ApplyPatch, AskQuestion, GetDynamicTools, CallDynamicTool. Plan mode does not remove any tool; ApplyPatch and Shell stay available. `tools/INDEX.json` lists both. |
| Debug mode reminder | **Did not appear** | S2 has only `<user_info>` and `<timestamp>`+`<user_query>` (`items/005`, `items/006`). The word "debug" appears only inside the generic system prompt and the `SwitchMode` description. |
| Debug tools | **Did not appear** | S2 uses the Agent array `tools-1`; it called ReadFile, rg, Glob and Shell (`calls/048`–`050`: `python` not found, then `python3`). No log or instrumentation tool exists. |
| Ask mode reminder | **Did not appear** | S3 has no reminder (`items/010`, `items/011`); the Ask-mode text known from T3 (`../runs-2026-10-16-T3/roles/07-ask-mode-reminder-seen-in-bugbot.txt`) is absent. |
| Ask tools | **Did not appear** | S3 uses `tools-1` (Agent set). |
| `/summarize` and the context summary | **Did not appear** | No `/summarize` message and no `<summary`, compaction or "conversation summary" item in any request. S2 has one user turn (23 requests); the line «Продолжай: кратко повтори вывод.» is nowhere in the log. The exact compacted input form is therefore unknown. |
| `ReadLints` | **Did not appear** | The string is absent from the whole log. |
| Other new reminder or notification | **No** | `<system_notification>` occurs only as text inside the system prompt. The only reminder in T4 is the Plan one. |
| Other new tool | **No** | Only `CreatePlan`. `SwitchMode` is still a dynamic tool (`calls/001-S1-GetDynamicTools.md`: Agent and Plan "switchable", Debug and Ask "cannot switch to this mode"; allowed ids `plan`, `agent`). |

## Other facts

- **Why S1–S3 look like Agent chats.** All three share the same developer prompt (`items/001`, `004`, `009`, hash `260171f2`), the same tools array and no reminder. S1 shows the cause for Plan: the model called `SwitchMode{target_mode_id:"plan"}` (`calls/003-S1-CallDynamicTool.md`) and got "Mode switch was rejected by the user. Do not attempt to switch modes again." Plan mode arrived only in S4, which opened with the reminder from its first request. Debug and Ask left no trace in the traffic for this model.
- **S4 flow.** The model read files (`calls/051`–`056`), asked two questions with `AskQuestion` (`calls/057`: scope after the limit is exhausted; retry parameters; the answers come back as `[{"text": "User questions responses:\nQuestion scope: Selected option(s) success\nQuestion policy: Selected option(s) default", "type": "input_text"}]`), read more files, then called `CreatePlan`.
- **`user_info` in S4** lacks the `<git_status>` block that S1–S3 have (`T3_probe.py` untracked); otherwise the same fields.
- **Assistant text** of each session, taken from upstream events, is in `finals/`. S2's final answer is the Debug-query explanation, S4 has no assistant text after the plan call.
- **Tool call output format.** Outputs arrive as `[{"text": "...", "type": "input_text"}]`; `CallDynamicTool` output is the same wrapper.

## Layout

| Path | Content |
|---|---|
| `items/` | 19 distinct message texts (developer, user, assistant), verbatim, `INDEX.json` maps file → session, role, size, first-seen request. Name pattern `NNN-<session>-<role>-<sha1[:8]>.txt`. Developer and `user_info` messages repeat per session (the S1–S3 copies are identical apart from the store path). |
| `tools/` | 2 distinct `tools` arrays as JSON plus `INDEX.json`. The `instructions` field was empty in every request. |
| `calls/` | 71 tool calls with arguments and output, verbatim, first-seen order; `INDEX.json`. |
| `roles/` | Plan-mode material: the reminder and the developer-prompt diff. |
| `finals/` | Assistant `message` items taken from upstream events, per session. |
| `sessions.json` | Session key → conversation id, request count, time span, first query, observed mode, tools array. |

Redaction: the log's headers are already `<redacted>`, and no header records were used. A scan of this folder for `sk-…`, `Bearer …`, `eyJ…`, `ghp_…`, `AKIA…`, `access_token`/`api_key` values finds nothing. The words `password`, `token`, `authorization` appear only in repository source shown by ReadFile (a Rust Postgres config, a test fixture `value="token"`) and in the `GetDynamicTools` description. Nothing was removed.
