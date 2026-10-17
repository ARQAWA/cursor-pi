# Cursor extraction

Cursor's agent code is the specification, but it is not stored here. [extract-cursor.mjs](../tools/extract-cursor.mjs) reads it from the installed app at run time, writes it only to the OS temp folder, and the repository keeps only metadata and hashes: [cursor-desktop-3.25.6.json](../research/extraction/cursor-desktop-3.25.6.json).

## Method

1. Read `Contents/Resources/app/product.json` for the version and commit (3.25.6, `f0df777c412b670d09e3eaf214967d779e67c080`).
2. Read the agent host daemon `Contents/Resources/app/extensions/cursor-agent-host/dist/agent-host-daemon/dist/bin/daemon.cjs` (18 514 858 bytes) and pretty-print it with `new Bun.Transpiler({ loader: "js" }).transformSync` (439 369 lines).
3. Split it at esbuild's lazy module markers: ES modules (`__esm` with one path key) and CommonJS modules (`__commonJS` with one path key). Each module runs from the line of its marker to the next marker; the text before the first marker is the prelude.
4. Write the pretty file, the prelude and each module to `<tmp>/cursor-3.25.6-f0df777c/modules/<path>` (leading `../` becomes `__/`), and record version, commit, daemon sha256, pretty-file sha256, marker counts and every module's path, kind, size and sha256.

For Cursor 3.25.6 the split gives 2 191 ES modules and 611 CommonJS modules, 2 802 in all, with no duplicate paths. 449 ES modules are under `agent/`, 253 under `agent-host/` and 15 under `agent-summarization/`.

## Difference from the earlier count

[DESKTOP-RESEARCH.md](../research/history/omp-remaster/DESKTOP-RESEARCH.md), written for the OMP remaster, reports 2 603 modules, 414 under `agent/` and 239 under `agent-host/`. That count could not be reproduced: its script was not kept, and neither marker set nor their sum gives it. The record in this repository is produced by the script above and is reproducible; the old numbers stay in the history file unchanged.

## Use

```sh
bun tools/extract-cursor.mjs --check research/extraction/cursor-desktop-3.25.6.json
```

On the same Cursor version this reports zero changed, missing or extra modules. After a Cursor update it lists the modules that changed, which is the drift check (E4) of the [traceability matrix](traceability.md). `--record <file>` writes a new record; `--out <dir>` chooses the temp folder and refuses any folder inside the repository.
