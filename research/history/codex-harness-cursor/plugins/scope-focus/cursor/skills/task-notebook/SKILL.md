---
name: task-notebook
description: Keep lightweight task state when changing requirements, discovery, open questions, waits, handoffs or context changes need continuity; also use when the user explicitly requests Task Notebook.
---

# Task Notebook

Main assesses the need at the start of an actual order and after material changes.
Use automatically when useful state must survive changing requirements, discovery,
open questions, a wait with an operation ID, a handoff or a likely context change.
Reuse an existing sufficient authorized source of operational state instead of
creating a duplicate. A short task, command sequence, Goal or ToSpec confirmation
alone does not require Notebook. Direct `/task-notebook` requires it for the named
task; an explicit instruction to work without Notebook takes precedence.
A retained notebook or locator never authorizes restarting an old task. With
ToSpec, link the exact primary spec/plan, task key and any selected native Goal;
keep operational progress without an independent technical copy.

Keep a small current view from which the agent can establish the effective order,
completed work and its grounds, what changed, and the next concrete action. Use
detail on demand. The notebook supports the task; it grants no authority.

## Start and ownership

- When the current Cursor conversation ID is explicitly available in task context,
  compute the plan path as
  `path.join(os.tmpdir(), 'scope-focus', 'task-notebook', Buffer.from(session_id, 'utf8').toString('hex'), 'plan.md')`.
  Do not infer the session ID from directory names or an older notebook. Store
  notes, work records, reports, and needed evidence beside that plan in the
  operating system's temporary directory. Do not use the repository,
  PLUGIN_DATA, a plugin cache, or a persistent external artifacts directory.
  OS cleanup may remove these files; do not create a hidden permanent copy.
  If the file is missing, continue only from available task sources and do
  not invent recovered state.
- Validate canonical OS tmp containment and namespace/session path components
  before writing; require real directories and a regular entry plan, not symlinks.
- Read an existing header before writing. For the same continuing task, retain
  its task key and records. For a new order needing a notebook, choose one unused
  filesystem-safe task key. Never overwrite a different task's active notebook.
  If its relationship to the new request is unclear, resolve that material choice.
- Main owns the order and decisions. When Main explicitly delegates this skill,
  the designated executor reads it and owns notebook contents and status for the
  root task, using the root session ID or plan path Main supplies; it must not
  create or edit a notebook keyed to its child session. Other agents return
  results to that owner instead of independently editing the shared plan. Use
  the environment's configured executor for writes where required.
  Main retains final acceptance and native Goal remains managed only in the root
  chat. The exact root locator supplied by Main takes precedence over a child
  hook locator, including parent-session data in nested delegation. Hook metadata
  supplies identity, not ownership or permission to write.
- Native Goal is optional. If selected, obtain its actual identity and original
  objective through the current validated root snapshot in scope_focus_native_context or actual available Goal tools, and record that association. Do not
  create, reset, or redefine a Goal through this skill. Native status remains native;
  newer user instructions still govern the effective order.
- Without a current session ID, do not create a new session-keyed notebook.
  An explicitly supplied plan path inside the operating system's temporary
  directory can support manual continuation when its header confirms the
  selected task and its relationship to the current task is explicit. Do not
  promise automatic location or restore, or mix in another session's records.
  Report the limitation when Notebook is needed; continue compatible work
  with available context.

## Notebook layout

Create only `plan.md` initially. Add other records when their content is needed:

| Path, relative to the session notebook directory | Purpose |
| --- | --- |
| `plan.md` | Header, effective order, user amendments, current step, plan, and links. |
| `<task-key>/notes.md` | Current understanding, shared tools, access context, rules, and sources. |
| `<task-key>/work/<part-id>.md` | Necessary working detail, results and evidence that do not fit the current view. |
| `<task-key>/evidence/…` | Required originals that do not already have a suitable durable location. |
| `<task-key>/report.md` | Only a requested report or necessary outcome detail without an existing suitable source. |

The header names the exact session, task key, selection source, and status:
`working`, `waiting`, `blocked`, `complete`, or `cancelled`. Follow it with the
effective order, current amendments, current step, TODO plan, and record links.
Keep stable part IDs when reordering; use source case IDs when present.

This abbreviated example shows the shape; keep the full required list in real work:

```text
Session: actual session_id
Task: selected task-key and short task identity
Selected by: direct user source, or automatic Gold Standard selection with current order source and concrete need
Status: working

Current order: required result, conditions, exact constraints, source references.
User amendments: source, what changed, which former conditions no longer apply.
Current step: TC02; waiting for the recorded ingest operation; resume condition.
Plan:
  [x] TC01 — executed; PASS → <task-key>/work/TC01.md
  [ ] TC02 — waiting
      [x] Prepare and submit data → saved operation record
      [ ] Compare the processed result
  [ ] Remaining required cases, each retained with its own status
Records: shared notes, work records, required originals.
```

## Work cycle

1. Capture the result, every known requirement, source, and completion condition.
   Plan everything already understood, or sketch the overall plan and expand the
   nearest steps as understanding grows. Keep all known mandatory
   work visible, without pretending to know every future implementation detail.
2. Before the next action, research and design the work sufficiently to perform it
   correctly. Establish the relevant tools, access, data preparation, rules, and
   expected outcome. Follow documentation links as deeply as this decision needs.
   For the next substantive TODO, record the action and expected result; for
   research, record the question and what evidence would change the decision.
3. Revise any affected plan level from those facts, then execute the next sufficiently
   understood step. Future details may remain unknown; concrete actions must be
   understood before execution.
4. Compare the expectation with the available result. A material mismatch requires
   reconciling understanding and replanning before dependent work continues.
   Record meaningful results, necessary evidence, and the next action or wait
   condition; no separate entry is required for each tool call.
5. Retain sufficient grounds before collapsing a branch to a short result and
   links. Use an existing work record when detail is needed; do not create one
   or a separate report for every part.

Usually expand the nearest branch. Retain multiple active branches only when the
task requires them, such as useful independent work during a wait. Do not impose
serial execution, parallelism, a fixed TODO depth, or whole-product research.

## Current understanding and conflicts

Keep substantive knowledge in the existing sufficient source; when it needs a
separate account, use `Current understanding` in the task's `notes.md`. This is
the single current account
of significant findings and conclusions: retain their sources, grounds, and
conditions of applicability, and distinguish observations, hypotheses, and
conclusions. Plans and work records link to this account instead of maintaining
independent copies of current conclusions. Original evidence and historical
results remain in their existing records.

Before adding or changing a conclusion, read the related current entries and
needed grounds. Decide whether the information is complementary, concerns
different versions or conditions, changes an earlier conclusion, or contradicts
it under the same conditions. A newer entry does not automatically outweigh
better evidence. Missing evidence does not refute a hypothesis.

Replace the affected current wording rather than appending a competing fact.
Retain superseded conclusions only when needed as evidence or to explain a
current decision; do not create cancellation records merely to preserve the
past. Update affected dependent conclusions, TODOs, and evaluations of completed
parts before the next dependent action. Mark superseded statements in existing records so later reading cannot
mistake them for current guidance; preserve original evidence and executed actions.

If the conflict cannot yet be resolved, keep the competing versions and sources
in `Current understanding` as unresolved, not established facts. Name affected
steps and the next authorized way to resolve it. Link to that entry under
`Open conflicts` in `plan.md` while it remains open. Pause dependent actions and
continue compatible independent work. Resolve it from sufficient grounds, then
replace the unresolved entry with the supported conclusion and remove its open
plan link, preserving the sources and grounds needed for the current conclusion.
Do not claim successful completion while a conflict affecting the requested result remains unresolved.

## User amendments

- Keep an integrated **Current order** at the top of `plan.md`: current objective,
  result, scope, constraints, exact values, mandatory procedure, and completion
  conditions. New user corrections belong here before dependent work continues.
- Later instructions replace only conflicting earlier conditions. Preserve every
  unaffected requirement. Retain exact paths, commands, values, prohibitions, and
  materially required wording; do not weaken them through summarization.
- In **User amendments**, record the source and what was added, replaced, or
  cancelled. Avoid copying the whole current order again. If the source will not
  remain accessible after compaction, retain the necessary original excerpt here.
  Clearly mark superseded conditions as inactive.
- Keep active requirements and amendments relevant to continuation in the plan.
  A lengthy history of superseded amendments may move into linked notes. Never
  remove a current condition for brevity. Status questions and acknowledgements
  need no amendment entry unless they change the order.
- Update affected plan branches and flag completed results whose grounds changed.
  Preserve unaffected results. Resolve material ambiguity before dependent action;
  continue compatible work while awaiting necessary clarification.
- A native Goal's older objective does not override newer user instructions. If
  changing that native objective is actually necessary, use only an available
  authorized native path. Never mark the old Goal complete merely to replace it.

## Replanning

The working plan may be replaced at any level, including the whole plan. Use new
facts, design conclusions, dependencies, or user instructions as grounds. Preserve
the effective order and required outcomes, plus the history of actions and evidence.
An explicitly required method or sequence remains binding until the user changes it.

Reconcile affected conclusions under the rules above, revise the necessary part
or the whole plan, and briefly record why with a source locator. Do not save every
plan revision. Keep significant abandoned attempts and their reasons in the
relevant work record so the agent does not rediscover the same failure.

Reuse results that remain applicable. Mark changed applicability explicitly: an
executed action stays a historical fact even if its result no longer meets the
revised order. Never drop required coverage while reorganizing. For example,
grouping 50 cases around shared preparation still retains all required cases and
their statuses in the plan or its immediately linked list.

## Save and read economically

Update only affected content after an amendment, meaningful result, plan change,
valuable finding, important operation, or a changed continuation condition. Group
minor actions into the nearest substantive update. Plan update frequency and
evidence capture frequency are different: save necessary perishable evidence when
obtained, without rewriting the plan after every tool call.

Before an operation whose repetition has material consequences, record its intent
and exact target. Afterwards retain the result or operation ID. If the outcome is
unknown, leave it explicitly uncertain and establish the actual state before retrying.
Do not impose this recording on every read or ordinary command.

Before a long wait, handoff, or known context change, save the current state and
concrete continuation. A timed wait records the operation ID, readiness condition,
and next check time where applicable. Notes do not wake the agent; future execution
requires an available authorized mechanism.

Within one context, use already-read current information. Reread after resume,
external changes to a record, or when previously unloaded detail is needed. Read
the effective order, relevant current understanding and open conflicts, current
branch, and required originals rather than the entire archive. Keep references
from a normal context handoff to this same notebook.

Reduce repetition and link detail; impose no hard limit on lines, tokens, depth,
documents, or amendments that would cut required substance.

## Evidence and reports

Link requirement → expected result → actual action → observation → conclusion.
Preserve the required exact commands, authorization or tokens and identities,
payloads, queries, responses, and execution conditions from actual records. Never
reconstruct an exact trace from memory. Documentation supports the expectation;
the original result supports the observation. Cite the relevant section and, when
material, version or date; use line numbers only when they locate real source text.

Reference an existing durable original instead of duplicating it. A temporary link
or automatically removed packet cannot be the only long-term evidence. Preserve
needed originals before they become unavailable. Keep the owner's rules for secret
values and locations; replacing this skill does not authorize migrating secrets.

A checked TODO means an action is complete. Its evaluation can be PASS, FAIL, or
insufficient grounds. Preserve completed actions even when they fail, but keep
unachieved required outcomes and blocked work unfinished. A report's existence
is not proof of completion. Evidence depth follows the task: analysis may finish
through reading and logic, while requested testing requires its actual observations.
This skill adds no tests, audits, bug fixes, reviews, or external actions.

## Resume and close

On continuation, use the plan path computed from an explicitly available current
session ID, or an explicitly supplied plan path for manual continuation. Inspect
only the notebook header first. Check the session when known, task identity,
selection source, and status against the current request. Load and apply this skill
only for the same continuing task with valid direct or automatic selection in `working`, `waiting`, or
`blocked` status. A complete, cancelled, or unrelated notebook does not restart work
or enable the skill for a new order. Apply new user amendments before dependent work,
then load the relevant current understanding, open conflicts, current branch, and
required originals. Do not restore a historical conclusion as current without
assessing its applicability. Reconcile existing notebooks for the continuing task
only as needed for that work; do not migrate unrelated tasks or reread the whole
history. Recheck only material mutable, missing, contradicted, or invalidated grounds.

The communication hook supplies the actual native session ID and computed
locator only; it never reads, creates, loads or deletes Notebook. Use the real
root locator and header checks above, not a session search. For a different
session, require a supplied notebook path and an explicit
relationship to the task; do not search other sessions or silently reassign their
records.

At a part's completion, retain its useful result and grounds in the current view
or existing detailed source. Separate work records and full chronology are not
mandatory. Keep necessary evidence and links.

At whole-task completion, reconcile the actual result with the effective order and
all applicable amendments and current grounds, including unresolved conflicts.
Save sufficient closing outcome and grounds in the existing plan or required
result. A separate report is needed only when requested or necessary; reuse an
existing suitable source. Do not create an archive, report or permanent copy
solely for closing or deletion. Resolve links against their actual locations.
After the substantive result and required evidence/reviews, automatically apply
[Cleanup Task](../cleanup-task/SKILL.md) to known disposable task materials when
any exist, then [Cleanup Notebook](../cleanup-notebook/SKILL.md) only with
`scope=current-task` for proven disposable records. Keep Notebook available until
its ownership and links are no longer needed by task cleanup.

A later independent task needing Notebook in the same session gets a new task key.
Replace the entry plan only after preserving the prior task's outcome; keep its
record paths and links unchanged. For a pause, cancellation, or blocker, save the
actual state without claiming completion. For a pause use `waiting` and an explicit
pause/resume condition; native Goal status remains native. Pause, blocker, awaiting
approval, turn end, agent stop or cancellation without an instruction to discard
do not authorize deletion or resumption against the user's intent. On resume check
current user instructions, available associated native Goal state and the header.
Keep requested Notebook results, required originals, still-used links and anything
the user asked to retain. Tmp location alone does not make them disposable.
Unknown ownership excludes that target from automatic cleanup. Preserve other
task keys and sessions; absent targets require no replacement or workflow.
An explicit `/cleanup-notebook` invocation without a scope instead authorizes
deletion of the entire current-session notebook, including completed records.
Cleanup Task does not delete Notebook. Legacy Goal
Memory data is not migrated or deleted by this replacement.

## Existing workflows

Keep Goal definition and native status with the selected Goal workflow. When Context
Router is enabled, link this notebook from its checkpoint and use relevant exact
history records; do not maintain a second independent plan there. Neither Context
Router nor Lunatron is a dependency. Follow the environment's existing roles and
selected review process without adding workers or review cycles through this skill.
