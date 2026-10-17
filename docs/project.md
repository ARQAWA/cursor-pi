# Project

## Goal

Build Cursor Pi: a clone of the Cursor Desktop agent on Pi, from scratch. It must work exactly like Cursor in workflow and mechanics: the same prepared system prompts, the same harness around them, the same subagent system prompts, the same tools with the same descriptions, and tools that behave mechanically exactly as Cursor's. It is a personal, free build that runs with the owner's own subscriptions. The owner's words are in [decisions.md](decisions.md) (D17-D19).

The result is a set of Pi extensions, settings and launch flags on stock Pi, not a fork of Pi (D14). Nothing beyond Cursor is kept: every Pi mechanism Cursor does not have is turned off (D11, D14).

## Reference versions

| Component | Version | Identity |
|---|---|---|
| Cursor Desktop | 3.25.6 | `/Applications/Cursor.app`, commit `f0df777c412b670d09e3eaf214967d779e67c080`, daemon sha256 in [the extraction record](../research/extraction/cursor-desktop-3.25.6.json) |
| Pi | `v1.3.0` | [earendil-works/pi](https://github.com/earendil-works/pi) commit `71023aec1546d6d677a65669c5665c0927ce0dd0`, npm `@earendil-works/pi-coding-agent` 1.3.0, released 2026-10-15T19:17:33Z; see [pi-pin.json](../pi-pin.json) |

Pi `v1.3.0` was the latest stable (non-prerelease) GitHub release on 2026-10-17, the day it was pinned. It is not updated (D23).

## Sources and their roles

| Source | Role |
|---|---|
| Cursor Desktop's local agent code (`daemon.cjs`, the `@anysphere` agent packages) | Specification: texts, formats, constants, model branches. Read locally with [extract-cursor.mjs](../tools/extract-cursor.mjs); see [cursor-extraction.md](cursor-extraction.md) |
| Desktop captures in [research/cursor/reverse/](../research/cursor/reverse/) | What Cursor actually sent. The captured turns were built by Cursor's backend (`connect` runtime), so where local code and a capture differ, the capture wins and the difference is recorded |
| New Desktop probes | Fill gaps the code and captures do not settle; driven with Computer Use in Cursor Desktop on GPT-5.5, GPT-5.6 Luna or GPT-5.6 Sol (D15, D16) |
| Pi source at the pinned commit | Which public API reproduces each mechanism: [pi-map.md](pi-map.md) |

The Cursor CLI is not a source (D2, D13). Its only material here, `research/cursor/reverse/bench-luna/`, is kept labeled as excluded.

## Scope

Carried from the OMP-era plan ([PLAN.md](../research/history/omp-remaster/PLAN.md), "Scope") and the owner decisions:

- Prompts: the prepared prompts in [research/cursor/remaster/prompts/](../research/cursor/remaster/prompts/) for GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna, GPT-5.6 Sol, GPT-5.6 Luna, GPT-5.6 Terra, Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 (D4-D6, D8, D9, D20). They name OMP as the product; adapting the product name to Cursor Pi is implementation work.
- Message layout, the main tools, the dynamic catalog behind GetDynamicTools and CallDynamicTool, subagents with their prompts, tool sets and result texts, background work, resume, self-fork, interrupt, AwaitShell, UpdateCurrentStep, notifications, AskQuestion.
- Compaction: provider-native (Codex compaction for GPT, Claude Code compaction for Claude) instead of Cursor's summarizer (D10).
- Out: Plan, Ask and Debug modes (D11), ReadLints and other IDE-only data, Cursor's closed backend services (not faked), models below GPT-5.5 (D12), the Cursor CLI.
- Interface: Pi's terminal interface is the host; Cursor's editor UI is not reproduced.

The seven open owner questions of the OMP plan (dynamic catalog, subagent types, Claude edit tools, self-fork, Anthropic prompt placement, Claude verification, Claude prompt source) are still open and apply to Pi unchanged; they are listed in [PLAN.md](../research/history/omp-remaster/PLAN.md), "Owner questions".

## Boundaries of this preparation

This repository holds the research, the decisions, the Pi map and the traceability matrix. No Pi extension, tool or prompt of the clone is built here yet. Cursor bundle code, extracted modules, credentials and raw capture-adapter logs are never committed.
