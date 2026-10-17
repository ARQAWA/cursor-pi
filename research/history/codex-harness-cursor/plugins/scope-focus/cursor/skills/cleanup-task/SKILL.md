---
name: cleanup-task
description: Automatically remove proven disposable temporary materials of the completed current task after its result and required checks, or perform an explicitly scoped task cleanup.
---

# Cleanup Task

Main or its designated owner applies this skill automatically when known
task-created materials have become disposable after the actual result, required
evidence and all selected or mandatory checks. If there are no targets, do not
start a cleanup workflow or create a notebook/registry for it. Explicit retention
instructions override automatic deletion. A direct cleanup request follows its
exact scope and exclusions; only an explicit discard permits removing unfinished
materials. Pause, blocker, approval wait, turn end, agent stop or cancellation
without discard are not completion. ToSpec preparation/readiness preserves inputs
needed for later execution.

Remove only exactly proven task-created temporary or intermediate files, directories, staging, extracted copies, temporary downloads, obsolete intermediate cache/package versions, backups, and an explicit Goal Memory directory if present. Preserve deliverables, source/config/runtime result, final active cache/archive, research/report artifacts, and every pre-existing, user-owned, or ambiguous object, except the explicitly scoped finished ToSpec material below.

Preserve Task Notebook plans, notes, work records, reports, and evidence needed for continuation or later use; its location in the OS temporary directory does not make these records disposable tool output; do not move or copy them into permanent storage as part of cleanup. Replacing a skill does not authorize deleting legacy Goal Memory data.

## Finished ToSpec material

The user selected OS temporary storage and later cleanup for ToSpec outputs.
Use only the exact workspace locator for the current task, never a search for
all matching folders or the newest folder. Read its spec/plan headers and current
task evidence (for an older three-document workspace, also read its existing
tasks header) to establish ownership and actual completion of implementation and
required checks, or the user's explicit instruction to discard this exact task.
`ГОТОВ К РЕАЛИЗАЦИИ` is not completed implementation. Keep pending plans needed
by another agent; do not delete them at the end of specification preparation.

The target must be a real task-created `scope-focus-tospec-*` directory directly
inside the actual Node.js `os.tmpdir()`, outside the task's real target file areas
when any exist; no repository is required. Recheck canonical
paths and symlinks; do not follow a link into another workspace. Within that exact
directory remove only proven task-created spec.md, plan.md and known
intermediate material; a tasks.md from an older completed workspace is removable
only with the same ownership and completion proof. Remove the directory only if
empty. Preserve unknown files, other tasks, notebooks and pre-existing repository
specs. Do not migrate, archive
or copy these documents into the repository as part of cleanup.

Before deletion, establish canonical paths, ownership and exclusions; reject
symlinks or paths that escape the proven target. Use exact known paths, not age,
names, tmp location or absence from Git as proof. No disk audit, recursive search
for rubbish or shared cache cleanup. Known consumers must finish using a target.
Enumerate exact targets and recheck their proof and exclusions immediately before
deletion. Prohibit `rm -f`, `--force`, globs and broad cleanup. Delete an explicitly
authorized Goal Memory directory last. Remove parents only when empty. Confirm
each selected target is absent and exclusions remain; an absent target needs no
action. Preserve ambiguous objects without treating their parent as disposable.
If required eligible cleanup cannot finish, retain necessary continuation and
report the concrete remaining work; do not claim full completion.
