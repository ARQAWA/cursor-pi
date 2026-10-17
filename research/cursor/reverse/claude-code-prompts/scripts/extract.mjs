#!/usr/bin/env node
// Turns the raw captures written by capture-proxy.mjs into the folder layout of this directory.
//
// Usage: node extract.mjs <outRoot> <label>=<captureDir>/<tag> ...
//   e.g. node extract.mjs .. main-interactive=/tmp/cc-trace/out-tui/036-v1_messages
//
// For every capture it writes <outRoot>/<label>/:
//   request.body.json     request body as sent (decoded), after the redactions below
//   request.headers.json  request headers as sent; Authorization / x-api-key are already "<REDACTED>"
//   system.json           the `system` array, pretty-printed (2 spaces)
//   system/NN.txt         text of each system block, exact, no newline added
//   tools.json            the `tools` array, pretty-printed (2 spaces)
//   messages.json         the `messages` array, pretty-printed (2 spaces)
//   messages/NN-<role>-PP.txt  text of each message (or of each content part), exact, no newline added
//
// Redactions (applied to the raw body text before anything is split out):
//   metadata.user_id device_id   -> <REDACTED_DEVICE_ID>
//   metadata.user_id account_uuid -> <REDACTED_ACCOUNT_UUID>
//   the account e-mail address (env CC_TRACE_EMAIL) -> <REDACTED_USER_EMAIL>
import fs from "node:fs";
import path from "node:path";

const [outRoot, ...specs] = process.argv.slice(2);
if (!outRoot || specs.length === 0) {
	console.error("Usage: node extract.mjs <outRoot> <label>=<captureDir>/<tag> ...");
	process.exit(2);
}
// The account e-mail address is passed in the environment so that it is not stored in this repository.
const EMAIL = process.env.CC_TRACE_EMAIL;
if (!EMAIL) {
	console.error("Set CC_TRACE_EMAIL to the account e-mail address that Claude Code puts into the userEmail context.");
	process.exit(2);
}

function redact(text) {
	return text
		.replace(/(device_id\\?":\\?")[0-9a-f]{64}/g, "$1<REDACTED_DEVICE_ID>")
		.replace(/(account_uuid\\?":\\?")[0-9a-f-]{36}/g, "$1<REDACTED_ACCOUNT_UUID>")
		.split(EMAIL)
		.join("<REDACTED_USER_EMAIL>");
}

function write(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

for (const spec of specs) {
	const eq = spec.indexOf("=");
	const label = spec.slice(0, eq);
	const base = spec.slice(eq + 1);
	const dir = path.join(outRoot, label);
	const rawBody = redact(fs.readFileSync(`${base}.body.json`, "utf8"));
	const rawHeaders = fs.readFileSync(`${base}.headers.json`, "utf8");
	write(path.join(dir, "request.body.json"), rawBody);
	write(path.join(dir, "request.headers.json"), redact(rawHeaders));
	const body = JSON.parse(rawBody);
	if (Array.isArray(body.system)) {
		write(path.join(dir, "system.json"), `${JSON.stringify(body.system, null, 2)}\n`);
		body.system.forEach((block, i) => write(path.join(dir, "system", `${pad(i)}.txt`), block.text));
	} else if (typeof body.system === "string") {
		write(path.join(dir, "system", "00.txt"), body.system);
	}
	if (Array.isArray(body.tools) && body.tools.length > 0) {
		write(path.join(dir, "tools.json"), `${JSON.stringify(body.tools, null, 2)}\n`);
	}
	if (Array.isArray(body.messages)) {
		write(path.join(dir, "messages.json"), `${JSON.stringify(body.messages, null, 2)}\n`);
		body.messages.forEach((msg, i) => {
			if (typeof msg.content === "string") {
				write(path.join(dir, "messages", `${pad(i)}-${msg.role}.txt`), msg.content);
				return;
			}
			msg.content.forEach((part, j) => {
				if (typeof part.text === "string") {
					write(path.join(dir, "messages", `${pad(i)}-${msg.role}-${pad(j)}.txt`), part.text);
				}
			});
		});
	}
	console.log(`${label}: ok`);
}
