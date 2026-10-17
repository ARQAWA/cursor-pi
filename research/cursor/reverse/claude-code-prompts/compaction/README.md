# Claude Code context compaction (`/compact`)

What Claude Code 2.1.301 sends to the model to summarize a conversation, and what the next request looks like afterwards. Recorded on the wire with the capture proxy of `../scripts/`, extended to save responses (`scripts/capture-proxy.mjs`). Request files are verbatim apart from the redactions at the end.

## Capture facts

| Item | Value |
|---|---|
| Version | 2.1.301 (`~/.local/bin/claude`, `DISABLE_AUTOUPDATER=1`), `User-Agent: claude-cli/2.1.301 (external, cli)` for the TUI and `(external, sdk-cli)` for `-p` |
| Model | `claude-opus-5-5` (context window 1,000,000, so automatic compaction could not be reached cheaply; only manual `/compact` was captured) |
| Account | claude.ai login, Max subscription, first-party API |
| Date | 2026-10-16, 11:15–11:22 UTC, empty temp directories |
| Runs | `tui/`: real TUI in a pty, session `575a4a85-4cc5-43ea-8e19-9bc9884e04db`. `print/`: `claude -p --resume <id>` per step, session `2f36ecb7-cf3e-4e97-8d76-46d6e202e3fe`. `print-with-tools/`: same with `--allowedTools Bash Read`, session `23a4b637-0ceb-491c-a112-5776787499ac` |
| Conversation (tui, print) | `say ok` → `ok`; `What is 17 plus 25? Answer with the number only.` → `42`; `Name one primary color of light. One word.` → `Red`; then `/compact`; then `What was the very first thing I asked you in this session, and what were your answers? Be brief.` |
| Conversation (print-with-tools) | ``Run `ls` with the Bash tool …`` (Bash tool call), ``Read alpha.txt with the Read tool …`` (Read tool call), `/compact`, a question about the earlier turns |

## Files

Each request directory has `request.body.json`, `request.headers.json`, `system.json` + `system/NN.txt`, `tools.json`, `messages.json` + `messages/NN-<role>[-PP].txt` (same layout as `../`). Compaction and post-compaction directories also have `response.sse.txt` (the streamed body), `response.headers.json` and `response.text.txt` (the assistant text only).

| Path | Content |
|---|---|
| `tui/compact-request/` | The summarization request sent by `/compact` in the TUI. `messages/06-user-01.txt` is the compaction instruction. `response.text.txt` is the returned summary. |
| `tui/post-compact-request/` | The next user turn after compaction. `messages/00-user.txt` is the summary as fed back. |
| `tui/turn1-request/`, `tui/turn3-request/` | First request of the session and the third turn, for comparison (the third turn is a `thread: continue` request with only the new messages). |
| `print/compact-request/`, `print/post-compact-request/`, `print/turn1-request/` | The same for `claude -p --resume`. The instruction is `messages/06-user-01.txt`. |
| `print-with-tools/compact-request/`, `print-with-tools/post-compact-request/` | A session with `Bash` and `Read` tool calls. The instruction is `messages/09-user-01.txt`. |
| `prompts/arm-*.txt`, `prompts/partial-*.txt` | All compaction instruction variants, rendered from the code in the binary (see below). `arm-short.txt` is what the TUI sent, `arm-control.txt` is what `-p` sent; both are byte-identical to the wire text. |
| `prompts/prompt-builder.min.js` | The exact byte range of the 2.1.301 binary that builds these texts. `scripts/render-arms.mjs` runs it. |
| `transcript-compact-boundary.json` | The `compact_boundary` record from each session transcript (`~/.claude/projects/.../<session>.jsonl`) and the messages it lists as preserved. |
| `scripts/` | `capture-proxy.mjs` (proxy that also saves responses), `save-responses.mjs`, `run-print.sh`, `drive-compact-tui.py`, `render-arms.mjs`. |

## 1. The summarization request

A normal request of the same agent, with one text part added to the last user message. No separate summarizer system prompt is used.

| Field | Value |
|---|---|
| Endpoint, model | `POST /v1/messages?beta=true`, the session's model (`claude-opus-5-5`), `max_tokens` 128000, `stream: true`, `thinking` and `output_config` as in the main turns |
| `system` | The same four blocks as the main agent's first request, byte-identical text (identity line, core instructions, session guidance). Only block 0 (billing line) changes, and the two `cache_control` entries lose `ttl: "1h"` |
| `tools` | The full main-agent `tools` array, unchanged (16 tools in the TUI, 13 in `-p`). The instruction forbids tool calls and Claude Code denies any tool call during compaction |
| `messages` | The whole conversation so far, as the main agent holds it (message 0 with the `<system-reminder>` context parts, the environment message, every turn, tool calls and results, the `<total_tokens>` system messages) — **except the last round** (see section 3). A `cache_control: ephemeral` marker sits on the last assistant message that is included, so the request reuses the prompt cache of the main thread (the TUI request read 38,642 cached tokens and had 866 uncached input tokens) |
| Headers | The compaction request carries `x-claude-code-request-class: compaction`, `x-claude-code-compaction: manual` and `x-cc-compaction-request: manual` (main turns have `x-claude-code-request-class: main` and `x-claude-code-prompt-id`) |
| Instruction | Appended as an extra `text` part at the end of the last user message (after the user's text, which gets a trailing `\n`; after the `tool_result` block when the last message is a tool result). The only top-level differences from a main turn: no `thread` field (the full history is sent), `"fallbacks": "default"`, and `diagnostics.previous_message_id` points at the last assistant message that was included |

### The instruction text

Eight variants ("arms") exist in the binary. The arm is chosen by the experiment flag `tengu_curried_trinket` (cached in `~/.claude.json` as experiment `tengu_curried_trinket_external_experiment_v2`, variation 1, value `short` for this account) or by the environment variable `CLAUDE_CODE_CURRIED_TRINKET`; the default is `control`. In these captures the TUI sent `short` and `-p` sent `control`.

| Arm | File | Reply shape and content |
|---|---|---|
| `short` (TUI wire) | `prompts/arm-short.txt` | `<summary>` only. One paragraph listing six things to keep (problems and how they were resolved, options tried or set aside, anything asked, decided or ruled out stated exactly, where things stand, what is open, hard-to-reconstruct details), user words close to verbatim, own reasoning condensed |
| `control` (`-p` wire) | `prompts/arm-control.txt` | `<analysis>` block, then a `<summary>` with nine sections (Primary Request and Intent … Optional Next Step), with a structure example |
| `no_scratchpad` | `prompts/arm-no_scratchpad.txt` | The `control` text without the `<analysis>` step |
| `no_scratchpad_capped` | `prompts/arm-no_scratchpad_capped.txt` | Same, "in 2000 words or fewer" |
| `no_scratchpad_keep_asks` | `prompts/arm-no_scratchpad_keep_asks.txt` | Same, plus "if the transcript begins with an earlier summary, copy its record of what the user asked for unchanged" |
| `lean` | `prompts/arm-lean.txt` | Tells the model that its reply replaces everything above and lists what the next window keeps: system prompt, project instructions and memory files; up to five most recently read files re-read from disk; the plan, loaded skills, status of background agents and shells; the transcript path when there is one |
| `short_v2` | `prompts/arm-short_v2.txt` | `short` plus the keep-asks sentence; its `resume-guidance` paragraph is added to the fed-back summary |
| `capped` | `prompts/arm-capped.txt` | "Summarize the entire conversation above in 2000 words or fewer …" |

All arms start with the same block (`CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.` and four bullets), end with `REMINDER: Do NOT call any tools. …`, and (except `lean`) carry the security-constraints paragraph. `/compact <text>` inserts `Additional Instructions:\n<text>` before the closing reminder (`prompts/arm-control.with-custom-instructions.txt`, rendered offline, not captured). The message selector's "summarize from here / up to here" uses `prompts/partial-from.txt` and `partial-up_to.txt` (rendered offline, not captured).

### Response

Plain streamed text, no tool call, no thinking block: `<summary>…</summary>` (`short`) or `<analysis>…</analysis>` followed by `<summary>…</summary>` (`control`). The TUI summary says the third question "has not been answered yet": the model did not see its own last answer (see section 3).

## 2. How the summary is fed back

The next request after compaction starts a new thread (`"thread": {"type": "create"}`, full `system` and `tools` again; the system text and tools are byte-identical to the first request, `cc_version` hash changes from `.b14` to `.fb5`). In the TUI the request also carries the headers `x-claude-code-context-compacted: manual` and `x-cc-context-compacted: manual`; the `-p` request does not, because each `-p --resume` call is a new process. Its `messages` (`tui/post-compact-request/`):

| # | Role | Content |
|---|---|---|
| 0 | `user` (string) | The summary message: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.` + blank line + `Summary:` + the text between `<summary>` tags (the `<analysis>` block and the tags are removed) + blank line + `If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: <path of the session .jsonl>` + `Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.` + blank line + `The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.` |
| 1 | `system` | Empty `content: []` with `output_config: {"effort": "medium"}` |
| 2 | `assistant` | The kept tail, verbatim (here `Red`; in `print-with-tools/` `alpha.txt says "hello from alpha".`) |
| 3 | `user` | The two `<system-reminder>` context parts (`userEmail`, commit attribution) that normally sit in the first message, then `<local-command-caveat>…`, `<command-name>/compact</command-name>…`, `<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>`, then the new user text |
| 4 | `system` | The context message rebuilt from scratch: files read earlier re-read from disk (`Called the Read tool with the following input: … Result of calling the Read tool: …`, `print-with-tools/` only), deferred-tool list, agent types, MCP server instructions, environment block, model line, `tool_addition` definitions, `<total_tokens>`, date (the `-p` run also repeats the skill list; the TUI run does not) |

Nothing else of the old conversation is sent: no earlier user message, no tool call or result, no earlier assistant message. The summary holds the only record of them, and the transcript path points to the full history on disk.

## 3. What stays verbatim

Only the last round. The binary splits the history into rounds (a new round starts at each assistant message with a new message id; a round is that assistant message plus the user or tool-result messages that follow it). It summarizes all rounds but the last and keeps the last round unchanged. For a conversation that ends with an assistant reply, the last round is that single reply, so one message survives. `transcript-compact-boundary.json` lists it under `preservedMessages` (the TUI record also lists a local `turn_duration` marker that is never sent). If the summarization request is too long for the context window, the binary retries with more rounds kept and fewer summarized (the step is sized from the reported token gap); when no round is left to summarize, a last resort summarizes everything and drops the oldest part of the head, up to three times. That path did not run here.

## 4. Binary reading (not captured on the wire)

- Manual `/compact` runs `compactManually` → the reactive compaction function (`kdo`, rounds in `zEe`, fork request in `AWr`) with `maxTurns: 1`, `querySource: "compact"` and the main thread's system prompt and tools. A background precomputed summary is reused when one is ready and no custom instructions are given; no precomputed summary was used here (a compaction request was sent).
- The binary also holds an older full-compaction function (`Gyr`, used by automatic compaction in some configurations and by in-process teammates). It summarizes everything and keeps nothing. Its request function (`Sbn`) first tries the shared-cache request described above and falls back to a fresh request with the system prompt `You are a helpful AI assistant tasked with summarizing conversations.` and a reduced tool list. None of this ran in the captures, and automatic compaction was not triggered.

## Redactions

Same as `../README.md`: `metadata.user_id` `device_id` and `account_uuid`, and the account e-mail address, are replaced by `<REDACTED_DEVICE_ID>`, `<REDACTED_ACCOUNT_UUID>`, `<REDACTED_USER_EMAIL>`; `Authorization`, `x-api-key` and cookie header values are `<REDACTED>`. In the response headers `anthropic-organization-id` and `anthropic-workspace-id` are replaced by `<REDACTED_ORG_ID>` and `<REDACTED_WORKSPACE_ID>`. Local paths, the macOS user name in them and the session ids are kept.
