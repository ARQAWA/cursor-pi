# Cursor Pi

Cursor Pi is a planned clone of the Cursor Desktop agent built on [Pi](https://github.com/earendil-works/pi): the same system prompts, tools, tool descriptions, subagents and workflow, reproduced mechanically from reverse-engineered Cursor Desktop 3.25.6. It is a personal build that runs on the owner's own model subscriptions.

This repository is prepared for that work. The clone itself is not built yet.

| Path | Contents |
|---|---|
| [docs/](docs/README.md) | Project documentation: goal and scope, decision journal, Pi map, traceability matrix, extraction and verification |
| [research/](research/README.md) | Reverse engineering and research: Cursor Desktop captures, Codex and Claude Code prompts, prepared prompts, OMP-era history |
| [provenance/](provenance/) | `sources.json` (where every moved file came from), `manifest.json` (sha256 per file), git bundles of the source branches |
| [tools/](tools/) | Verification and extraction scripts (Bun) |
| [pi-pin.json](pi-pin.json) | The pinned Pi release |

Pinned versions: Cursor Desktop 3.25.6 (commit `f0df777c412b670d09e3eaf214967d779e67c080`) and Pi `v1.3.0` (commit `71023aec1546d6d677a65669c5665c0927ce0dd0`).
