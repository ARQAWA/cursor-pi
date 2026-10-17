# Cursor T3 capture (2026-10-16): review subagents, Plan, Debug, summarize

Source: adapter log `kimi-codex-proxy-73117.jsonl` (28.7 MB, 9,998 lines, 60 `incoming_request` records, all `incoming_model = gpt-5.5`, upstream `gpt-6.1-sol`). All activity falls between 10:04:15 and 10:07:40 (UTC+3); the log was silent for more than 10 minutes afterwards. The folder was produced by streaming the log line by line and keeping each distinct text once.

## Which chat is which

The log's `session_key` is a hash, not a Cursor conversation id. The conversation id was recovered from the `cursor_agent_stores/<id>` path inside each `<user_info>` block, and cross-checked against the first user query.

| Session | Conversation id | Requests | Time (UTC) | First user query | Tools array |
|---|---|---|---|---|---|
| S1 `eac0b8c9…` | `98ed0054-102c-4b4a-b26e-38d8f13da48b` | 13 | 07:04:15–07:05:49 | "Это проверка твоих субагентов ревью…" (create `T3_probe.py`, launch bugbot and security-review) | `tools-1` (8 tools) |
| S2 `29e58609…` | `abcb1a25-b784-47b3-8986-98cfc90385c9` | 16 | 07:04:28–07:05:39 | "Составь план добавления в модуль workers/wallet повторных попыток…" | `tools-1` |
| S3 `26d2c600…` | `3406fb66-1e5a-4280-86ac-1c90717c71c6` | 21 | 07:04:36–07:07:02 | "Разберись, почему wallet_sync может пропускать кошельки…" | `tools-1` |
| S4 `5d33e085…` | `98ed0054…` (subagent of S1) | 2 | 07:04:51–07:04:56 | "You are reviewing local code changes for bugs…" (bugbot) | `tools-2` (4 tools) |
| S5 `df8dbf21…` | `98ed0054…` (subagent of S1) | 8 | 07:04:56–07:05:26 | "Perform a security review of these local code changes…" (security-review) | `tools-3` (5 tools) |

`sessions.json` holds the same mapping in machine-readable form.

## Checklist

| Item | Appeared? | Where |
|---|---|---|
| Bugbot role | **Yes** (S4) | `roles/03-bugbot-developer-prompt.txt` (developer prompt, 2,680 chars), `roles/05-bugbot-user-query-template.txt` (user message with the review instructions), `roles/01-S4-d7821ab0.txt` (subagent reminder) |
| Security-review role | **Yes** (S5) | `roles/04-security-review-developer-prompt.txt` (1,801 chars), `roles/06-security-review-user-query-template.txt`, `roles/02-S5-312b78e2.txt` (subagent reminder plus `<progress_reporting_instructions>` for `UpdateCurrentStep`) |
| Any other new subagent type | **No** | Only `bugbot` and `security-review` were launched. The parent's `<available_subagent_types>` lists eight types (generalPurpose, explore, browser-use, cursor-guide, ci-investigator, bugbot, security-review, best-of-n-runner), in `items/002-S1-user-f2fc311e.txt`. |
| Plan mode reminder | **Did not appear** | No "Plan mode is active" text anywhere in the log. S2 ran in the default Agent mode; the model called `SwitchMode(target_mode_id="plan")` and the user rejected it (`calls/006-S2-CallDynamicTool.md`: "Mode switch was rejected by the user. Do not attempt to switch modes again."). |
| Plan tool schema and call (CreatePlan) | **Did not appear** | The string `CreatePlan` is absent from the log. A dynamic-tool search for `[Pp]lan\|CreateGoal` (`calls/011-S2-GetDynamicTools.md`) found only `cursor/CreateGoal`. S2 delivered the plan as ordinary assistant text (`finals/S2-assistant-messages.md`). |
| Text sent when leaving Plan via Build | **Did not appear** | S2 never entered Plan mode, so no Build step exists in the log. |
| Debug mode reminder | **Did not appear** | No Debug-mode text in the log. S3 ran as an ordinary Agent chat with the same tools and the same two user messages (`user_info`, `timestamp` + `user_query`). `SwitchMode`'s description says Debug is "cannot switch to this mode" (`calls/004-S2-GetDynamicTools.md`). |
| Context summary after `/summarize` | **Did not appear** | No `/summarize` message, no summary item and no `<summary` block in any request. S3 contains no follow-up user message. |
| `ReadLints` | **Did not appear** | The string `ReadLints` is absent from the log; no tools array contains it. |

Other facts confirmed by this capture:

- **Subagent launch.** The parent loads `~/.cursor/skills-cursor/review-bugbot/SKILL.md` and `review-security/SKILL.md` (`calls/001`, `calls/002`), fetches the `Subagent` schema via `GetDynamicTools` (`calls/003`), then calls `CallDynamicTool{namespace:"cursor", toolName:"Subagent", arguments:{description, subagent_type, run_in_background:true, prompt}}` (`calls/012`, `calls/015`). The prompt is `Full Repository Path: …\nDiff: uncommitted changes\nCustom Instructions: …`. The tool output carries a transcript path `…/agent-transcripts/<parent-id>/subagents/<agent-id>.jsonl` and the agent id.
- **Completion notice.** Each finished subagent arrives in the parent as a user message containing `<system_notification>` with `<task>` (kind, status, task_id, title, tool_call_id, agent_id, detail) followed by a `<user_query>` telling the model to do any follow-up (`items/021`, `items/023`).
- **Subagent message layout.** `developer` = role prompt; `user` 1 = `<user_info>` (8 KB, shorter than the parent's 24 KB); `user` 2 = `<system_reminder>` "Ask mode is active…" (`items/014`, bugbot and security-review both); `user` 3 = `<system_reminder>` "You are running as a subagent under a parent agent…" (`items/015`, `items/018`); `user` 4 = `<timestamp>` + `<user_query>` with the review template and the diff.
- **Subagent tool sets.** Bugbot: `Glob, rg, ReadFile, WebSearch`. Security-review: the same plus `UpdateCurrentStep`. Neither has Shell or edit tools. The parent (and S2, S3) have `Shell, Glob, rg, ReadFile, ApplyPatch, AskQuestion, GetDynamicTools, CallDynamicTool`.
- **Subagent output format.** Bugbot answers in an `<answer><bug>…</bug></answer>` XML block (`finals/S4-assistant-messages.md`). Security-review ends with an `UpdateCurrentStep` call carrying `completed_subtitle` and `final_summary` (`calls/038-S5-UpdateCurrentStep.md`).
- **Delete is a dynamic tool.** `GetDynamicTools{namespace:"cursor", toolName:"Delete"}` then `CallDynamicTool{…toolName:"Delete", arguments:{path}}` (`calls/041`, `calls/044`).
- **System prompt.** The parent's developer message (19,362 chars) is byte-identical to `../runs-2026-10-16/gpt-5.5/system-prompt-19362.md`. It tells the model to call `SwitchMode` when another mode fits (line 55); `GetDynamicTools{pattern}` also works as a regex search over dynamic tools.

## Layout

| Path | Content |
|---|---|
| `items/` | 26 distinct message texts (developer, user, assistant), one file each, verbatim. `INDEX.json` maps file → session, role, size, first-seen request. Name pattern: `NNN-<session>-<role>-<sha1[:8]>.txt`. |
| `tools/` | 3 distinct `tools` arrays as JSON (`tools-1` parent, `tools-2` bugbot, `tools-3` security-review) plus `INDEX.json`. The log's `instructions` field was empty in every request, so there are no instruction files. |
| `calls/` | 53 tool calls with arguments and output, verbatim (`NNN-<session>-<tool>.md`), in first-seen order; `INDEX.json` lists them. |
| `roles/` | Subagent role material: reminders, developer prompts and user-query templates for bugbot and security-review, plus the Ask-mode reminder both subagents receive. |
| `finals/` | Assistant `message` items taken from upstream events, per session. This is the only place the last assistant answer of each chat appears, because the next request that would carry it never came. |
| `sessions.json` | Session key → conversation id, request count, time span, first query, tools array. |

Redaction: no Authorization headers, keys or tokens are in the log records used here. A grep for `sk-`, `Bearer `, `access_token`, `authorization`, `api_key` over this folder finds only unrelated code words (`CancellationToken`, "authentication and authorization checks" in the security prompt, a test fixture `value="token"`). Nothing was removed.
