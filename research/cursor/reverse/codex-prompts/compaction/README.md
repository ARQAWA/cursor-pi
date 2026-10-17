# Codex CLI context compaction: source and live capture

How OpenAI's Codex CLI (`openai/codex`) compacts context: the prompt text, the request it sends, the summary it gets back, and the shape of the next request. Captured on 2026-10-16 with model `gpt-5.6-sol` over a ChatGPT login.

## Result in short

Codex has two compaction paths. The provider decides which one runs.

| | Remote path ("compaction v2") | Local path |
|---|---|---|
| Used when | provider is the built-in `OpenAI` provider (ChatGPT login or API key) or an Azure Responses provider | any other provider, or `capabilities.remote_compaction = "unsupported"` in a custom `[model_providers.*]` |
| Prompt text sent | none. The request ends with an item `{"type":"compaction_trigger"}`; the summarizing instruction lives server-side and is not visible | `prompts/templates/compact/prompt.md`, sent as one extra final `user` message (`compaction-prompt.md` here) |
| Endpoint | the normal `POST /backend-api/codex/responses` | the normal `POST …/responses` |
| What comes back | one `compaction` output item with an opaque `encrypted_content` (about 2.7 KB here; 96 output tokens reported) | a `reasoning` item (encrypted) and an assistant `message` with the plain-text summary (105 output tokens) |
| How the result is fed back | the `compaction` item is appended after the retained user messages and is sent as is in every later request | the summary text is prefixed with `summary_prefix.md` plus `\n` and stored as a `user` message after the retained user messages |

`/compact` in the TUI took the remote path with the default setup. Only the local path exposes a readable prompt and a readable summary, so the prompt file and the summary prefix are the only compaction texts Codex itself contains. Auto-compaction (token limit, before a turn, mid-turn, after a turn) builds the same two request shapes; only manual `/compact` was captured.

## Files

| Path | Content |
|---|---|
| `compaction-prompt.md` | The compaction prompt, byte-exact (426 bytes, ends with a newline). It matches the text captured on the wire. |
| `summary-prefix.md` | The summary prefix, byte-exact (399 bytes, no trailing newline). It matches the wire text. |
| `source/head-6ae8b8aa7c/` | Verbatim source files at `openai/codex` `main`, commit `6ae8b8aa7c608730d4315d59c5c081897ae02780` (2026-10-16T06:06:54Z), repo paths preserved. |
| `source/rust-v0.162.0-alpha.17.2-740e5af33c/` | The same files at tag `rust-v0.162.0-alpha.17.2`, commit `740e5af33c71225640e0c1c1555c514c2c93ab74`. This is the build that was run. `compact_remote_v2_installation.rs` does not exist at this tag. |
| `live/remote-compaction_gpt-5.6-sol/` | Live session on the remote path (ChatGPT login, built-in provider). |
| `live/local-compaction_gpt-5.6-sol/` | Live session on the local path (custom provider with `remote_compaction = "unsupported"`). |
| `live/tools/` | The logging proxy (`proxy.mjs`), the TUI driver (`drive_tui.py`), the config generator (`mkhome.sh`), the exporter (`export.py`) and the two `config.toml` files used. |

Source files saved from both refs: `codex-rs/prompts/templates/compact/prompt.md`, `…/summary_prefix.md`, `codex-rs/prompts/src/compact.rs`, `codex-rs/core/src/compact.rs` (local path, history rebuild, retention), `core/src/compact_remote_v2.rs`, `core/src/compact_remote_v2_attempt.rs` (builds the request, pushes `CompactionTrigger`), `core/src/compact_remote_history.rs`, `core/src/tasks/compact.rs` (`/compact` entry, path choice), `core/src/context/compaction_summary.rs` (summary as a `user` message with no markers), `model-provider/src/capabilities.rs` and `model-provider-info/src/capabilities.rs` (which provider gets which path). Both text templates are byte-identical at both refs (SHA-256 `ab0c334d…` for the prompt, `e9b088e7…` for the prefix) and last changed in `ba2b67f9cd` (2026-06-01, which moved them to this path). Core `.rs` files differ between the two refs.

## Source behavior

Both texts, verbatim:

```
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

```
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

The user can replace the prompt with `compact_prompt` or `experimental_compact_prompt_file` in `config.toml` (local path only).

**Local path** (`core/src/compact.rs`, `run_compact_task_inner_impl`):
1. Clone the history and append the prompt as a `user` message.
2. Send it as an ordinary Responses request without tool declarations. On `ContextWindowExceeded`, drop the oldest history item and retry.
3. Take the last assistant message of the response as the summary. Store `SUMMARY_PREFIX + "\n" + summary` (or `(no summary available)` when empty).
4. New history: the base-instruction prefix, then the user messages of the old history (newest first, up to 20,000 approximate tokens; a message that has images or does not fit is cut down to its truncated text), then the summary as the last `user` message. Earlier summaries are recognised by `SUMMARY_PREFIX + "\n"` and are not retained as user messages, so summaries do not nest. All assistant messages, reasoning and tool calls are discarded.
5. A warning event is shown: "Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible…".

**Remote path** (`core/src/compact_remote_v2*.rs`):
1. Take the full prompt history, push `ResponseItem::CompactionTrigger {}` and send it with the normal Responses request (same prefix, so the prompt cache is reused: 11,008 of 12,907 input tokens were cached). The header `x-codex-beta-features: remote_compaction_v2` is present.
2. The stream must contain exactly one `compaction` output item (events `response.output_item.added`, `response.compaction.compacting`, `response.output_item.done`), otherwise Codex fails the compaction.
3. New history: retained items (user messages and hook prompts; agent messages up to 10,000 tokens; client-authored developer messages and client tool outputs only behind feature flags), kept newest first within `RETAINED_MESSAGE_TOKEN_BUDGET = 64_000` tokens, then the `compaction` item last.

Both paths then call `build_compaction_replacement_history`: fresh initial context (developer messages and `<environment_context>`) is rebuilt from the current session and inserted before the last real user message (`insert_initial_context_before_last_real_user_or_summary`), and the window counter increases (`x-codex-window-id` `<thread>:0` becomes `<thread>:1`).

## Live capture

**Method.** The installed Codex CLI is the one bundled in ChatGPT.app (`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, `codex-cli 0.162.0-alpha.17.2`; there is no `codex` on `PATH`). A temporary `CODEX_HOME` held a symlink to `~/.codex/auth.json` and a minimal `config.toml` (`live/tools/config.*.toml`) with the model, `approval_policy = "never"`, a read-only sandbox, and either `openai_base_url` (remote run) or a custom provider (local run) pointing at `http://127.0.0.1:<port>/backend-api/codex`. `live/tools/proxy.mjs` forwards every request to `https://chatgpt.com` and logs it. The interactive TUI ran in an empty directory, driven through a pty by `drive_tui.py`: turn 1, turn 2, `/compact`, turn 3.

| Turn | Text sent |
|---|---|
| 1 | `Pick any one fruit at random and reply with only its name, one word. Do not use tools.` → `Mango` |
| 2 | `What is 17 plus 25? Reply with only the number. Do not use tools.` → `42` |
| `/compact` | slash command |
| 3 | `Which fruit did you pick earlier? Reply with only its name, one word. Do not use tools.` → `Mango` in both runs |

The answer `Mango` appears only in an assistant message, which Codex drops from the new history. Its recovery shows the compaction item (remote) or the summary text (local) carried the state.

**What worked and what did not.**
- Both runs worked. Files are named `NN-<kind>.json` (request headers and parsed body, response headers) and `NN-<kind>.response.sse` (raw SSE). `NN` is the order the proxy saw the request; gaps are the model-catalog `GET /models` fetches, which were left out.
- With the built-in provider, Codex first tries a WebSocket to `ws://…/responses`. The proxy answers `426`, so Codex falls back to HTTPS SSE (`02-` and `04-websocket-upgrade-refused.json`). The WebSocket transport itself was not captured.
- Each first turn is followed by a `title-generation` request (model `gpt-5.6-luna` on the remote run) that is unrelated to compaction.
- The local run needs a custom provider because the built-in one cannot switch paths. Compared with the built-in provider, the request has no `content-encoding: zstd`, the title model is `gpt-5.6-sol`, and the `additional_tools` item is shorter (25,490 vs 36,321 characters).
- **GPT-5.5 cannot be captured.** The backend rejects it for a ChatGPT login: `{"detail":"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."}` (HTTP 400). Those attempts are not saved. The source treats GPT-5.5 the same way; the model entry sets `use_responses_lite: false`, so tools travel in the top-level `tools` field instead of an `additional_tools` input item.

**Request shapes** (`input` items; `at` = `additional_tools` item holding the tool schemas, `dev` = developer message, `usr` = user message):

| Request | Remote run | Local run |
|---|---|---|
| Turn 2 (before) | `at`, `dev` base instructions, 3 `dev` context messages, `usr` `<environment_context>`, `usr` "Pick…", assistant "Mango", `usr` "What is 17…" | same, 9 items |
| Compaction | the 9 items above, assistant "42", then `{"type":"compaction_trigger"}` (11 items) | `at` removed (no tools), the 9 items, assistant "42", then `usr` = compaction prompt (10 items) |
| Turn 3 (after) | `at`, `dev` base instructions, `usr` "Pick…", re-injected `dev` context (permissions, skills, collaboration, apps, plugins, multi-agent), `usr` `<environment_context>`, `usr` "What is 17…", `compaction` item, `usr` "Which fruit…" (10 items) | `at`, `dev` base instructions, `usr` "Pick…", re-injected `dev` context, `usr` `<environment_context>`, `usr` "What is 17…", `usr` summary, `usr` "Which fruit…" (10 items) |

Other fields (`model`, `reasoning {"effort":"low","context":"all_turns"}`, `store:false`, `include:["reasoning.encrypted_content"]`, `prompt_cache_key`, `text.verbosity:"low"`, `client_metadata`) are the same on all requests. The request header `x-codex-turn-metadata` carries `request_kind: "compaction"` and `compaction: {trigger: "manual", reason: "user_requested", implementation: "responses_compaction_v2" | "responses", phase: "standalone_turn", strategy: "memento"}` on the compaction request, and `window_number` goes from 0 to 1 on the next turn.

**Summary returned by the local run** (`live/local-compaction_gpt-5.6-sol/09-compaction.response.sse`, assistant message, `phase: "final_answer"`):

```
## Handoff Summary

- User first requested a random fruit, one word, without tools. Response: `Mango`.
- User then asked “What is 17 plus 25?”, requesting only the number and no tools. Response: `42`.
- No tools were used.
- No active task remains.
- User prefers strict adherence to concise output-format instructions when specified.
```

Sent back in `10-post-compaction-turn-1.json`, `input[8]`, role `user`: the prefix text, `\n`, then the summary above. The remote run returns `{"type":"compaction","id":"cmp_…","encrypted_content":"gAAAA…"}` instead, and `08-post-compaction-turn-1.json` `input[8]` is that same item.

## Redactions

Dropped or replaced: `authorization`, `chatgpt-account-id`, cookies (`[REDACTED]` in request headers, dropped in response headers), the `x-codex-turn-state` routing token, the account's plan, credit balance and usage-limit response headers, the installation id of the temporary `CODEX_HOME` (`[REDACTED-INSTALLATION-ID]`). Every string value in `auth.json`, the installation ids, and JWT, `Bearer` and `sk-` patterns were searched for in all saved files with no hit. The `encrypted_content` of `compaction` and `reasoning` items is server output and is kept as received; it belongs to a throwaway session. Working directories were temporary directories under `/private/tmp/codexcompact`.
