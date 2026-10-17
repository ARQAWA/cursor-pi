# Research

Reverse engineering of Cursor Desktop and the research behind Cursor Pi. Every file here except this index, [extraction/](extraction/) and [future-speedup-by-old-harness/](future-speedup-by-old-harness/) was moved verbatim from my-omp-harness or my-codex-harness; its source repository, branch, commit and path are in [provenance/manifest.json](../provenance/manifest.json), and `bun tools/verify-manifest.mjs` proves the bytes. Owner decisions are in [docs/decisions.md](../docs/decisions.md).

Moved files keep their original language. Many evidence notes, run indexes and history files are in Russian; this index and the [docs](../docs/README.md) are in English.

## Labels

Layer: **evidence** is primary material (what a product actually sent or contains, captured verbatim); **conclusions** are our analyses, comparisons, reports and prepared artifacts derived from evidence; **decisions** are owner decisions and agreed rules; **history** is material written for the abandoned OMP clone, kept for reference and not a plan for Pi.

Origin: **Cursor Desktop**, **Cursor CLI (excluded)**, **Codex**, **Claude Code**, or **ours**. Ours means written by us; when it is about a product, the product is named.

## Cursor Desktop and comparison material

Moved from my-omp-harness, branch `cursor-base-tools`, `research/cursor/` (also present in branch `remaster` as `reference/`).

| Folder | Layer | Origin | Contents |
|---|---|---|---|
| [cursor/reverse/REPORT.md](cursor/reverse/REPORT.md) | conclusions | ours, about Cursor Desktop | How Cursor works, from four captured Desktop chats |
| [cursor/reverse/sessions/](cursor/reverse/sessions/) | conclusions | ours, about Cursor Desktop | Step-by-step course of each of the four chats |
| [cursor/reverse/coverage/](cursor/reverse/coverage/) | evidence | Cursor Desktop | Index of every captured request and prompt item |
| [cursor/reverse/prompts/](cursor/reverse/prompts/) | evidence | Cursor Desktop | Verbatim prompt items, tool sets and `cursor` namespace schemas from the adapter log; README and T1 probe prompt are ours |
| [cursor/reverse/runs-2026-10-10/](cursor/reverse/runs-2026-10-10/) | evidence | Cursor Desktop | Reports Cursor wrote in Desktop runs D1-D3 and T1 |
| [cursor/reverse/runs-2026-10-16/](cursor/reverse/runs-2026-10-16/) | evidence | Cursor Desktop | T2 runs on Sol and GPT-5.5: system prompts, calls, items, catalogs; `COMPARISON.md` is ours (conclusions) |
| [cursor/reverse/runs-2026-10-16-T3/](cursor/reverse/runs-2026-10-16-T3/) | evidence | Cursor Desktop | Review subagents, Plan, Debug, summarize; README is ours |
| [cursor/reverse/runs-2026-10-16-T4/](cursor/reverse/runs-2026-10-16-T4/) | evidence | Cursor Desktop | Plan, Debug, Ask, summarize; README is ours |
| [cursor/reverse/runs-2026-10-16-T5-summarize/](cursor/reverse/runs-2026-10-16-T5-summarize/) | evidence | Cursor Desktop | Manual summarize: Cursor logs; README is ours |
| [cursor/reverse/bench-luna/](cursor/reverse/bench-luna/) | conclusions | Cursor CLI (excluded) | Analysis of runs spawned with `agent -p`; not a source |
| [cursor/reverse/codex-prompts/](cursor/reverse/codex-prompts/) | evidence | Codex | Codex CLI base instructions and compaction captures; README and comparisons are ours |
| [cursor/reverse/claude-code-prompts/](cursor/reverse/claude-code-prompts/) | evidence | Claude Code | Claude Code system blocks, tools, per-model prompts, compaction captures; README is ours |
| [cursor/reverse/claude-code-prompts/scripts/](cursor/reverse/claude-code-prompts/scripts/) | conclusions | ours | Capture proxy and extraction scripts used for the Claude Code captures |
| [cursor/remaster/README.md](cursor/remaster/README.md) | decisions | ours | Owner decisions of 2026-10-16 and the Codex-to-Cursor prompt conversion rule |
| [cursor/remaster/prompts/](cursor/remaster/prompts/) | conclusions | ours, from Cursor Desktop and Claude Code | The prepared prompts: GPT-6.1 Sol (with RC1 and RC2), GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, Luna and Terra, Claude Opus, Sonnet and Haiku 5.5; they name OMP as the product |

## Extraction record

| Folder | Layer | Origin | Contents |
|---|---|---|---|
| [extraction/](extraction/) | evidence | Cursor Desktop (metadata produced by ours) | Version, commit and module hashes of Cursor Desktop 3.25.6; no code ([docs/cursor-extraction.md](../docs/cursor-extraction.md)) |

## Future speedups

Added by the owner in this repository (commit `ea89212`), not moved from the harnesses and not covered by the manifest.

| Folder | Layer | Origin | Contents |
|---|---|---|---|
| [future-speedup-by-old-harness/](future-speedup-by-old-harness/) | conclusions | ours, from OMP session history; `gpt-6.1-sol-original.md` is Codex evidence, byte-identical to [codex-prompts/gpt-6.1-sol.md](cursor/reverse/codex-prompts/gpt-6.1-sol.md) | Research of the owner's older harness workflow for later Cursor Pi speed improvements; reference material, not a plan |

## History (OMP era)

| Folder | Layer | Origin | Contents |
|---|---|---|---|
| [history/omp-remaster/](history/omp-remaster/) | history: conclusions and decisions | ours | Branch `remaster`: plan with R1-R9, scope and owner questions; Desktop code research; OMP feasibility and contract; the OMP extension and tool code |
| [history/omp-cursor-base-tools/](history/omp-cursor-base-tools/) | history: conclusions | ours | Branch `cursor-base-tools`: the OMP harness files changed for Cursor-style tools and exploration (extensions, skills, agents, docs, tests) |
| [history/omp-cursor-base-tools/research/cursor/](history/omp-cursor-base-tools/research/cursor/) | history: conclusions and decisions | ours | That branch's working context, owner discussion (verbatim messages of session `01a130bc`), implementation evidence and OMP planning |
| [history/omp-cursor-search-descriptions/](history/omp-cursor-search-descriptions/) | history: conclusions | ours | Branch `cursor-search-descriptions`: OMP `rg.ts` with Cursor search guidance in tool descriptions |
| [history/codex-harness-cursor/](history/codex-harness-cursor/) | history: conclusions | ours | my-codex-harness Cursor tooling removed in commit `007147a`: Cursor plugin packaging of the Lunatron and Scope Focus plugins, Cursor install notes and prompt, and the A/B evaluation script |

The full histories of the three my-omp-harness branches are in [provenance/bundles/](../provenance/bundles/) (`git clone <bundle>`).
