#!/usr/bin/env node
// Saves the response of a captured request next to its extracted request files.
//
// Usage: CC_TRACE_EMAIL=<account e-mail> node save-responses.mjs <destDir>=<captureDir>/<tag> ...
//
// For every spec it writes into <destDir>:
//   response.sse.txt      the response body exactly as streamed (decoded from gzip), after the redactions below
//   response.headers.json response status and headers; `anthropic-organization-id` and `anthropic-workspace-id` are
//                         replaced by <REDACTED_ORG_ID> / <REDACTED_WORKSPACE_ID>, set-cookie by <REDACTED>
//   response.text.txt     the assistant text of the response: all `text_delta` fragments joined, no newline added
import fs from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_TRACE_EMAIL;
if (!EMAIL) {
	console.error("Set CC_TRACE_EMAIL to the account e-mail address.");
	process.exit(2);
}
const redact = text => text.split(EMAIL).join("<REDACTED_USER_EMAIL>");
const HEADER_REDACTIONS = {
	"anthropic-organization-id": "<REDACTED_ORG_ID>",
	"anthropic-workspace-id": "<REDACTED_WORKSPACE_ID>",
	"set-cookie": "<REDACTED>",
};

for (const spec of process.argv.slice(2)) {
	const eq = spec.indexOf("=");
	const dest = spec.slice(0, eq);
	const base = spec.slice(eq + 1);
	const sse = redact(fs.readFileSync(`${base}.response.txt`, "utf8"));
	const meta = JSON.parse(fs.readFileSync(`${base}.response-headers.json`, "utf8"));
	meta.headers = meta.headers.map(([name, value]) => [name, HEADER_REDACTIONS[name.toLowerCase()] ?? value]);
	let text = "";
	for (const m of sse.matchAll(/^data: (\{.*\})\s*$/gm)) {
		const ev = JSON.parse(m[1]);
		if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
	}
	fs.mkdirSync(dest, { recursive: true });
	fs.writeFileSync(path.join(dest, "response.sse.txt"), sse);
	fs.writeFileSync(path.join(dest, "response.headers.json"), `${JSON.stringify(meta, null, 2)}\n`);
	fs.writeFileSync(path.join(dest, "response.text.txt"), text);
	console.log(`${dest}: ${text.length} chars of text`);
}
