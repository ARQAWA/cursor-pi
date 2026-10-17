# Verification

Each claim this repository makes can be checked with a script in [tools/](../tools/) (Bun 1.4, no dependencies). Run them from the repository root.

| Claim | Command | Passes when |
|---|---|---|
| Every moved file is byte-identical to its source at the recorded commit | `bun tools/verify-manifest.mjs` | `mismatches: 0, missing: 0, unlisted: 0` |
| Every decision quote is in the owner's session log | `bun tools/owner-messages.mjs check docs/decisions.md` | `missing: 0, unattributed: 0` |
| The extraction record matches the installed Cursor Desktop | `bun tools/extract-cursor.mjs --check research/extraction/cursor-desktop-3.25.6.json` | `changed: 0, missing: 0, extra: 0` |
| Every Pi reference opens at the pinned commit and names what is on that line | `bun tools/check-pi-refs.mjs` | `failed: 0` |
| No relative markdown link is broken | `bun tools/check-links.mjs` | `broken: 0, stale: 0, invalid: 0` |
| No credential in the files or in the bundled branch histories | `bun tools/scan-secrets.mjs` | `findings: 0` |
| No Cursor bundle code is committed | `git grep -n -E '__esm\(\{ *"\.\./' ; git grep -n -E '__commonJS\(\{ *"\.\./'` | no output |

## Notes

- `verify-manifest.mjs` needs no local checkout: it reads the three my-omp-harness branches from [provenance/bundles/](../provenance/bundles/) and clones my-codex-harness from GitHub without blobs. `--repo <name>=<git dir>` uses a local repository instead. Files that came from the remaster's `reference/` folder are byte-identical to files moved from `cursor-base-tools`; the manifest lists both locations (`alsoAt`) and the script checks both.
- `owner-messages.mjs` reads `~/.omp/agent/sessions`, which exists only on the owner's machine; `list <session>` prints the verbatim owner messages the journal was built from.
- `extract-cursor.mjs` needs Cursor Desktop 3.25.6 installed at `/Applications/Cursor.app` (or `--app`).
- `check-links.mjs` exempts only links inside verbatim moved files listed in the manifest, recorded one by one in [link-exemptions.json](../tools/link-exemptions.json). Those files cannot be edited without breaking their sha256; their links point to raw captures that were not moved (over 1 GB, single files above GitHub's 100 MB limit), to local absolute paths, to paths of the source harness, or are text inside captured prompts.
- The bundle-code search looks for real module markers, whose path key starts with `../`. The bare text `__esm({` occurs once, in [DESKTOP-RESEARCH.md](../research/history/omp-remaster/DESKTOP-RESEARCH.md), where it describes the extraction method; that file is verbatim history and holds no Cursor code.
- `scan-secrets.mjs` also scans every blob in the bundles, because they are published with the full branch history. Request headers in the captures already carry `"authorization": "[REDACTED]"`.
