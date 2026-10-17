#!/usr/bin/env bun
// Checks the MCP client against Cursor Desktop's own code, called through tools/cursor-oracle.mjs:
// - config files: getMcpConfig (JSONC parse, ${...} expansion, schema) on valid, odd and invalid files;
// - namespaces: listHeadlessMcpDefinitions for the names, generateApprovalKey for the approval keys;
// - results: resizeImageBufferIfNeeded for image bytes, extractTextFromNonTextContent for non-text content, and the
//   FetchMcpResource render for resource reads.
// The fixture server (tools/fixtures/mcp-fixture-server.mjs) is connected over stdio, streamable HTTP and SSE.
// Usage: bun tools/check-mcp.mjs

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMcpDefinitions, readMcpConfigFile } from "../extensions/cursor-pi/mcp/config.ts";
import { mcpApprovalKey } from "../extensions/cursor-pi/mcp/state.ts";
import { McpServerClient } from "../extensions/cursor-pi/mcp/client.ts";
import { encodeOAuthState, mcpTokenStore } from "../extensions/cursor-pi/mcp/oauth.ts";
import { projectDirFor } from "../extensions/cursor-pi/tools/shell/paths.ts";
import {
	callMcpTool,
	closeMcp,
	listMcpLoadFailures,
	listMcpNamespaces,
	readMcpResource,
	setMcpApprovalPrompt,
	setMcpBrowserOpener,
} from "../extensions/cursor-pi/mcp/index.ts";
import { BLOB_TEXT, INSTRUCTIONS, PNG_1X1, README_TEXT } from "./fixtures/mcp-fixture-server.mjs";
import { startOAuthFixture } from "./fixtures/mcp-oauth-fixture.mjs";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "tools", "fixtures", "mcp-fixture-server.mjs");
const BUN = process.execPath;
const TOOL_NAMES = ["echo", "get-image", "get-audio", "get-embedded-resource", "get-blob-resource", "get-resource-link", "fail", "throw", "structured"];
const UNAPPROVED = "project-0-proj-unapproved";
const DISABLED = "user-disabled";

const checks = [];
function report(ok, label, detail = "") {
	checks.push({ ok, label });
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}

function freePort() {
	return new Promise((resolvePort, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolvePort(port));
		});
	});
}

function startFixtureHttp(port) {
	return new Promise((resolveChild, reject) => {
		const child = spawn(BUN, [FIXTURE, "--http", String(port)], { stdio: ["ignore", "ignore", "pipe"] });
		let log = "";
		child.stderr.on("data", (chunk) => {
			log += chunk;
			if (log.includes("listening")) resolveChild(child);
		});
		child.on("exit", (code) => reject(new Error(`fixture exited with ${code}: ${log}`)));
	});
}

// The text of a render result, whatever Cursor's string-result wrapper calls it.
function textOf(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(textOf).join("");
	if (value && typeof value === "object") {
		for (const key of ["text", "content", "value"]) {
			if (typeof value[key] === "string") return value[key];
			if (value[key] !== undefined && typeof value[key] === "object") {
				const inner = textOf(value[key]);
				if (inner !== undefined) return inner;
			}
		}
	}
	return undefined;
}

// Bun's os.homedir() reads HOME only at startup, so the check runs in a child whose HOME is a temp folder. Without this,
// the Cursor functions and the MCP client would read the real ~/.cursor/mcp.json.
const isChild = process.env.CURSOR_PI_MCP_CHECK_CHILD === "1";
if (!isChild) {
	const parentTmp = await mkdtemp(join(tmpdir(), "cursor-pi-mcp-check-"));
	await mkdir(join(parentTmp, "home"));
	const exitCode = await new Promise((resolveExit) => {
		const child = spawn(BUN, [fileURLToPath(import.meta.url)], {
			stdio: "inherit",
			env: { ...process.env, HOME: join(parentTmp, "home"), CURSOR_PI_MCP_CHECK_CHILD: "1", CURSOR_PI_MCP_CHECK_TMP: parentTmp },
		});
		child.on("exit", (code) => resolveExit(code ?? 1));
	});
	await rm(parentTmp, { recursive: true, force: true });
	process.exit(exitCode);
}
const tmp = process.env.CURSOR_PI_MCP_CHECK_TMP;
const home = process.env.HOME;
const workspace = join(tmp, "work", "proj");
const stateDir = join(home, ".cursor-pi", "mcp");
await mkdir(join(workspace, ".cursor"), { recursive: true });
await mkdir(join(home, ".cursor"), { recursive: true });
await mkdir(stateDir, { recursive: true });
process.env.CURSOR_PI_CHECK_VALUE = "from-env";

const port = await freePort();
const fixtureHttp = await startFixtureHttp(port);
process.on("exit", () => fixtureHttp.kill());
const bun = JSON.stringify(BUN);
const fx = JSON.stringify(FIXTURE);

const projectPath = join(workspace, ".cursor", "mcp.json");
const userPath = join(home, ".cursor", "mcp.json");
await writeFile(
	projectPath,
	`{
  // Project servers: comments and a trailing comma, which Cursor accepts.
  "mcpServers": {
    "stdio": { "command": ${bun}, "args": [${fx}], },
    "parsed": { "command": ${bun}, "args": [${fx}], "env": { "CHECK": "\${env:CURSOR_PI_CHECK_VALUE}", "MISSING": "\${CURSOR_PI_NOT_SET:-fallback}" } },
    "remote": { "url": "http://127.0.0.1:${port}/mcp" },
    "explicit-sse": { "type": "sse", "url": "http://127.0.0.1:${port}/sse" },
    "fallback": { "url": "http://127.0.0.1:${port}/sse" },
    "unapproved": { "command": ${bun}, "args": [${fx}] }
  }
}
`,
);
await writeFile(
	userPath,
	JSON.stringify({
		mcpServers: {
			everything: { command: BUN, args: [FIXTURE] },
			disabled: { command: BUN, args: [FIXTURE] },
		},
	}),
);

const c = await loadCursor();
for (const marker of [
	"../mcp-core/dist/config/mcp-config-schema.js",
	"../mcp-agent-exec/dist/env-expansion.js",
	"../mcp-agent-exec/dist/config.js",
	"../mcp-agent-exec/dist/approval-store.js",
	"../agent-host-exec/dist/create-headless-hooks-overlay.js",
	"../agent-host-exec/dist/create-headless-mcp-lease.js",
	"../utils/dist/image-resize.js",
	"../agent/dist/tools/mcp/fetch-mcp-resource.js",
	"../agent/dist/tools/mcp/mcp-error-classification.js",
	"../mcp-agent-exec/dist/stdio-stderr.js",
	"../mcp-agent-exec/dist/token-store.js",
	"../mcp-agent-exec/dist/mcp.js",
	"../context/dist/browser-bridge.js",
]) {
	initModule(c, marker);
}

// 1. Config files through getMcpConfig.
const variantDir = join(tmp, "variants");
await mkdir(variantDir);
const variants = {
	comments: `{ /* block comment */ "mcpServers": { "a": { "command": "run", "args": ["x"], }, }, }`,
	env: `{"mcpServers":{"s":{"command":"\${env:CURSOR_PI_CHECK_VALUE}","args":["\${CURSOR_PI_NOT_SET:-d}","\${CURSOR_PI_NOT_SET}","a\${CURSOR_PI_CHECK_VALUE}b"],"env":{"E":"\${CURSOR_PI_NOT_SET:-}"}}}}`,
	"bad-server": `{"mcpServers":{"ok":{"command":"x"},"bad":{}}}`,
	"tls-extra": `{"mcpServers":{"r":{"url":"https://example.test/mcp","tls":{"caBundle":"x","extra":1}}}}`,
	shape: `{"mcpServers":{"r":{"enabledTools":["a"],"placement":"client","url":"https://example.test/mcp","auth":{"scopes":["s"],"CLIENT_SECRET":"sec","CLIENT_ID":"id"},"headers":{"X-A":"1"},"tls":{"caBundle":"  pem  "},"type":"http"}}}`,
	startup: `{"mcpServers":{"a":{"command":"x","startupTimeoutSec":-1},"b":{"command":"x","startupTimeoutSec":"x"},"c":{"command":"x","startupTimeoutSec":30}}}`,
	array: `[]`,
	malformed: `{"mcpServers":{"a":{"command":"x"}`,
	empty: ``,
};
async function compareConfig(label, path) {
	const cursor = JSON.stringify(await c.getMcpConfig(path));
	const ours = JSON.stringify(await readMcpConfigFile(path));
	const count = Object.keys(JSON.parse(cursor).mcpServers).length;
	report(cursor === ours, `config ${label}`, cursor === ours ? `${count} server(s)` : `cursor=${cursor} ours=${ours}`);
}
for (const [label, text] of Object.entries(variants)) {
	const path = join(variantDir, `${label}.json`);
	await writeFile(path, text);
	await compareConfig(label, path);
}
await compareConfig("missing", join(variantDir, "missing.json"));
await compareConfig("project", projectPath);
await compareConfig("user", userPath);

// 2. Names, kinds and approval keys against Cursor's headless definitions.
const refs = await c.listHeadlessMcpDefinitions({ workspacePaths: [workspace], settingSources: ["project", "user"], projectDir: stateDir });
const defs = await listMcpDefinitions(workspace, home);
const cursorNames = refs.map((ref) => ref.identifier);
report(
	JSON.stringify(cursorNames) === JSON.stringify(defs.map((def) => def.identifier)),
	"namespace names equal listHeadlessMcpDefinitions",
	cursorNames.join(", "),
);
report(
	refs.every((ref, i) => ref.kind === ("command" in defs[i].serverConfig ? "stdio" : "http")),
	"transport kinds equal listHeadlessMcpDefinitions",
	refs.map((ref) => ref.kind).join(", "),
);

const cursorProject = await c.getMcpConfig(projectPath);
const cursorUser = await c.getMcpConfig(userPath);
const cursorEntries = new Map([
	...Object.entries(cursorProject.mcpServers).map(([name, server]) => [`project-0-proj-${name}`, { server, root: resolve(workspace) }]),
	...Object.entries(cursorUser.mcpServers).map(([name, server]) => [`user-${name}`, { server, root: home }]),
]);
const cursorKeyOf = (identifier) => {
	const entry = cursorEntries.get(identifier);
	return c.generateApprovalKey(identifier, entry.server, entry.root);
};
const keysMatch = defs.every(
	(def) => cursorKeyOf(def.identifier) === mcpApprovalKey(def.identifier, def.serverConfig, def.approvalRoot),
);
report(keysMatch, "approval keys equal generateApprovalKey", defs.map((def) => def.identifier).join(", "));

// Approve every definition except UNAPPROVED; disable DISABLED. Keys are written with Cursor's own function.
const approvedIdentifiers = defs.map((def) => def.identifier).filter((identifier) => identifier !== UNAPPROVED);
const approvedKeys = approvedIdentifiers.map(cursorKeyOf);
await writeFile(join(stateDir, "mcp-approvals.json"), JSON.stringify(approvedKeys, null, 2));
await writeFile(join(stateDir, "mcp-disabled.json"), JSON.stringify([DISABLED]));

// 3. Listing connects the admitted servers over stdio, streamable HTTP and SSE.
const namespaces = await listMcpNamespaces(workspace);
const expected = defs
	.filter((def) => approvedKeys.includes(cursorKeyOf(def.identifier)) && def.identifier !== DISABLED)
	.map((def) => def.identifier);
const names = namespaces.map((namespace) => namespace.name);
report(JSON.stringify(names) === JSON.stringify(expected), "listed namespaces are the admitted definitions", names.join(", "));
report(namespaces.length > 0 && namespaces.every((namespace) => namespace.status === "ready"), "every admitted namespace is ready");
report(
	namespaces.length > 0 && namespaces.every((namespace) => namespace.instructions === INSTRUCTIONS.trim()),
	"server instructions reach each namespace",
	namespaces[0]?.instructions ?? "none",
);
report(
	namespaces.length > 0 &&
		namespaces.every((namespace) => JSON.stringify(namespace.tools.map((tool) => tool.name)) === JSON.stringify(TOOL_NAMES)),
	"each namespace lists the fixture tools",
	TOOL_NAMES.join(", "),
);
report(listMcpLoadFailures().length === 0, "no admitted server failed to connect", JSON.stringify(listMcpLoadFailures()));

const STDIO = "project-0-proj-stdio";
for (const ns of ["project-0-proj-stdio", "project-0-proj-parsed", "project-0-proj-remote", "project-0-proj-explicit-sse", "project-0-proj-fallback", "user-everything"]) {
	const result = await callMcpTool(ns, "echo", { message: ns });
	report(!result.isError && result.text === `Echo: ${ns}`, `echo over ${ns}`, result.text);
}

// 4. Tool results by kind, compared with Cursor's formatters.
const image = await callMcpTool(STDIO, "get-image", {});
const cursorImage = await c.resizeImageBufferIfNeeded(Buffer.from(PNG_1X1, "base64"), {});
const imageBlock = image.content[0];
report(
	image.content.length === 1 &&
		imageBlock.type === "image" &&
		imageBlock.mimeType === cursorImage.mimeType &&
		imageBlock.data === Buffer.from(cursorImage.data).toString("base64"),
	"image result equals Cursor's resizeImageBufferIfNeeded",
	`${imageBlock.mimeType}, ${imageBlock.data.length} base64 chars`,
);

const audio = await callMcpTool(STDIO, "get-audio", {});
const audioExpected = c.extractTextFromNonTextContent({ type: "audio", data: "UklGRg==", mimeType: "audio/wav" });
report(!audio.isError && audio.text === audioExpected, "audio uses Cursor's unsupported-type text", audio.text);

const embedded = await callMcpTool(STDIO, "get-embedded-resource", {});
const embeddedExpected = c.extractTextFromNonTextContent({
	type: "resource",
	resource: { uri: "fixture://doc/readme", mimeType: "text/plain", text: "Embedded text." },
});
report(!embedded.isError && embedded.text === embeddedExpected, "embedded text resource uses Cursor's extraction", embedded.text);

const blobResource = await callMcpTool(STDIO, "get-blob-resource", {});
const blobExpected = c.extractTextFromNonTextContent({
	type: "resource",
	resource: { uri: "fixture://doc/blob", mimeType: "application/octet-stream", blob: Buffer.from(BLOB_TEXT).toString("base64") },
});
report(!blobResource.isError && blobResource.text === blobExpected, "blob resource uses Cursor's extraction", blobResource.text);

const link = await callMcpTool(STDIO, "get-resource-link", {});
const linkExpected = c.extractTextFromNonTextContent({
	type: "resource_link",
	uri: "fixture://doc/readme",
	name: "readme",
	description: "Readme",
	mimeType: "text/plain",
});
report(!link.isError && link.text === linkExpected, "resource link uses Cursor's extraction", link.text);

const failed = await callMcpTool(STDIO, "fail", {});
report(failed.isError && failed.text === "Fixture failure on purpose.", "isError result passes through", failed.text);

const thrown = await callMcpTool(STDIO, "throw", {});
report(thrown.isError && thrown.text === "Fixture exception on purpose.", "tool exception comes back as isError text", thrown.text);

const structured = await callMcpTool(STDIO, "structured", {});
report(
	!structured.isError && structured.text === "Total: 3" && JSON.stringify(structured.structuredContent) === '{"total":3}',
	"structured content is returned beside the text",
	JSON.stringify(structured.structuredContent),
);

const badArgs = await callMcpTool(STDIO, "echo", { message: 5 });
report(
	badArgs.isError && badArgs.text.startsWith("MCP error -32602"),
	"invalid arguments come back as the server's isError result",
	badArgs.text.slice(0, 80),
);

const unknownNamespace = await callMcpTool("nope", "echo", {}).then(
	() => false,
	(error) => error.message,
);
report(unknownNamespace === 'namespace "nope" not found. Available namespaces: ' + names.join(", "), "unknown namespace rejects", unknownNamespace);

// 5. Resource reads, compared with Cursor's FetchMcpResource render.
async function oracleFetch(execResult) {
	const tool = c.createFetchMcpResourceTool({ get: () => undefined }, {});
	return textOf(await tool.render(null, execResult, {}));
}

const readme = await readMcpResource(STDIO, "fixture://doc/readme");
const readmeExpected = await oracleFetch({
	result: { case: "success", value: { uri: "fixture://doc/readme", name: undefined, description: undefined, mimeType: "text/plain", content: { case: "text", value: README_TEXT } } },
});
report(!readme.isError && readme.text === readmeExpected, "resource read renders as FetchMcpResource does", JSON.stringify(readme.text));

const blob = await readMcpResource(STDIO, "fixture://doc/blob");
const blobExpectedText = await oracleFetch({
	result: { case: "success", value: { uri: "fixture://doc/blob", name: undefined, description: undefined, mimeType: "application/octet-stream", content: { case: "blob", value: Buffer.from(BLOB_TEXT) } } },
});
report(!blob.isError && blob.text === blobExpectedText, "binary resource renders as FetchMcpResource does", JSON.stringify(blob.text));

const missing = await readMcpResource(STDIO, "fixture://doc/missing");
const missingMessage = missing.text.replace(/^Error reading MCP resource: /, "");
const missingExpected = await oracleFetch({ result: { case: "error", value: { error: missingMessage } } });
report(missing.isError && missing.text === missingExpected, "missing resource error renders as FetchMcpResource does", missing.text.slice(0, 140));

const noServer = await readMcpResource("nope", "fixture://doc/readme");
const noServerExpected = await oracleFetch({ result: { case: "error", value: { error: 'Server "nope" not found' } } });
report(noServer.isError && noServer.text === noServerExpected, "unknown server error renders as FetchMcpResource does", noServer.text);

// 6. Large output: text over 40000 bytes goes to a file under the project's agent-tools folder, and the result names the file.
const agentToolsDir = join(projectDirFor(workspace), "agent-tools");
const big = "A".repeat(50_000);
const spilled = await callMcpTool(STDIO, "echo", { message: big });
const spillMatch = spilled.text.match(/^Large output has been written to: (.+) \((\d+\.\d) KB, 1 lines\)$/);
const spilledBody = spillMatch ? await readFile(spillMatch[1], "utf8") : "";
report(
	!spilled.isError &&
		spilled.content.length === 1 &&
		spillMatch?.[1].startsWith(`${agentToolsDir}/`) === true &&
		spilledBody === `Echo: ${big}` &&
		spillMatch?.[2] === (50_006 / 1024).toFixed(1),
	"tool output over 40000 bytes is written to agent-tools",
	spilled.text,
);

const bigResource = await readMcpResource(STDIO, "fixture://doc/big");
const bigMatch = bigResource.text.match(/\n\nLarge output has been written to: (.+) \(.+, 1 lines\)$/);
const bigExpected = bigMatch
	? await oracleFetch({
			result: {
				case: "success",
				value: {
					uri: "fixture://doc/big",
					name: undefined,
					description: undefined,
					mimeType: "text/plain",
					outputLocation: { filePath: bigMatch[1], sizeBytes: 50_000n, lineCount: 1n },
				},
			},
		})
	: "";
report(!bigResource.isError && bigResource.text === bigExpected, "large resource renders as FetchMcpResource does", bigResource.text.slice(0, 120));

// The same write blocked by a file where the folder belongs: the text is cut and the notice says why, as Cursor's notice does.
await rm(agentToolsDir, { recursive: true, force: true });
await writeFile(agentToolsDir, "not a folder");
const truncated = await callMcpTool(STDIO, "echo", { message: big });
await rm(agentToolsDir, { force: true });
report(
	!truncated.isError && truncated.text === c.buildTruncatedTextWithNotice(`Echo: ${big}`),
	"tool output that cannot be written is truncated as Cursor truncates it",
	truncated.text.slice(-70),
);

// 7. Approval: an unapproved server runs only after the host approves it, and a declined server is not asked again.
async function approveKey(key) {
	const path = join(stateDir, "mcp-approvals.json");
	const approvals = JSON.parse(await readFile(path, "utf8"));
	await writeFile(path, JSON.stringify([...approvals, key], null, 2));
}
const serviceServer = { command: BUN, args: [FIXTURE] };
const approvalWs = join(tmp, "work", "approve-ws");
const declinedWs = join(tmp, "work", "decline-ws");
for (const dir of [approvalWs, declinedWs]) {
	await mkdir(join(dir, ".cursor"), { recursive: true });
	await writeFile(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { svc: serviceServer } }));
}
const asked = [];
setMcpApprovalPrompt(async (request) => {
	asked.push(request.name);
	return request.name === "project-0-approve-ws-svc";
});
const approvedList = await listMcpNamespaces(approvalWs);
const approvedSvc = approvedList.filter((namespace) => namespace.name.startsWith("project-0-approve-ws-"));
const approvalKey = c.generateApprovalKey(
	"project-0-approve-ws-svc",
	(await c.getMcpConfig(join(approvalWs, ".cursor", "mcp.json"))).mcpServers.svc,
	resolve(approvalWs),
);
const approvalsFile = JSON.parse(await readFile(join(stateDir, "mcp-approvals.json"), "utf8"));
report(
	approvedSvc.length === 1 &&
		approvedSvc[0].status === "ready" &&
		approvalsFile.includes(approvalKey) &&
		JSON.stringify(asked) === JSON.stringify(["project-0-approve-ws-svc"]),
	"unapproved server runs after the host approves it, with Cursor's approval key",
	approvedSvc.map((namespace) => `${namespace.name}:${namespace.status}`).join(", "),
);

asked.length = 0;
setMcpApprovalPrompt(async (request) => {
	asked.push(request.name);
	return false;
});
const declinedFirst = await listMcpNamespaces(declinedWs);
const declinedSecond = await listMcpNamespaces(declinedWs);
const declinedApprovals = JSON.parse(await readFile(join(stateDir, "mcp-approvals.json"), "utf8"));
const declinedListed = (list) => list.some((namespace) => namespace.name.startsWith("project-0-decline-ws-"));
report(
	!declinedListed(declinedFirst) &&
		!declinedListed(declinedSecond) &&
		JSON.stringify(asked) === JSON.stringify(["project-0-decline-ws-svc"]) &&
		!declinedApprovals.some((key) => key.startsWith("project-0-decline-ws-svc-")),
	"declined server is skipped and not asked again",
	asked.join(", "),
);
setMcpApprovalPrompt(undefined);

// 8. OAuth: a server that needs sign-in lists mcp_auth; mcp_auth signs in through the browser, then the server connects with the stored token.
const oauthServer = await startOAuthFixture(await freePort());
const oauthWs = join(tmp, "work", "oauth-ws");
await mkdir(join(oauthWs, ".cursor"), { recursive: true });
await writeFile(join(oauthWs, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { oauth: { url: oauthServer.url } } }));
const oauthName = "project-0-oauth-ws-oauth";
await approveKey(c.generateApprovalKey(oauthName, (await c.getMcpConfig(join(oauthWs, ".cursor", "mcp.json"))).mcpServers.oauth, resolve(oauthWs)));
// Stands in for the browser: follows the authorization redirect to the loopback callback.
const opened = [];
setMcpBrowserOpener((url) => {
	opened.push(url);
	void (async () => {
		const redirect = await fetch(url, { redirect: "manual" });
		await fetch(redirect.headers.get("location") ?? url);
	})();
});
const needsSignIn = (await listMcpNamespaces(oauthWs)).find((namespace) => namespace.name === oauthName);
report(
	needsSignIn?.status === "needsAuth" && JSON.stringify(needsSignIn.tools.map((tool) => tool.name)) === JSON.stringify(["mcp_auth"]),
	"server that needs sign-in lists only mcp_auth",
	needsSignIn?.error ?? "no error text",
);
const signedIn = await callMcpTool(oauthName, "mcp_auth", {});
report(
	!signedIn.isError && signedIn.text === `Successfully authenticated MCP server: ${oauthName}. The server's tools should now be available.`,
	"mcp_auth signs in through the browser and the server connects",
	signedIn.text,
);
const signedInList = (await listMcpNamespaces(oauthWs)).find((namespace) => namespace.name === oauthName);
const echoedSignedIn = await callMcpTool(oauthName, "echo", { message: "signed in" });
report(
	signedInList?.status === "ready" && echoedSignedIn.text === "Echo: signed in",
	"after sign-in the server's tools run with the stored bearer token",
	`${signedInList?.status}, ${echoedSignedIn.text}`,
);
const storedAuth = JSON.parse(await readFile(join(stateDir, "mcp-auth.json"), "utf8"));
report(
	storedAuth[oauthName]?.tokens?.access_token !== undefined && storedAuth[oauthName]?.clientInfo?.client_id !== undefined,
	"tokens and client registration are stored in mcp-auth.json",
	Object.keys(storedAuth[oauthName] ?? {}).join(", "),
);
setMcpBrowserOpener(undefined);
await oauthServer.close();

// 9. Token file and OAuth state: written and encoded as Cursor's FileBasedTokenStore and encodeMcpOAuthState do.
const oursStore = mcpTokenStore(join(tmp, "parity-ours"));
// The oracle's vm context has its own Error class, so Cursor's ENOENT branch would not recognise a missing file; start from {}.
await mkdir(join(tmp, "parity-cursor"), { recursive: true });
await writeFile(join(tmp, "parity-cursor", "mcp-auth.json"), "{}");
const theirsStore = new c.FileBasedTokenStore(join(tmp, "parity-cursor", "mcp-auth.json"));
const registration = {
	client_id: "client-1",
	redirect_uris: ["http://localhost:8787/callback"],
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
	token_endpoint_auth_method: "none",
};
const tokens = { access_token: "access-1", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-1" };
for (const store of [oursStore, theirsStore]) {
	await store.saveClientInformation("srv", registration);
	await store.saveTokens("srv", tokens);
	await store.saveTokens("other", { access_token: "access-2" });
}
const oursFile = await readFile(join(tmp, "parity-ours", "mcp-auth.json"), "utf8");
const theirsFile = await readFile(join(tmp, "parity-cursor", "mcp-auth.json"), "utf8");
report(oursFile === theirsFile, "token file is written as Cursor's FileBasedTokenStore writes it", `${oursFile.length} bytes`);
const stateArgs = ["project-0-x-svc", { workspaceId: "http://localhost:8787/callback" }, "attempt-1"];
report(
	encodeOAuthState(...stateArgs) === c.encodeMcpOAuthState(...stateArgs),
	"OAuth state encodes as Cursor's encodeMcpOAuthState",
	encodeOAuthState(...stateArgs).slice(0, 40),
);
const sdkVersion = JSON.parse(await readFile(join(ROOT, "node_modules", "@modelcontextprotocol", "sdk", "package.json"), "utf8")).version;
report(sdkVersion === "1.25.1", "SDK pin matches the 1.25.1 that Cursor bundles", sdkVersion);

// 10. A failed stdio connect carries the child's stderr in its message, as Cursor's annotateMcpStdioConnectError does.
const failing = { command: "/bin/sh", args: ["-c", "echo 'boom: missing API key' >&2; exit 3"] };
const ourError = await McpServerClient.connect("failing", failing, mcpTokenStore(join(tmp, "stderr"))).then(
	() => "connected",
	(error) => error.message,
);
const cursorError = await c.McpSdkClient.fromCommand(c.createContext(), "failing", failing, {}).then(
	() => "connected",
	(error) => error.message,
);
report(
	ourError === cursorError && ourError.endsWith("; stderr: boom: missing API key"),
	"failed stdio connect carries stderr as Cursor's annotation",
	`ours=${ourError} cursor=${cursorError}`,
);

await closeMcp();
fixtureHttp.kill();
await rm(tmp, { recursive: true, force: true });

const failedLabels = checks.filter((check) => !check.ok).map((check) => check.label);
console.log(`\n${checks.length - failedLabels.length}/${checks.length} checks passed`);
if (failedLabels.length > 0) {
	console.log(`failed: ${failedLabels.join("; ")}`);
	process.exitCode = 1;
}
