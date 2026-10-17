#!/usr/bin/env bun
// Reads the browser tool declarations and the server instructions from Cursor Desktop's cursor-browser-automation extension
// and writes them to extensions/cursor-pi/tools/generated/browser-tools.json as data only. The runtime loads that JSON; no
// Cursor code is copied into the repo. Usage: bun tools/extract-browser-tools.mjs [path/to/extension.js]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXTENSION = "/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-browser-automation/dist/extension.js";
const OUT = path.join(ROOT, "extensions", "cursor-pi", "tools", "generated", "browser-tools.json");

const source = await readFile(process.argv[2] ?? DEFAULT_EXTENSION, "utf8");

// The server instructions are one JS string literal assigned to this.instructions.
const instructionsAt = source.indexOf("this.instructions=");
if (instructionsAt < 0) throw new Error("this.instructions not found in extension.js");
const instructionsLiteral = readStringLiteral(source, instructionsAt + "this.instructions=".length);
const instructions = vm.runInNewContext(instructionsLiteral);

// The declarations are one array literal assigned to this.tools; its parameters are JSON.stringify calls, so the array is
// evaluated in an empty context that has JSON and nothing else.
const toolsAt = source.indexOf("this.tools=[");
if (toolsAt < 0) throw new Error("this.tools not found in extension.js");
const toolsLiteral = readArrayLiteral(source, toolsAt + "this.tools=".length);
const rawTools = vm.runInNewContext(`(${toolsLiteral})`, { JSON });

const tools = rawTools.map((tool) => ({
	name: tool.name,
	description: tool.description,
	parameters: JSON.parse(tool.parameters),
}));
if (tools.length !== 16) throw new Error(`expected 16 browser tools, found ${tools.length}`);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ instructions, tools }, null, "\t")}\n`, "utf8");
console.log(`wrote ${path.relative(ROOT, OUT)}: ${tools.length} tools, ${instructions.length} instruction characters`);

// Returns the JS string literal (single or double quoted) that starts at `from`, honoring backslash escapes.
function readStringLiteral(text, from) {
	const quote = text[from];
	if (quote !== "'" && quote !== '"') throw new Error("expected a string literal");
	for (let i = from + 1; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === quote) return text.slice(from, i + 1);
	}
	throw new Error("unterminated string literal");
}

// Returns the bracketed array literal that starts at `from`, skipping over string literals.
function readArrayLiteral(text, from) {
	if (text[from] !== "[") throw new Error("expected an array literal");
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const ch = text[i];
		if (ch === "'" || ch === '"' || ch === "`") {
			i = skipString(text, i);
			continue;
		}
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) return text.slice(from, i + 1);
		}
	}
	throw new Error("unterminated array literal");
}

// Returns the index of the closing quote of the string that opens at `from`.
function skipString(text, from) {
	const quote = text[from];
	for (let i = from + 1; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === quote) return i;
	}
	throw new Error("unterminated string in array literal");
}
