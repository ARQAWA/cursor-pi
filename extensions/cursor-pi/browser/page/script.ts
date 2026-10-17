import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The page-side code: lib.js (helpers and the snapshot builder), then the actions. Each tool call evaluates all of it inside
// one async function, so no names are left in the tab.
const PAGE_SOURCE = ["lib.js", "interaction.js", "hover.js"].map((name) => readFileSync(join(HERE, name), "utf8")).join("\n");

// The expression for Runtime.evaluate that runs one page-side function with JSON arguments.
export function pageCall(fn: string, args: unknown): string {
	return `(async () => {\n${PAGE_SOURCE}\nreturn await ${fn}(${JSON.stringify(args ?? {})});\n})()`;
}
