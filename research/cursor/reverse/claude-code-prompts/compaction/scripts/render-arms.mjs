#!/usr/bin/env node
// Renders the compaction instruction texts of Claude Code 2.1.301 by running the prompt-building code of the binary.
//
// Usage: node render-arms.mjs <prompt-builder.min.js> <outDir>
//
// prompt-builder.min.js is the byte range of the installed binary (~/.local/share/claude/versions/2.1.301) that starts at
//   var rZe="an <analysis> block followed by a <summary> block"
// and ends just before
//   var DSn=/<analysis>
// (extracted with a Python `bytes.index` on the raw file: `strings` drops the blank lines of template literals).
// It defines the text pieces and `MSn`, the table of the eight prompt arms; `NEe(customInstructions, arm, hasTranscriptPath)` builds the
// text that is sent. `ISn(customInstructions, "from"|"up_to")` builds the partial-compaction prompt of the message selector.
import fs from "node:fs";

const code = fs.readFileSync(process.argv[2], "utf8");
const out = process.argv[3];
const mod = new Function(`${code}\nreturn { MSn, NEe, ISn };`)();
fs.mkdirSync(out, { recursive: true });
for (const arm of Object.keys(mod.MSn)) {
	fs.writeFileSync(`${out}/arm-${arm}.txt`, mod.NEe("", arm, false));
	const guidance = mod.MSn[arm].resumeGuidance;
	if (guidance) fs.writeFileSync(`${out}/arm-${arm}.resume-guidance.txt`, guidance);
}
fs.writeFileSync(`${out}/arm-lean.with-transcript-path.txt`, mod.NEe("", "lean", true));
fs.writeFileSync(`${out}/arm-control.with-custom-instructions.txt`, mod.NEe("Focus on typescript code changes.", "control", false));
fs.writeFileSync(`${out}/partial-from.txt`, mod.ISn("", "from"));
fs.writeFileSync(`${out}/partial-up_to.txt`, mod.ISn("", "up_to"));
