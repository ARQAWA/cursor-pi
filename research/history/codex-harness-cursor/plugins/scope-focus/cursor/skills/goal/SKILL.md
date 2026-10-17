---
name: goal
description: Automatically select native Goal, when user authority and native rules permit, for independently requested work whose outcome spans dependent stages, substantial research or uncertainty, or prolonged execution. Also use for an explicit /goal request or goal definition and refinement. Short questions, simple edits and discussion do not require Goal; it does not manage working notes or authorize execution.
---

# Define Goal

## Overview

Shape the user's intent into a concrete outcome with bounded scope and grounds for completion drawn from the request. Ordinary verification uses reading and logical assessment under the main prompt's rule; use numbers only when they express a real requirement.

This skill covers goal definition and goal-tool creation only. Do not create intermediate planning artifacts, durable snapshots, ledgers, decision logs, or resume files from this skill.

Only root Main manages native Goal. Its selection adds no tests, review,
delegation, permissions or other workflows. The Gold Standard independently
assesses useful working state, with or without Goal. Notebook may automatically
join a selected Goal under its own conditions, without another manual request;
Goal alone does not require it. Keep useful operational notes under that policy,
outside this definition procedure; native objective and status remain authoritative.

Definition alone does not authorize executing the proposed task. Goal never
replaces required approval or execution confirmation: ToSpec preparation does
not start the future execution Goal, while an explicitly selected preparation
Goal concerns only the requested preparation result. Automatic selection does
not override a user pause or turn a blocker, approval wait, turn end or
cancellation without discard into completion. Follow actual native status rules;
completion requires the actual result and all already mandatory actions.

## Workflow

1. Assess whether Goal is useful for the actual current order.
   - Automatically select it when an independently requested outcome needs continuity through dependent stages, substantive research or uncertainty, or prolonged execution, subject to the authority check in step 6.
   - Short questions, straightforward brief edits and discussion of possible future work do not require Goal. Requested discovery can itself have a concrete outcome; discussing it does not authorize executing it.
   - A direct `/goal`, request to create a goal or request for goal definition selects this skill regardless of complexity. An instruction to work without Goal takes precedence over automatic selection for the affected task.
   - Reassess after a material change in the task, not on every tool call; use no thresholds for commands, minutes or files.

2. Restate the likely goal in concrete terms.
   A usable goal names:
   - the specific outcome that will be true
   - the main artifact, system, repo, environment, or user-facing behavior involved
   - how the actual result will be established by reading and logical assessment, plus any explicitly required evidence
   - what is in scope
   - what is out of scope when ambiguity would matter
   - the stop condition for asking the user instead of grinding

3. Use criteria that represent the requested result.
   - Derive outcome, artifact paths, scope, format, values, and binary completion conditions from the request.
   - Do not invent metrics, thresholds, validators, or run counts for formal measurability.
   - Tests, commands, CI, measurements, and evidence counts are options only for explicitly requested empirical evidence or a specifically adopted procedure or higher-priority obligation.
   - For ordinary fixes, analysis, or architecture-based performance work, define completion through the actual result and logical assessment.

4. Repair weak goals before setting them.
   - Rewrite vague goals into concrete outcome criteria when the request and local context make that interpretation safe.
   - Ask one concise clarification question when the missing detail changes the intended outcome or validation.
   - Reject pure activity goals such as "make progress," "keep investigating," "improve things," or "work on X" unless they are sharpened into a verifiable outcome.

5. Check active goal state before creating a goal.
   - Read the current root native Goal snapshot from `scope_focus_native_context`. Validate conversationId, goalId, objective and native status (0 unspecified, 1 active, 2 paused, 3 complete, 4 cleared). An absent valid root state means no goal; unknown identity/state is unknown, not absence. Children do not manage root Goal. Use only actual native budget fields when supplied; do not invent them.
   - Use the available native `create_goal`/`update_goal` tools and their current schemas. Cursor create_goal takes objective; do not pass a Codex-only budget field. A missing required native capability stops its dependent transition; do not simulate Goal or claim full readiness.
   - If there is no unfinished goal, the objective meets the quality bar and step 6 permits creation, call `create_goal`.
   - Reuse a matching unfinished goal according to current user instructions and native state; repeated selection does not create a duplicate or repeat completed operations.
   - Preserve a conflicting unfinished goal. Do not reset, replace or mark it complete solely to make room. Resolve only the material conflict through an allowed native path or a focused user question; do not require a new thread.

6. Create the goal only after it passes the quality bar.
   - Choosing this skill does not by itself authorize `create_goal`. Follow the actual tool instructions and higher-priority rules. Express user adoption of conditional automatic Goal, or an applicable system/developer instruction, supplies a standing request only where those rules accept it. Skill availability or an ordinary task alone is not that authority; if the host requires a separate explicit request, do not infer permission against that requirement.
   - If native Goal is unavailable or not permitted, do not simulate it with files or another controller. Continue compatible authorized work; disclose the concrete limitation only when material to the result or an explicitly requested Goal.
   - Use a single concise objective string.
   - Include sufficient grounds for completion: the requested result assessed through reading and logic, plus any explicitly mandatory evidence. Every added threshold or method must follow the request; writing it into the objective creates no authority.
   - Include scope bounds when they constrain the work.
   - A budget is supplied only when explicitly requested and supported by the actual native schema. If a requested budget cannot be represented by Cursor native Goal, stop that dependent transition and disclose the missing capability; do not silently discard or simulate the budget.
   - Formulate a clear permitted goal without asking again merely to enable the mode or approve its technical wording. Ask only when a missing choice materially changes the requested result, authority or mandatory evidence. A definition-only request remains definition-only.

## Goal Quality Bar

Before `create_goal`, the objective should answer:

- What concrete thing will be true when this is done?
- What actual material and logical grounds establish it, and what empirical evidence did the user explicitly require?
- What requested outcome or meaningful binary or quantitative condition defines success?
- What scope boundaries matter?
- What should cause the agent to stop and ask?

Good:

> Replace A with B in the specified setting. Finish when the edit is present and reading the affected code establishes consistency with the request.

Good:

> Resolve the specified design question from relevant sources and logic. Finish when the conclusion is supported and material contradictions are addressed.

Weak:

> Make checkout faster.

Weak:

> Keep investigating the PR comments.

## Quantification Heuristics

- For bugs, define the required correction and explain it through the affected code and logic. Reproduction and a failing-then-passing validator require an explicit request for that evidence.
- For explicitly requested tests, name the ordered scenario and its pass condition; honor a specified command.
- For performance, reason from mechanisms, work, and context. Label calculated complexity as calculation; claim a measured improvement only from actual measurements. Do not invent a metric, target, method, or run count.
- For quality work, use the requested outcome, ordinarily assessed through reading and logic; do not add lint, type checks, or tests automatically.
- For research, define the decision the research must enable, the sources or systems in scope, and the evidence standard.
- For operations, define the requested resulting state. Do not invent monitoring windows, thresholds, or rollback work.

## Clarifying Questions

Ask only when a reasonable rewrite would risk pursuing the wrong outcome. Keep the question short and oriented around the missing validator or scope boundary.

Useful question shapes:

- "What metric should define success here: latency, cost, accuracy, or user-visible behavior?"
- "Which environment should I verify against: local, staging, or production?"
- "What is the minimum evidence you want before I mark this goal complete?"

When a meaningful criterion follows directly from the request, formulate it without another confirmation. Ask only when an unresolved choice materially changes the outcome or mandatory evidence.
