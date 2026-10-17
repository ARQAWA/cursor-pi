# OMP remaster

The remaster rebuilds the researched Cursor agent mechanically on stock OMP, stage by stage per [PLAN.md](PLAN.md), against the source-backed contract in [CONTRACT.md](CONTRACT.md). `reference/` holds the preserved Cursor evidence and prepared prompts; the package reads only the prompt files in `reference/prepared-prompts/` and the tool definitions in `reference/cursor/prompts/tools/toolset-bb31022a144f.json`, and no other part of `reference/`.

The package is `package.json` with one extension, `extensions/remaster.ts`, and the tool code in `lib/tools/`; it uses only OMP's public extension API. Done so far: stage 1, the reference contract; stage 2, a clean base that sends no tools and no system prompt of its own; stage 3, the check of what OMP's public API can reproduce, in [FEASIBILITY.md](FEASIBILITY.md); stage 4, the prepared model prompts and Cursor's captured message layout; and stage 5, Cursor's basic tools Shell, Glob, rg, ReadFile and ApplyPatch. Work on OMP stopped after stage 5; see the status in [PLAN.md](PLAN.md).

## Launch

Replace `<remaster>` with the absolute path of this checkout:

```sh
omp --no-extensions --no-skills --no-rules --no-lsp --no-title \
  --system-prompt '' -e <remaster>
```

Add `-p '<prompt>'` to run one prompt without the interactive interface. For GPT-6.1 Sol, `--remaster-rc rc1` or `--remaster-rc rc2` loads a release candidate prompt instead of the baseline; the flag has no effect on other models.

## What the model receives

| Model id (provider ignored, `@…` suffix dropped) | Prompt file in `reference/prepared-prompts/` |
|---|---|
| `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | `<id>.md` |
| `gpt-6.1-sol` with `--remaster-rc rc1` / `rc2` | `gpt-6.1-sol-rc.md` / `gpt-6.1-sol-rc2.md` |
| `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (also with `.5`) | `claude-<name>-5-5.md` |

Any other model gets no prompt, and OMP shows a warning. The prompt file is sent byte for byte.

Each request, in Cursor's order:

1. The prompt as a `developer` message, with no system prompt and no `instructions`. On Anthropic the prompt is the system prompt instead (see the gaps below).
2. A `user` context message: `<user_info>` with `OS Version`, `Shell` (when `SHELL` is set), `Workspace Path`, `Is directory a git repo: Yes, at <root>`, `Today's date` and `Terminals folder`, then, when the repository has changes, `<git_status>` with the trimmed `git status --porcelain` output. The text is built at the first request of a conversation, stored in the session and reused, so it is a snapshot as in Cursor.
3. Every user message as `<timestamp>Friday, Oct 16, 2026, 10:04 AM (UTC+3)</timestamp>\n<user_query>\n…\n</user_query>`, with the message's own local time. A message sent while a reply is running goes out in the same form, without OMP's steering envelope; this was checked in RPC mode, not in the interactive interface.

The extension sets `PI_CODEX_WEBSOCKET=0` for its process, so Codex requests use SSE and carry the whole conversation without `previous_response_id`.

Gaps against the captures:

- Not sent: the persistent agent stores, `<agent_transcripts>` and `<rules>` (Cursor services), `<agent_skills>` (OMP skills are off), `<available_subagent_types>` and `<available_subagent_models>` (stage 10) and `<dynamic_tool_catalog>` (stage 9).
- Outside a git repository the repository line is left out; the captures show only repositories.
- Time zones with a non-whole-hour or zero offset are written `UTC+5:30` and `UTC+0`; the captures show only `UTC+3`.
- Cursor's wire form of a message sent during a running reply was not captured.
- Anthropic: OMP sends `developer` messages to Anthropic as `user`, so the prompt goes as the system prompt, after the Claude Code identity line of the provider constraint below. The extension removes the date and working-directory reminder that OMP adds to a non-empty system prompt and recomputes the billing fingerprint.
- The OpenAI API (non-Codex) `developer` role is unproven (FEASIBILITY.md row A2o).

## Tools

The model gets exactly five tools, in Cursor's order: `Shell`, `Glob`, `rg`, `ReadFile` and `ApplyPatch`. Before each OpenAI Responses request leaves (OMP's `openai-responses`, `openai-codex-responses` and `azure-openai-responses` APIs), the extension replaces every tool definition with its entry from `reference/cursor/prompts/tools/toolset-bb31022a144f.json`, so names, descriptions, schemas, `strict: false` and ApplyPatch's Lark grammar are the captured bytes; it drops any other tool, sets `parallel_tool_calls: true` and sends each tool result as `[{"text":…,"type":"input_text"}]`. `Glob` is registered as `CursorGlob` and renamed on the wire, because OMP would otherwise activate its own `glob`. ApplyPatch's grammar form needs a model whose OMP catalog entry allows custom tools, as every GPT-5.5 or later entry of the `openai` and `openai-codex` providers does (FEASIBILITY.md row B1a). Requests of other APIs, Anthropic included, keep OMP's own tool serialization (see the gaps below).

Results take these forms:

| Tool | Result |
|---|---|
| ReadFile | The file with every tenth line numbered as `    10\|`; `... N lines not shown ...` before and after a window set by `offset` (negative counts from the end) and `limit`; `Error: File not found`; `File is empty.` |
| Glob | `Result of search in '<root>' (total N files):` and `- <path>` lines, newest first; after 100 files `... K more files ... (Do a more specific search if needed)`. A pattern without `**/` gets it prepended. |
| rg | `<workspace_result workspace_path="<cwd>">` around file blocks with `  N:` match and `  N-` context lines; `head_limit` and `offset` with `[Showing H of at least T matching lines. Use offset=… to see more, or narrow the search.]`; `No matches found`. |
| ApplyPatch | One Add or Update section; `Success. Updated the following files:\nA <path>` or `The file <path> has been updated.` |
| Shell | `Exit code: …`, the output in a fenced block, `Command completed in … ms.` and the persistence line, with ` Current directory: …` when `working_directory` was given. Commands run through `eval` in the shell named by `SHELL`, and the working directory and environment carry over between calls. `block_until_ms: 0` starts a background job and returns its Shell ID, PID and terminal file `<id>.txt` in `Terminals folder`, which is `~/.omp/remaster/projects/<slug>/terminals` with the workspace path as `<slug>`, its slashes turned into dashes and no leading dash, as in Cursor's `~/.cursor/projects/<slug>/terminals`. The file has Cursor's header and footer and is rewritten every 5 seconds while the command runs. |

Gaps and unresolved limits against the captures:

- The table shows the forms of the captures and the tool descriptions, apart from the parts named below. Any other result or behavior, such as an error or an edge case, is the remaster's own and was not captured.
- Size limits: ReadFile's description mentions a character limit, Shell's says that large output is saved to a terminal file, and REPORT.md observed Glob cut near 5 000 characters and rg near 15 000 with a `[Results truncated. Showing … Use offset=…]` line. Their sizes and full wording are not captured; the remaster cuts Glob at 100 files, applies no character cap and returns Shell output whole. Glob and rg read at most 256 MB of ripgrep's output and return an `Error: …` result for a search that prints more.
- Images and PDFs: ReadFile's description promises image reading and PDF text, but no such result was captured; the remaster returns an error for them.
- Not captured, written by the remaster:
  - errors as `Error: …`: every ApplyPatch error; every ReadFile, Glob and rg error except ReadFile's missing file, a directory given to ReadFile included; ApplyPatch Add over an existing file; a Shell call without `block_until_ms: 0` in a missing working directory (`Error: working directory does not exist: …; the command did not run`);
  - Glob: a search with no match (`total 0 files`) and the ignore rules: files are listed as `rg --files` lists them, without ignored and hidden files;
  - rg: count mode (`<path>:<count>`), the files-mode truncation line (`matching files`), context group separators (left out), and `offset`, `.gitignore` and `.cursorignore`, which follow the description; a `.cursorignore` at the workspace root is passed to rg as an ignore file;
  - ApplyPatch: Add into a missing directory (created) and line matching, which falls back to ignoring trailing and then surrounding whitespace;
  - Shell:
    - a missing `SHELL`, which falls back to `/bin/sh`;
    - the terminals folder, which lies under `~/.omp/remaster/projects/` where Cursor uses `~/.cursor/projects/`;
    - Shell IDs, which count from 1 in each terminals folder; the captured IDs 103043 and 103044 only show a rise by one;
    - the position of `pid:` in the terminal file header: it comes first, as in the example in the captured prompts' `<terminal_files_information>`;
    - the terminal file of a command that ended: status `success` after exit code 0 and `failed` after any other code, and the form of the footer line `exit_code: N`, whose field AwaitShell's captured description names; Sol call 0052 shows `failed` with an `error:` footer line for a command that did not start;
    - parallel calls, which start as separate processes from the same directory and environment; the one that ends last sets them for the next call;
    - a command started in the background, moved there or cancelled, which leaves the working directory and environment of later calls unchanged, as does a command that ends the shell itself, such as with `exit`;
    - a cancelled call, which returns exit code 130 with the output so far;
    - a command that outlives `block_until_ms` (default 30 000 ms), which moves to the background with `Command is still running after N ms and was moved to the background.` before the background text.
- Glob's order direction: the captures show modification-time order but not its direction; newest first is used.
- ApplyPatch's description mentions an optional rename, but the captured grammar has no rename line, so the model cannot send one and the remaster has none.
- Other APIs get the five tools as OMP serializes them from the reference descriptions and parameters, and Glob keeps its internal name `CursorGlob`, because neither OMP nor the extension renames it outside the OpenAI Responses requests. On Anthropic, which takes no grammar tools, ApplyPatch is an ordinary tool with one string parameter `input`, subscription access puts `_` before the tool names (see the provider constraint below), and results go out in OMP's form. No Cursor request to a Claude model was captured.
- Shell's `notify_on_output` and completion notifications are stage 11; `request_smart_mode_approval` and `smart_mode_block_reason` belong to Cursor's closed Auto-review and are accepted and ignored.
- Approvals: Cursor's approval flow, with the Auto-review classifier and the native approval card that Shell's parameter descriptions name, is closed and was not captured; the tools declare OMP's approval tiers instead: read for Glob, rg and ReadFile, write for ApplyPatch and exec for Shell.
- Cursor's own `parallel_tool_calls` value is not in `reference/` (the capture adapter logged `false` for a missing value and did not keep the raw request body); the remaster sends `true`.
- Key order: the capture adapter's logs, which stay on the development machine, write the keys of every JSON object in alphabetical order, the adapter's own record fields included, so the captures do not show Cursor's key order. The tool definitions and the `input_text` part of each tool result go out in the captured order; every other request object keeps OMP's order.

## What the model no longer receives

| Removed | By |
|---|---|
| Extensions that OMP would load by itself, including the old harness listed in the owner's settings; skills, rules and OMP's LSP integration | `--no-extensions`, `--no-skills`, `--no-rules`, `--no-lsp` |
| OMP's own system prompt or a `SYSTEM.md` in its place, such as the old harness's; project context files such as `AGENTS.md`; OMP's system notes such as the Computer Use note | The extension replaces the whole system prompt in every turn: with an empty one, or on Anthropic with the prepared prompt alone. `--system-prompt ''` keeps OMP from reading a `SYSTEM.md` while it builds the prompt that the extension then replaces. |
| Every OMP tool | The extension activates only its five tools at session start, drops every other tool definition from each OpenAI Responses request and empties the tool list of the Codex `additional_tools` item. |
| OMP's `<system-reminder>` with the date and working directory | OMP adds it only when the system prompt is not empty. The extension sends an empty one, except on Anthropic, where it removes the reminder from the request. |
| Session-title requests | `--no-title` |


## Provider constraint

For Anthropic subscription (OAuth) access, OMP puts two blocks before the system prompt: the billing header `x-anthropic-billing-header: cc_version=…; cc_entrypoint=cli; cch=…;` and the identity line `You are Claude Code, Anthropic's official CLI for Claude.` The remaster keeps both. With the same access OMP puts `_` before the names of the five tools in the request, such as `_Shell`, and removes it from the model's tool calls; the remaster keeps that too. OMP computes the header's fingerprint from the first user message. Because the extension sends the prepared prompt as the system prompt, OMP also adds its reminder; the extension removes it from the request and recomputes the fingerprint from the first user message as sent, so the header matches the request.

## Not changed yet

- Context compaction and the idle recap still run as OMP's settings say: the owner's settings turn the recap off, and stage 13 adds the provider-native compaction the owner chose.
- The package starts no child session, because OMP's `task` tool is off and Cursor's subagents come in stage 10, so the package does not yet meet the child-session half of the stage 2 criterion. Stage 3 showed that a child built through OMP's SDK with the options in FEASIBILITY.md row A3 sends no OMP overlays; stage 10 adds the subagents that way and checks their requests.

## Verification

Stage 5: on installed OMP 18.10.1, live `-p` runs of `openai-codex/gpt-6.1-sol` with the launch flags and a recording extension loaded last, in a test git repository, sent the five reference tool definitions in Cursor's order with `parallel_tool_calls: true`, and the model called every tool. The results had the forms in the table above: ReadFile whole, windowed, from the end, missing and empty; Glob with and without `target_directory` and the 100-file cut; rg content, files, `head_limit` and no match, with an ignored directory left out; ApplyPatch Add and Update; Shell with `working_directory`, carried-over directory and environment, exit code 127 and a background job with its terminal file. Asked for two reads in parallel, the model sent both calls in one response; asked for two three-second Shell commands in parallel, it did the same, and both commands ran at the same time. That run and a later single read sent each tool result as `[{"text":"…","type":"input_text"}]`; the earlier runs had `type` before `text`. With `anthropic/claude-sonnet-5-5` the request carried the five tools as `_Shell`, `_CursorGlob`, `_rg`, `_ReadFile` and `_ApplyPatch`, ApplyPatch with the single parameter `input`, and the model's `_ReadFile` call got the file's text back. Not run: a foreground command that outlives `block_until_ms`, and the interactive interface.

Stage 4: on installed OMP 18.10.1, live `-p` runs with the launch flags and a recording extension loaded last sent, for `openai-codex/gpt-6.1-sol` (baseline, `rc1`, `rc2`) and `openai-codex/gpt-6-luna`, the matching prompt file byte for byte as the `developer` message, then the context message, with `<git_status>` only in a repository with changes, then the wrapped prompt, with no `instructions`, `previous_response_id` or tools (stage 5 added the tools). For `anthropic/claude-sonnet-5-5` the system blocks were the billing header, the Claude Code identity line and the prompt file, with no OMP reminder, and the request was answered. A second prompt with `-c` resent the same context text and the whole history, each prompt with its own timestamp. In RPC mode a message sent during a reply went out as a plain wrapped user message.

Stage 2, before the prompts, the context message and the tools existed: on installed OMP 18.10.1, runs with `-p --no-session` loaded a test extension last; it recorded the outgoing request after the other request hooks and then aborted the run:

- With the launch flags, which then included `--no-tools`, each request had no tool definitions, no `tool_choice`, no reminder, and the prompt as its only message. The OpenAI Responses and Codex requests had no system text; the Claude request had only the two Anthropic blocks above, and its billing fingerprint matched the prompt. This held for a local test model in the OpenAI Responses and Codex request shapes, in an empty project with a separate new OMP agent directory, and for `openai-codex/gpt-6.1-sol` and `anthropic/claude-sonnet-5-5` in the owner's environment: a project with an `AGENTS.md` and the owner's OMP settings, which list the old harness as an extension.
- With the package but without `--no-tools` and `--system-prompt`, the request in the owner's environment still had no tools and no system text.
- Without the package and `--system-prompt`, the request in the owner's environment carried the old harness's `SYSTEM.md` and a project-context developer message with `AGENTS.md`; with `--no-tools` also left out, it carried 11 tools and the Computer Use note.

One live request each to `openai-codex/gpt-6.1-sol` and `anthropic/claude-sonnet-5-5` with the launch flags answered `ok`.
