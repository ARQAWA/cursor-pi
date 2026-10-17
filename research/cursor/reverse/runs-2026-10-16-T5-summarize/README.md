# T5: manual /summarize in Cursor chat 3b530fd7 (model gpt-5.5)

Chat: `3b530fd7-8e54-4a54-b72e-8ba090968695`, workspace `superbot-test-Gd9Ld3YH`, Cursor 3.25.6.
All times are local (UTC+3), 2026-10-16.

## Result

The summarize request did NOT reach the adapter (`kimi-codex-proxy`, pid 73117, `127.0.0.1:18080`).
Cursor sent it to its own backend, so none of these were captured:
- the summarization prompt text,
- the summary text the model returned,
- the first request after the summary (how the compacted history is fed back).

## Evidence that it happened (Cursor-side logs only)

| Time | Source file here | What it shows |
|---|---|---|
| 14:43:39.374 | `cursor-renderer-composer-14.43-14.49.log` | `buildRequestedModel composerId=3b530fd7… catalogModelId=gpt-5.5 … maxMode=false` |
| 14:43:39.388 | `cursor-agent-host.log` line 12 | `Selected Agent Host turn runtime {"runtime":"connect","disposition":"expected","reason":"managed-local-unavailable",…,"generationUUID":"fce67cfa-c247-4b0c-a6db-fa1af760555e","actionCase":"summarizeAction","modelId":"gpt-5.5"}` |
| 14:43:39.404 | `cursor-structured-logs.log` line 64 | `[nal_agent_retries] Initial request … actionCase=summarizeAction requestId=fce67cfa-… runtime=agent_host` |
| 14:44:04.297 | `cursor-renderer-composer-14.43-14.49.log` | `renderer conversation root write … reason=agent_checkpoint … fields=summary:added:0->1,summary:added:0->1,tool_state:removed:1->0,other:removed:259->3,other:changed:1->1,other:added:0->1` (a `summary` field appears in the conversation state; 259 `other` entries collapse to 3) |
| 14:44:04.552 | `cursor-structured-logs.log` lines 66-67 | stall detector dump (line 66): inbound message order ends `kvServerMessage (x2)` → `interactionUpdate:turnEnded` → `conversationCheckpointUpdate (x2)`, and before that `interactionUpdate:summary`, `interactionUpdate:summaryCompleted`; outbound `kvClientMessage:setBlobResult`, `clientHeartbeat`. Line 67: `Request successful … actionCase=summarizeAction` |
| 14:44:04.551 | `cursor-agent-host-storage.log` line 4 | `Turn terminal blob reads … count 0` |

Reading: `summarizeAction` is a separate action type in Cursor's agent protocol (stream `nal`, runtime `agent_host`, transport `connect`), not a chat request carrying a "please summarize" prompt. The server streams `interactionUpdate:summary` / `summaryCompleted` and checkpoint updates; the summary text itself is not in any local log I could find. The run took about 25 s (14:43:39 → 14:44:04). The transcript file `~/.cursor/projects/…/agent-transcripts/3b530fd7…/3b530fd7….jsonl` was rewritten at 14:44:04 (150 lines; line 149 is a user message beginning `<available_subagent_types>` and ending with `<dynamic_tool_catalog>`); it contains no summary text. The chat had 39 turns.

Cursor also restarted its extension hosts at 14:43:33 ("Restarting extension hosts after idle stop due to focus"), so the logs above are from the new session `…T144334_*`.

## Adapter log state (`adapter-log-state.txt`)

`/var/folders/cf/…/T/kimi-codex-proxy-73117.jsonl` had 55290 lines when the watch started (14:14 local) and still 55290 at 14:51. Its last write is 10:58:05 (`time_ms 1792137485154`, downstream `[DONE]` of the previous chat's request). No new line, no `request_received` or `incoming_request` of any kind, appeared during or after /summarize. No newer `kimi-codex-proxy-*.jsonl` exists. The proxy process was alive and listening the whole time.

## Not observed

- The summarization instructions/input (server side, Cursor backend).
- The summary text (only its existence as a `summary` field and `interactionUpdate:summary` events).
- Any post-summary request: no further turn reached the adapter or showed in Cursor logs before the capture ended, so how the compacted history (summary item, verbatim tail) is fed back to the model is unknown. The `other: 259 -> 3` checkpoint change hints that most history entries are dropped from the stored conversation state, but this is an inference, not a captured request.

## Files

- `cursor-agent-host.log`, `cursor-agent-host-storage.log`, `cursor-structured-logs.log`: complete copies of the Cursor extension-host logs for session `…T144334_f30c2d05` (workspace window), verbatim.
- `cursor-renderer-composer-14.43-14.49.log`: lines from `composer.log` and both `renderer.log` files between 14:43 and 14:49, truncated to 700 chars per line.
- `adapter-log-state.txt`: size, line count and last-write facts for the adapter log.

Secret check: grep for `sk-`, `Bearer`, `eyJ`, `api_key`, `refresh_token` over this folder found nothing.
