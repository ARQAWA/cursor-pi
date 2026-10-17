#!/usr/bin/env bun
// Checks Cursor Pi's StrReplace and Write for Anthropic models against Cursor Desktop's own code, run through the oracle.
// Usage: bun tools/check-claude-edit.mjs
// Part 1: the generated declarations equal what Cursor's code builds for claude-opus-5-5, and the captured Anthropic request
// carries them, in Cursor's tool order, with ApplyPatch absent. Part 2: each case runs Cursor's createStrReplaceTool or
// createWriteTool and Cursor Pi's runStrReplace or runWrite on the same in-memory files, and compares the model text, isError,
// every write and the final files.

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCursor } from "./cursor-oracle.mjs";
import { anthropicEditTools, FORMATTING_OPTIONS, MODEL, stateHandler } from "./lib/cursor-edit-tools.mjs";
import { ANTHROPIC_TOOL_ORDER } from "../extensions/cursor-pi/tools/declarations.ts";
import { runStrReplace, runWrite } from "../extensions/cursor-pi/tools/edit/common.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "tools", "capture-request.mjs");
const GENERATED = join(ROOT, "extensions", "cursor-pi", "tools", "generated", "anthropic-edit-tools.json");
const ANTHROPIC = "anthropic/claude-opus-5-5";

let passed = 0;
let failed = 0;
function report(ok, label, detail = "") {
	if (ok) {
		passed++;
		console.log(`ok ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}${detail ? `:\n  ${detail}` : ""}`);
	}
}

function run(args) {
	return new Promise((resolveRun) => {
		const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stdout.resume();
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => resolveRun({ code: 1, stderr: error.message }));
		child.on("close", (code) => resolveRun({ code, stderr }));
	});
}

async function captureRecord(model) {
	const dir = await mkdtemp(join(tmpdir(), "cursor-pi-edit-"));
	const out = join(dir, "capture.json");
	const result = await run([CAPTURE, "--model", model, "--out", out]);
	if (result.code !== 0) throw new Error(`capture-request exit ${result.code}: ${result.stderr.trim().split("\n").pop() ?? ""}`);
	return JSON.parse(await readFile(out, "utf8"));
}

const file = (text, extra = {}) => ({
	kind: "content",
	text,
	truncated: false,
	fileSize: BigInt(Buffer.byteLength(text)),
	...extra,
});

const CASES = [
	{ name: "StrReplace replaces one match", tool: "StrReplace", files: { "/w/a.txt": file("one\ntwo\nthree\n") }, args: { path: "/w/a.txt", old_string: "two", new_string: "TWO" } },
	{ name: "StrReplace reports a string that is not found", tool: "StrReplace", files: { "/w/a.txt": file("one\ntwo\n") }, args: { path: "/w/a.txt", old_string: "zzz", new_string: "y" } },
	{ name: "StrReplace suggests a fuzzy match", tool: "StrReplace", files: { "/w/a.txt": file("function alpha() {\n  return 1;\n}\n") }, args: { path: "/w/a.txt", old_string: "function alpha() {\n  return 2;\n}", new_string: "x" } },
	{ name: "StrReplace not found even after relaxing whitespace", tool: "StrReplace", files: { "/w/a.txt": file("x = 1\n") }, args: { path: "/w/a.txt", old_string: "x =  1", new_string: "y" } },
	{ name: "StrReplace matches after relaxing whitespace", tool: "StrReplace", files: { "/w/a.txt": file("if x:\n    return 1\n") }, args: { path: "/w/a.txt", old_string: "if x:\n  return 1", new_string: "if x:\n    return 2" } },
	{ name: "StrReplace refuses several matches without replace_all", tool: "StrReplace", files: { "/w/a.txt": file("a\na\n") }, args: { path: "/w/a.txt", old_string: "a", new_string: "b" } },
	{ name: "StrReplace replace_all over several matches", tool: "StrReplace", files: { "/w/a.txt": file("a\na\n") }, args: { path: "/w/a.txt", old_string: "a", new_string: "b", replace_all: true } },
	{ name: "StrReplace replace_all over one match", tool: "StrReplace", files: { "/w/a.txt": file("x\ny\n") }, args: { path: "/w/a.txt", old_string: "x", new_string: "z", replace_all: true } },
	{ name: "StrReplace on a file that does not exist", tool: "StrReplace", files: {}, args: { path: "/w/none.txt", old_string: "x", new_string: "y" } },
	{ name: "StrReplace writes a CRLF file as LF text", tool: "StrReplace", files: { "/w/a.txt": file("one\r\ntwo\r\n") }, args: { path: "/w/a.txt", old_string: "two", new_string: "TWO" } },
	{ name: "StrReplace with identical strings", tool: "StrReplace", files: { "/w/a.txt": file("one\n") }, args: { path: "/w/a.txt", old_string: "one", new_string: "one" } },
	{ name: "StrReplace with an empty old_string", tool: "StrReplace", files: { "/w/a.txt": file("one\n") }, args: { path: "/w/a.txt", old_string: "", new_string: "x" } },
	{ name: "StrReplace read permission denied", tool: "StrReplace", files: { "/w/a.txt": { kind: "permissionDenied" } }, args: { path: "/w/a.txt", old_string: "one", new_string: "ONE" } },
	{ name: "StrReplace on a binary file", tool: "StrReplace", files: { "/w/a.txt": { kind: "binary" } }, args: { path: "/w/a.txt", old_string: "one", new_string: "ONE" } },
	{ name: "StrReplace declined at approval", tool: "StrReplace", files: { "/w/a.txt": file("one\n") }, outcome: { kind: "rejected", reason: "" }, args: { path: "/w/a.txt", old_string: "one", new_string: "ONE" } },
	{ name: "StrReplace write blocked by policy", tool: "StrReplace", files: { "/w/a.txt": file("one\n") }, outcome: { kind: "permissionDenied", error: "Blocked by cursor ignore" }, args: { path: "/w/a.txt", old_string: "one", new_string: "ONE" } },
	{ name: "Write creates a new file", tool: "Write", files: {}, args: { path: "/w/new.txt", contents: "hi\n" } },
	{ name: "Write overwrites an existing file", tool: "Write", files: { "/w/a.txt": file("old\n") }, args: { path: "/w/a.txt", contents: "new\n" } },
	{ name: "Write with a read error", tool: "Write", files: { "/w/a.txt": { kind: "error", message: "boom" } }, args: { path: "/w/a.txt", contents: "new\n" } },
	{ name: "Write declined at approval", tool: "Write", files: {}, outcome: { kind: "rejected", reason: "user said no" }, args: { path: "/w/new.txt", contents: "x" } },
	{ name: "Write with no space left", tool: "Write", files: {}, outcome: { kind: "noSpace" }, args: { path: "/w/new.txt", contents: "x" } },
	{ name: "Write with permission denied", tool: "Write", files: {}, outcome: { kind: "permissionDenied" }, args: { path: "/w/new.txt", contents: "x" } },
	{ name: "Write over a binary file", tool: "Write", files: { "/w/a.txt": { kind: "binary" } }, args: { path: "/w/a.txt", contents: "x" } },
];

function snapshot(store) {
	return [...store]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, read]) => [path, read.kind === "content" ? ["content", read.text] : [read.kind]]);
}

async function* streamOf(value) {
	yield value;
}

const interactionHandler = {
	emitPartialToolCall() {},
	emitToolCallDelta() {},
	rememberToolCallForArgPreservation() {},
	markToolCallForArgPreservation() {},
	emitToolCallError: async () => {},
	getAbortSignal: () => undefined,
	executeToolCall: async (ctx, _toolCall, _callId, promiseFn) => promiseFn(ctx),
};

function cursorRead(cursor, store) {
	return {
		async execute(_ctx, args) {
			const path = args.path;
			const read = store.get(path) ?? { kind: "notFound" };
			const result = (caseName, value) => new cursor.ReadResult({ result: { case: caseName, value } });
			switch (read.kind) {
				case "content":
					return result("success", new cursor.ReadSuccess({ path, output: { case: "content", value: read.text }, totalLines: 1, fileSize: read.fileSize, truncated: read.truncated }));
				case "binary":
					return result("success", new cursor.ReadSuccess({ path, output: { case: "data", value: new Uint8Array([0, 1, 2]) }, totalLines: 0, fileSize: 3n, truncated: false }));
				case "notFound":
					return result("fileNotFound", new cursor.ReadFileNotFound({ path }));
				case "permissionDenied":
					return result("permissionDenied", new cursor.ReadPermissionDenied({ path }));
				case "error":
					return result("error", new cursor.ReadError({ path, error: read.message }));
				default:
					throw new Error(`no read case ${read.kind}`);
			}
		},
	};
}

function cursorWrite(cursor, store, writes, outcome) {
	return {
		async execute(_ctx, args) {
			const path = args.path;
			const text = args.fileText;
			writes.push([path, text]);
			const result = (caseName, value) => new cursor.WriteResult({ result: { case: caseName, value } });
			switch (outcome?.kind) {
				case undefined:
					break;
				case "permissionDenied":
					return result("permissionDenied", new cursor.WritePermissionDenied({ path, error: outcome.error, isReadonly: false, directory: "", operation: "create_file" }));
				case "noSpace":
					return result("noSpace", new cursor.WriteNoSpace({ path }));
				case "rejected":
					return result("rejected", new cursor.WriteRejected({ path, reason: outcome.reason }));
				default:
					throw new Error(`no write case ${outcome.kind}`);
			}
			store.set(path, file(text));
			return result("success", new cursor.WriteSuccess({ path, linesCreated: text.split("\n").length, fileSize: BigInt(Buffer.byteLength(text)) }));
		},
	};
}

async function runCursor(cursor, testCase) {
	const store = new Map(Object.entries(testCase.files));
	const writes = [];
	const resources = {
		get(resource) {
			if (resource === cursor.readExecutorResource) return cursorRead(cursor, store);
			if (resource === cursor.writeExecutorResource) return cursorWrite(cursor, store, writes, testCase.outcome);
			throw new Error("edit check asked for an unexpected resource");
		},
	};
	const lock = new cursor.FileOperationLockManager();
	const tool =
		testCase.tool === "StrReplace"
			? cursor.createStrReplaceTool(resources, FORMATTING_OPTIONS, lock, stateHandler(), undefined, MODEL, {})
			: cursor.createWriteTool(resources, lock, stateHandler(), undefined, MODEL, {});
	const ctx = cursor.createContext();
	const meta = { toolCallId: "call_check", enableAgentStoreConflictNotices: false };
	let rendered;
	try {
		const output = await tool.execute(ctx, interactionHandler, streamOf(JSON.stringify(testCase.args)), meta);
		rendered = await cursor.renderEditResult(ctx, output, { allTools: {} });
	} catch (error) {
		const serialized = tool.serializeError(error);
		rendered = { ...(await cursor.renderEditResult(ctx, serialized.tool.value.result, { allTools: {} })), isError: true };
	}
	return { text: rendered.content[0].text, isError: rendered.isError === true, writes, files: snapshot(store) };
}

async function runOurs(testCase) {
	const store = new Map(Object.entries(testCase.files));
	const writes = [];
	const io = {
		async read(path) {
			return store.get(path) ?? { kind: "notFound" };
		},
		async write(path, text) {
			writes.push([path, text]);
			if (testCase.outcome) return testCase.outcome;
			store.set(path, file(text));
			return { kind: "success" };
		},
	};
	const result = testCase.tool === "StrReplace" ? await runStrReplace(testCase.args, io) : await runWrite(testCase.args, io);
	return { text: result.text, isError: result.isError, writes, files: snapshot(store) };
}

const cursor = await loadCursor();
const cursorTools = anthropicEditTools(cursor);
const expectedDeclarations = cursorTools.map(({ name, description, parameters }) => ({ type: "function", name, description, parameters }));

try {
	const generated = JSON.parse(await readFile(GENERATED, "utf8"));
	report(
		JSON.stringify(generated) === JSON.stringify(expectedDeclarations),
		"generated declarations equal Cursor's StrReplace and Write for claude-opus-5-5",
		`generated ${JSON.stringify(generated.map((tool) => tool.name))}`,
	);

	const { body } = await captureRecord(ANTHROPIC);
	const sent = Array.isArray(body.tools) ? body.tools : [];
	const names = sent.map((tool) => tool?.name);
	report(
		JSON.stringify(names) === JSON.stringify(ANTHROPIC_TOOL_ORDER),
		`${ANTHROPIC} tool order equals ANTHROPIC_TOOL_ORDER`,
		`sent ${JSON.stringify(names)}`,
	);
	report(!names.includes("ApplyPatch"), `${ANTHROPIC} sends no ApplyPatch`);
	for (const expected of expectedDeclarations) {
		const got = sent.find((tool) => tool?.name === expected.name);
		report(got?.description === expected.description, `${ANTHROPIC} ${expected.name} description equals Cursor's`);
		report(JSON.stringify(got?.input_schema) === JSON.stringify(expected.parameters), `${ANTHROPIC} ${expected.name} input_schema equals Cursor's`);
	}
} catch (error) {
	report(false, "Anthropic declarations and request", error.message);
}

for (const testCase of CASES) {
	try {
		const expected = await runCursor(cursor, testCase);
		const actual = await runOurs(testCase);
		report(
			JSON.stringify(expected) === JSON.stringify(actual),
			testCase.name,
			`cursor ${JSON.stringify(expected)}\n  ours   ${JSON.stringify(actual)}`,
		);
	} catch (error) {
		report(false, testCase.name, error?.stack ?? String(error));
	}
}

console.log(failed === 0 ? `all ${passed} checks match Cursor` : `${failed} of ${passed + failed} checks differ from Cursor`);
process.exit(failed === 0 ? 0 : 1);
