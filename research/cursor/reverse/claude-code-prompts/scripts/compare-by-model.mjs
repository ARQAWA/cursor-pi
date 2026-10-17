#!/usr/bin/env node
// Compares the stored by-model/ captures byte for byte against claude-opus-5-5 and prints, per request kind and per file,
// whether the file is identical. Also prints the tools whose JSON differs and the size of the system blocks.
// Usage: node compare-by-model.mjs [byModelDir]      (default: ../by-model)
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = process.argv[2] ?? path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "by-model");
const base = "claude-opus-5-5";
const others = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const read = f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
for (const kind of ["main", "subagents/Explore", "subagents/general-purpose"]) {
	console.log(`\n## ${kind}`);
	const files = new Set();
	for (const m of [base, ...others]) {
		const dir = path.join(root, m, kind);
		for (const sub of ["system", "messages"]) {
			if (fs.existsSync(path.join(dir, sub))) for (const f of fs.readdirSync(path.join(dir, sub))) files.add(`${sub}/${f}`);
		}
		files.add("tools.json");
	}
	for (const f of [...files].sort()) {
		const a = read(path.join(root, base, kind, f));
		const cells = others.map(m => {
			const b = read(path.join(root, m, kind, f));
			return b === a ? "same" : b === null ? "absent" : `DIFF (${Buffer.byteLength(b) - Buffer.byteLength(a ?? "")} bytes)`;
		});
		console.log(`${f.padEnd(28)} ${others.map((m, i) => `${m.replace("claude-", "")}: ${cells[i]}`).join("   ")}`);
	}
	const toolsOf = m => Object.fromEntries(JSON.parse(read(path.join(root, m, kind, "tools.json")) ?? "[]").map(t => [t.name, JSON.stringify(t)]));
	const ta = toolsOf(base);
	for (const m of others) {
		const tb = toolsOf(m);
		const names = new Set([...Object.keys(ta), ...Object.keys(tb)]);
		const diff = [...names].filter(n => ta[n] !== tb[n]);
		console.log(`tools ${base} vs ${m}: ${Object.keys(ta).length} / ${Object.keys(tb).length} tools, differing: ${diff.join(", ") || "none"}`);
	}
}
