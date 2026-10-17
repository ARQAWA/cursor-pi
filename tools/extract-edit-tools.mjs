#!/usr/bin/env bun
// Renders the StrReplace and Write declarations that Cursor's code builds for Anthropic models, through the oracle, and writes
// them to extensions/cursor-pi/tools/generated/anthropic-edit-tools.json. Cursor has no capture of these two tools.
// Usage: bun tools/extract-edit-tools.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCursor } from "./cursor-oracle.mjs";
import { anthropicEditTools } from "./lib/cursor-edit-tools.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "cursor-pi", "tools", "generated", "anthropic-edit-tools.json");

const cursor = await loadCursor();
const tools = anthropicEditTools(cursor).map(({ name, description, parameters }) => ({ type: "function", name, description, parameters }));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(tools, null, 2)}\n`);
console.log(`wrote ${tools.length} tools to ${OUT}: ${tools.map((tool) => tool.name).join(", ")}`);
