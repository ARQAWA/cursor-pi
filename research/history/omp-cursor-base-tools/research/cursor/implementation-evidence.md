# Existing OMP implementation evidence

This records earlier task evidence recovered during the context-cache task. It does not report new runs, new reviews or complete end-to-end Cursor parity. The current branch sources and README.md's snapshot supersede earlier interface descriptions. Stage commit IDs below precede the owner's content-equivalent squash to `aec72f4`.

## Search descriptions

The first task changed `extensions/rg.ts` in `cursor-search-descriptions`, preserving the owner's protocol while transferring recorded Cursor guidance into grep/glob/read descriptions. The task's handover reported the existing repository check, a Spotty CLEAN and two sequential Bossy CLEAN verdicts on the same result. The branch was pushed as requested. The current tooling branch includes that guidance.

The owner then ordered two blind navigation tasks on Sol 6.1 low and Sonnet 5.5 low. Actual recorded calls, as reported in the current discussion:

| Model | glob | grep | read | bash |
|---|---:|---:|---:|---:|
| Sol 6.1 low | 1 | 5 | 9 | 0 |
| Sonnet 5.5 low | 0 | 0 | 5 | 5 |

Sol followed filename/content/read refinement. Sonnet used shell grep, git ls-files and head. The task package was loaded, but exact per-child provider descriptions were not captured in that scenario. This is evidence that descriptions alone did not enforce selection for both models; it is not proof of the later complete search cycle.

## Seven-tool implementation

The recorded coverage note `local://cursor-final-review.md` covers the initial implementation at `79c6518`, after initial stage `928c029` and six separate repair batches. It records:

| Tool or criterion | Actual review identified in the note |
|---|---|
| Shell | CursorShellParity task 4 CLEAN |
| Patch, before the later interface correction | CursorPatchParity task 4 CLEAN |
| Dynamic invocation | CursorInvocationParity task 4 CLEAN |
| Glob | CursorGlobParity task 6 CLEAN |
| Read | CursorReadParity task 6 CLEAN |
| Discovery and whole-task documentation | CursorDiscoveryParity task 7 CLEAN |
| Grep / omp-tools | CursorGrepParity task 7: zero admitted findings after the documented textual rejection |

The grep rejection concerns an inferred restriction to ONLY wildcard globs. The recorded description says wildcard globs bypass ignore rules but does not state that explicit literal globs cannot. The owner's own-protocol adaptation covers the current explicit-positive-glob behavior. The earlier note retains the full rejected-finding rationale and the native underscore/role restrictions evidence.

The existing `node tests/run.mjs` result was exit 0, PASS. Prior Sol/Sonnet scenarios covered search/read/bash, multi-file patching, partial valid-hunk retention, discovery/invocation, child yield/message reuse, explicit glob-ignore behavior, directory glob and native background completion. Those runs did not establish a new performance benchmark or a fresh restored explorer's large handoff.

This early patch review was superseded for the public patch interface by the next correction. Do not reuse its old GPT-Lark/Claude-edit wording as current documentation.

## Unified patch correction

Recovered note: `local://cursor-unified-patch-evidence.md`. Corrective stage `4efbd0f`; current contents are included in `aec72f4`.

The actual inspected implementation registers internal `edit` with constant `customWireName: apply_patch`, one string `input` JSON schema and one description. The public provider hook projects `edit/_edit` to `apply_patch/_apply_patch`, preserving native prefixes and other fields. No GPT format switch, Lark `customFormat`, editGrammar or model hook remains. The existing mass engine, locks, valid-hunk handling and rendering were unchanged by that correction.

CursorDescriptionsChecks task 13 ran the existing repository check: exit 0, PASS. Fresh independent OMP sessions used low reasoning on `openai-codex/gpt-6.1-sol` and `anthropic/claude-sonnet-5-5`. Main inspected actual message entries: each had two JSON apply_patch calls with string input, zero edit calls, four successful reads and six non-error tool results. Each created two temporary Markdown files in one mass patch, read them, updated both through the same function and read the expected updated contents. Both sessions completed normally; their runner background results did not include a process exit status, so no numeric runtime exit code is claimed.

The combined class/patch/provider/documentation review was CursorPatchParity task 5. Its actual verdict was:

> CLEAN
>
> UNCHECKED:
> - Replayed history from sessions created before this change still carries tool_use names `edit` or `_edit`, while the provider request now names the tool `apply_patch` or `_apply_patch`. Whether the provider accepts that mix needs a live GPT or Claude run.

Fresh-session replay after the new JSON calls was covered by the scenario. Legacy pre-change session replay was not checked; no compatibility mechanism was requested or added.

Original scenario sessions remain under the OS-temp directory `/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/tmp.nYLKqglBdx/`:

- `uniform-sol-session/2026-10-13T01-42-42-422Z_01a132ed-1bf6-756b-ad37-6f469395fd67.jsonl`
- `uniform-claude-session/2026-10-13T01-42-42-425Z_01a132ed-1bf9-7055-8b06-20f1469b9d9b.jsonl`

The recovered summary above persists the relevant result without copying private runtime transcripts into the research cache.

## Conceptual documentation correction

Recovered note: `local://cursor-conceptual-docs-review.md`. Corrective stage `b7cd9a1`; current contents are included in `aec72f4`.

Object: full task-worktree WORKFLOW-MANIFEST.md, AGENTS.md and `.agents/skills/release/SKILL.md`, with the exact full corrective diff. Accepted outcomes: manifest principles only; the owner's exception rule only in AGENTS; release override additions removed; selection of a separate push happens before release; no extra changes.

CursorDescriptionsBossy tasks 5 and 6 each returned CLEAN, sequentially, on identical absolute-path contents with combined task/documentation criteria. Task 4 had read main-clone files and left the full task diff unchecked; it did not count. The final checked diff was unchanged and the worktree was clean.

The owner then requested squash and branch-only force push without repeated checks. The inspected reviewed contents landed as `aec72f4` in origin/cursor-base-tools. This did not install that branch or merge it into master.

## Approved executor reasoning change

Stage `7997cc6` in `worker-reasoning-max` made nine mechanical xhigh-to-max replacements across five files: the named model routes, their readable skill and installation mentions, AGENTS.md's model paragraph and the existing test assertion. The existing check passed after those source/document contracts were consistent. That approved change is now integrated into the continuing `cursor-base-tools` sources; the installed branch remains unchanged.

## What this evidence does not establish

The historical runs recorded above cover the base wrappers and their then-current interfaces, not the restored explorer loop. The current task sources now include `codebase_explorer` on Haiku 5.5 xhigh; the assembled narrow, broad, large-answer and reuse scenarios have completed; their current observations and limitations are in README.md's current implementation snapshot. No comparison proving the completed harness faster than Cursor has been run.
