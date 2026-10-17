<user_info>
OS Version: darwin 25.6.0

Shell: zsh

Workspace Path: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH

Is directory a git repo: Yes, at /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH

Today's date: Friday Oct 9, 2026

Terminals folder: /Users/arkadijcukavin/.cursor/projects/Users-arkadijcukavin-PycharmProjects-superbot-test-Gd9Ld3YH/terminals

Available persistent agent stores:
- Current agent's store: /Users/arkadijcukavin/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/159ffaa4-db8e-4f8f-ace4-99103e93fd45/files
- User's personal store: /Users/arkadijcukavin/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/u469121329/files
Use normal file tools with these absolute paths to read or write store contents. When the user says "my user store" or "my personal store," use /Users/arkadijcukavin/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/u469121329/files. Only use stores listed here; omitted stores are unavailable.
</user_info>

<agent_transcripts>
Agent transcripts (past chats) live in /Users/arkadijcukavin/.cursor/projects/Users-arkadijcukavin-PycharmProjects-superbot-test-Gd9Ld3YH/agent-transcripts. They have names like <uuid>.jsonl, cite parent chat transcripts to the user as [<title for chat <=6 words>](<uuid excluding .jsonl>). Don't discuss the folder structure.
</agent_transcripts>

<available_subagent_types>
Available subagent_types and a quick description of what they do:
- generalPurpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. Use when searching for a keyword or file and not confident you'll find the match quickly.
- explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
- browser-use: Perform browser-based testing and web automation. This subagent can navigate web pages, interact with elements, fill forms, and take screenshots. Use this for testing web applications, verifying UI changes, or any browser-based tasks. Use this browser subagent when you need to either: (1) parallelize browser tasks alongside other work, or (2) execute a longer sequence of browser actions that benefit from dedicated context. For simple, single browser actions, you may use the browser tools directly. This subagent requires agent mode because browser MCP access is unavailable in readonly mode. This subagent_type is stateful; if a browserUse subagent already exists, the previously created subagent will be resumed if you reuse the Task tool with subagent_type set to browserUse. (Auto-resumes most recent agent of this type; `resume` arg is ignored)
- cursor-guide: Read Cursor product documentation to answer questions about how Cursor Desktop, IDE, CLI, Cloud Agents, Bugbot, and other features work. Use when the user asks 'In Cursor, how do I...?' or similar questions about Cursor products.
- ci-investigator: Investigate a single failing PR CI check and return a short root-cause summary. Use when the user asks to summarize, explain, diagnose, or investigate a specific failed check from a pull request.
- bugbot: Use only when the user *explicitly* asks for a Bugbot-like review of local code changes. When launching this subagent, set the Task description to exactly "Bugbot". Launch exactly one Bugbot subagent with `run_in_background: false` unless the user explicitly asks to run in background. Use this fixed prompt form: "Full Repository Path: ...\nDiff: <one of: \"branch changes\", \"uncommitted changes\", \"natural language\">\nChange Description: ...\nCustom Instructions: ..."; default to `Diff: branch changes`; include `Change Description` only when `Diff` is `natural language`, formatting it as one block per changed file (a `<path> (added|modified|deleted|renamed)` header followed by bullets of what changed, mentioning line numbers or ranges inline where helpful), and only use `natural language` as a last resort after a regular diff-based review failed because the diff could not be computed; include `Custom Instructions` only when the user gave specific review instructions. This subagent is single-shot and does not support `resume`; always launch a fresh subagent instead.
- security-review: Use only when the user *explicitly* asks for a security review of local code changes. When launching this subagent, set the Task description to exactly "Security Review". Launch exactly one security-review subagent with `run_in_background: false` unless the user explicitly asks to run in background. Use this fixed prompt form: "Full Repository Path: ...\nDiff: <one of: \"branch changes\", \"uncommitted changes\">\nCustom Instructions: ..."; default to `Diff: branch changes`; include `Custom Instructions` only when the user gave specific review instructions. This subagent is single-shot and does not support `resume`; always launch a fresh subagent instead.
- best-of-n-runner: Run a task in an isolated git worktree. Each best-of-n-runner gets its own branch and working directory. Use for best-of-N parallel attempts or isolated experiments.
</available_subagent_types>

<available_subagent_models>
If the user explicitly asks for the model of a subagent/task, you may ONLY use model slugs from this list:
- inherit (default; required unless the user explicitly requested another model)
- gpt-5.6-sol-medium

If the user isn't asking for a specific version, prefer the latest version of the model family. As an example, if the user just says "gpt" or "claude", use the latest available version of GPT or Claude.

IMPORTANT: If the user requests a model that is NOT in the list above, do NOT substitute a different model or guess. Instead, skip launching the subagent with that model and tell the user which model was unavailable and which models are available.

When speaking to the USER about which model you selected for a subagent, do NOT use the kebab-case model names unless the user requested the model using that format. Ue the same naming scheme the user used to discuss the model when they requested it.
</available_subagent_models>

<agent_skills>
When the user names a skill, use it faithfully as part of the current task. Read the skill file using the ReadFile tool before following its instructions. The user's instructions take precedence over skill guidance, and an invoked skill takes precedence over autonomous judgment where they do not conflict.

Tell the user in `commentary` when a skill causes a material action or pause. Before using a skill the user did not name, briefly explain why it is relevant and keep its use within the task's scope. Mention material effects in the final response, but do not cite skills you merely inspected. Only use skills listed below.


<available_skills description="Skills the agent can use. Use the ReadFile tool with the provided absolute path to fetch full contents. A path that starts with an alias ($0, $1, ...) continues from the directory listed for that alias.">
$0 = /Users/arkadijcukavin/.cursor/skills-cursor

<agent_skill fullPath="$0/automate/SKILL.md">Use this skill to create Cursor Automations.</agent_skill>

<agent_skill fullPath="$0/autopilot/SKILL.md">Keep a PR merge-ready by triaging comments, resolving clear conflicts, and fixing CI in a loop.</agent_skill>

<agent_skill fullPath="$0/canvas/SKILL.md">A Cursor Canvas is a live React app that the user can open beside the chat. You MUST use a canvas when the agent produces a standalone analytical artifact — quantitative analyses, billing investigations, security audits, architecture reviews, data-heavy content, timelines, charts, tables, interactive explorations, repeatable tools, or any response that benefits from visual layout. Especially prefer a canvas when presenting results from MCP tools (Datadog, Databricks, Linear, Sentry, Slack, etc.) where the data is the deliverable — render it in a rich canvas rather than dumping it into a markdown table or code block. If you catch yourself about to write a markdown table, stop and use a canvas instead. You MUST also read this skill whenever you create, edit, or debug any .canvas.tsx file.</agent_skill>

<agent_skill fullPath="$0/create-hook/SKILL.md">Create Cursor hooks. Use when you want to create a hook, write hooks.json, add hook scripts, or automate behavior around agent events.</agent_skill>

<agent_skill fullPath="$0/create-rule/SKILL.md">Create Cursor rules for persistent AI guidance. Use when you want to create a rule, add coding standards, set up project conventions, configure file-specific patterns, create RULE.md files, or asks about .cursor/rules/ or AGENTS.md.</agent_skill>

<agent_skill fullPath="$0/create-skill/SKILL.md">Create Cursor Agent Skills. Use when authoring a new skill or asking about SKILL.md structure.</agent_skill>

<agent_skill fullPath="$0/loop/SKILL.md">Run a prompt or skill in this session on a recurring or variable interval (e.g. /loop 5m /foo).</agent_skill>

<agent_skill fullPath="$0/new-repo/SKILL.md">Create a Cursor-hosted repo for the current project and push it. Use when a project has no git remote yet and the user asks to create a repo on Cursor, push the project to Cursor, or set up a Cursor-hosted remote; installs and signs in the origin CLI when needed.</agent_skill>

<agent_skill fullPath="$0/origin/SKILL.md">Install, sign in, update, or repair the origin CLI for repos hosted on Cursor (origin.cursor.com). Use when the CLI is missing or outdated, git push/pull fails to authenticate against origin.cursor.com, or the user asks to set up, clone, or configure Cursor-hosted repos.</agent_skill>

<agent_skill fullPath="$0/review-bugbot/SKILL.md">Review code changes with Bugbot subagent.</agent_skill>

<agent_skill fullPath="$0/review-security/SKILL.md">Review code changes with Security Review subagent.</agent_skill>

<agent_skill fullPath="$0/sdk/SKILL.md">Guide users building apps, scripts, CI pipelines, or automations on top of the Cursor SDK - TypeScript (`@cursor/sdk`) or Python (`cursor-sdk` / `cursor_sdk`). Use when the user mentions integrating, installing, or writing code against the Cursor SDK; says `Agent.create`, `Agent.prompt`, `Agent.resume`, `agent.send`, `run.stream`, `run.messages`, `CursorAgentError`, `@cursor/sdk`, `cursor-sdk`, or `cursor_sdk`; asks to run Cursor agents programmatically from a script, CI/CD pipeline, GitHub Action, backend service, or other code outside the Cursor IDE; wants to pick between local and cloud runtime, configure MCP servers for an SDK agent, or handle streaming, cancellation, or errors; or is wiring Cursor into an automation, bot, or REST `/v1/agents` migration. Use eagerly rather than answering from memory; the SDK surface evolves and this skill is the source of truth for the external packages.</agent_skill>

<agent_skill fullPath="$0/share/SKILL.md">Save, back up, or share the current project on Cursor — creates a repo (a saved, versioned copy that isn't public) even for users who have never used git, handling all setup automatically. Use when the user asks to save, back up, publish, or share their project on Cursor, or how to not lose it.</agent_skill>

<agent_skill fullPath="$0/split-to-prs/SKILL.md">Split current work into small reviewable PRs. Use when the user asks to split a chat, set of changes, branch, or PR.</agent_skill>

<agent_skill fullPath="$0/statusline/SKILL.md">Configure a custom status line in the CLI. Use when the user mentions status line, statusline, statusLine, CLI status bar, prompt footer customization, or wants to add session context above the prompt.</agent_skill>

<agent_skill fullPath="$0/update-cursor-settings/SKILL.md">Modify Cursor/VSCode user settings in settings.json. Use when you want to change editor settings, preferences, configuration, themes, font size, tab size, format on save, auto save, keybindings, or any settings.json values.</agent_skill>

<agent_skill fullPath="$0/visualize/SKILL.md">Use /visualize for creating compact charts, diagrams, or other visuals inline as part of the conversation itself. It chooses among Markdown tables, Mermaid, inline HTML, and other supported in-transcript forms. Use Canvas for durable artifacts outside the transcript that users may revisit, refine, or share.</agent_skill>
</available_skills>
</agent_skills>

<dynamic_tool_catalog>
These dynamic tool namespaces were available when this conversation started. Availability may have changed, so use `GetDynamicTools` to check current state before calling `CallDynamicTool`.

<dynamic_tool_namespaces>
<namespace name="cursor-app-control" tools="move_agent_to_root, move_agent_to_cloned_root, create_repo, rename_chat, cursor_dialog, open_resource, open_automation, install_plugin" namespaceUseInstructions="Controls the Cursor application itself (workspace root, repositories, opening resources, automations, and local task drafts, user rules, chat title). See each tool description for usage." source="mcp" />
<namespace name="cursor-ide-browser" tools="browser_navigate, browser_snapshot, browser_click, browser_mouse_click_xy, browser_type, browser_fill, browser_select_option, browser_press_key, browser_scroll, browser_drag, browser_get_bounding_box, browser_highlight, browser_tabs, browser_cdp, browser_take_screenshot, browser_lock" namespaceUseInstructions="The cursor-ide-browser MCP server provides a Cursor-owned browser tab plus a raw Chrome DevTools Protocol command tool.

CORE WORKFLOW:
1. Start by understanding the user's goal and what success looks like on the page.
2. Use browser_tabs with action "list" to inspect open tabs and URLs before acting.
3. Use browser_navigate to create or navigate the target tab. Omit the position parameter for background automation so focus is preserved.
4. Use browser_lock before longer automation on an existing tab, then browser_lock with action "unlock" when finished.
5. Use browser_snapshot for accessibility context and browser_take_screenshot for visual verification.
6. Use browser_click, browser_type, browser_fill, browser_select_option, browser_press_key, browser_scroll, and browser_drag for page interactions.
7. Use browser_highlight and browser_get_bounding_box for visual grounding and coordinate diagnostics.
8. Use browser_cdp for page inspection, profiling, runtime evaluation, DOM/CSS queries, and performance data.

AVOID RABBIT HOLES:
1. Do not repeat the same failing action more than once without new evidence such as a fresh snapshot, a different ref, a changed page state, or a clear new hypothesis.
2. IMPORTANT: If four attempts fail or progress stalls, stop acting and report what you observed, what blocked progress, and the most likely next step.
3. Prefer gathering evidence over brute force. If the page is confusing, use browser_snapshot, browser_take_screenshot, or CDP inspection before trying more actions.
4. If you encounter a blocker such as login, passkey/manual user interaction, permissions, captchas, destructive confirmations, missing data, or an unexpected state, stop and report it instead of improvising repeated actions.
5. Do not get stuck in wait-action-wait loops. Every retry should be justified by something newly observed.

CRITICAL - Lock/unlock workflow:
1. browser_lock requires an existing browser tab - you CANNOT call browser_lock with action: "lock" before browser_navigate
2. Correct order: browser_navigate -> browser_lock({ action: "lock" }) -> (interactions) -> browser_lock({ action: "unlock" })
3. If a browser tab already exists (check with browser_tabs list), call browser_lock with action: "lock" FIRST before any interactions
4. Only call browser_lock with action: "unlock" when completely done with ALL browser operations for this turn

IMPORTANT - Waiting strategy:
When waiting for page changes, prefer short CDP polling loops with Runtime.evaluate, DOM queries, Page lifecycle signals, or browser_snapshot checks rather than a single long wait.

CDP USAGE:
- Use browser_cdp with a DevTools Protocol method and params object, for example Runtime.evaluate, DOM.getDocument, CSS.getComputedStyleForNode, Profiler.start/stop, Performance.getMetrics, Log.enable, and Network.enable.
- Do not use browser_cdp with CDP Input.* methods. They are denied because they are focus-sensitive in Electron webviews and can route input to Cursor UI instead of the browser page.
- Use browser_click, browser_type, browser_fill, browser_select_option, browser_press_key, browser_scroll, and browser_drag for clicks, typing, filling inputs, selecting options, keyboard actions, scrolling, and drag-and-drop.
- Use Runtime.evaluate for advanced DOM-scoped interactions that the dedicated browser tools do not cover.
- For profiling, call Profiler.enable, Profiler.start, reproduce the behavior, then Profiler.stop. The profile is saved to a file and returned as a log_file; read that file only when you need to inspect details.
- For JavaScript evaluation, prefer Runtime.evaluate with returnByValue when possible.
- Device emulation you set with Emulation.setDeviceMetricsOverride, Emulation.setTouchEmulationEnabled, or Emulation.setUserAgentOverride (for example for a phone-sized screenshot) lasts only for the current turn: it is cleared when your turn ends, and the user can reset it from the browser tab at any time. Send Emulation.clearDeviceMetricsOverride yourself once you are done with it within a turn.
- Some browser-wide or sensitive CDP methods are denied, especially cookie, storage, permission, download, target-management, filesystem-backed file-input commands, system-level commands, and CDP navigation/history navigation commands.
- Large CDP responses are saved to files instead of being inlined. Prefer using the returned file path over immediately stuffing large payloads into context; read focused sections only when needed.

VISION:
- browser_take_screenshot attaches an image result that the model can inspect. CDP Page.captureScreenshot returns data inside JSON and should not replace browser_take_screenshot when visual verification is needed.

NOTES:
- browser_snapshot returns snapshot YAML and is the main source of truth for page structure.
- Refs are opaque handles tied to the latest browser_snapshot for that tab.
- Iframe content is not accessible - only elements outside iframes can be interacted with.
- When you stop to report a blocker, include the current page, the target you were trying to reach, the blocker you observed, and the best next action. If the blocker requires manual user interaction, ask the user to take over at that point rather than assuming it in advance." source="mcp" />
<namespace name="cursor-subscriptions" tools="subscribe_github_pr, subscribe_github_ci, subscribe_slack_thread, subscribe_slack_channel, subscribe_slack_new_channels, subscribe_linear_issue, subscribe_linear_comment, subscribe_origin_pr, subscribe_origin_ci, list_subscriptions, unsubscribe" namespaceUseInstructions="Manages event subscriptions for the calling local agent conversation." source="mcp" />
<namespace name="cursor-origin" tools="get_repository, list_repositories, list_namespaces, create_repository, get_file_contents, get_git_tree, grep_contents, list_branches, list_commits, commit_read, compare_commits, sync_mirror, list_pull_requests, pull_request_read, create_pull_request, update_pull_request, update_pull_request_base, merge_pull_request, create_pull_request_review, update_pull_request_review, dismiss_pull_request_review, create_pull_request_comment, create_pull_request_inline_comment, reply_pull_request_review_thread, update_pull_request_review_thread, update_pull_request_comment, update_pull_request_labels, create_label, request_pull_request_reviewers, remove_pull_request_reviewers, checks_read" namespaceUseInstructions="Cursor Origin (origin.cursor.com) is a git host. These tools only see repositories hosted on Origin, addressed by their Origin namespace (owner) and repository name. A repository that only mirrors to Origin still counts as Origin-hosted. Repositories on GitHub or any other host are not visible here, so do not pass a GitHub owner or repository name; call list_namespaces to find the owners the caller can use." source="mcp" />
<namespace name="cursor" tools="AwaitShell, ConnectScm, CreateGoal, Delete, EditNotebook, FetchMcpResource, SearchConversations, SetActiveBranch, Subagent, SwitchMode, TodoWrite, UpdateGoal, WebFetch, WebSearch" namespaceUseInstructions="Native Cursor tools for this session. These are highly recommended and useful tools that you should use when the right situation arises. Don't be afraid to look at one if it seems relevant, even if you don't end up using it. You MUST read the tool schemas before calling them.

Here are some crucial instructions:
- AwaitShell: Use to sleep and check shell progress. Never sleep using shell.
- ConnectScm: When user is blocked on connecting to GitHub.
- Subagent: Spawn local and cloud subagents natively.
- SwitchMode: Switch between modes: Agent and Plan. Proactively consider switching modes for relevant requests.
- TodoWrite: Use this tool to manage complex multi-step tasks." source="cursor" />
</dynamic_tool_namespaces>
</dynamic_tool_catalog>