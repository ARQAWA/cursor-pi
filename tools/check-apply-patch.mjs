#!/usr/bin/env bun
// Checks Cursor Pi's ApplyPatch edit flow against Cursor Desktop's own apply-patch.js, run from the extracted bundle.
// Usage: bun tools/check-apply-patch.mjs
// Both sides read and write the same in-memory files. Each case compares the result text, isError, every write attempt
// and the final files. Local file access (encodings, permissions, symlinks) is not part of this check.
// Cases marked captured reproduce calls from research/cursor/reverse; their texts must also match what Cursor returned.

import { runApplyPatch } from "../extensions/cursor-pi/tools/apply-patch/edit-flow.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const CURSOR_MODULES = [
	"../agent-exec/dist/read.js",
	"../agent-exec/dist/write.js",
	"../agent/dist/tools/common.js",
	"../agent/dist/tools/core/file-operation-lock-manager.js",
	"../agent/dist/tools/core/edit/common.js",
	"../agent/dist/tools/core/edit/post-write-result-decoration.js",
	"../agent/dist/tools/core/edit/codex-parser.js",
	"../agent/dist/tools/core/edit/apply-patch.js",
];

const cursor = await loadCursor();
for (const marker of CURSOR_MODULES) initModule(cursor, marker);

const file = (value, extra = {}) => ({
	kind: "content",
	text: value,
	truncated: false,
	fileSize: BigInt(Buffer.byteLength(value)),
	...extra,
});

const UPDATE_A = "*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-one\n+ONE\n*** End Patch";
const ADD_NEW = "*** Begin Patch\n*** Add File: /w/new.txt\n+a\n+b\n*** End Patch";
const CAPTURED_0038 = "*** Begin Patch\n*** Add File: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH-t2-worktree/NOTE.md\n+T2 best-of-n probe.\n*** End Patch";
const CAPTURED_0054 = "*** Begin Patch\n*** Add File: /Users/arkadijcukavin/cursor-reverse-2026-10-09/runs-2026-10-16/T2/lint_probe.py\n+def broken(\n*** End Patch";
const CAPTURED_0055 = "*** Begin Patch\n*** Update File: /Users/arkadijcukavin/cursor-reverse-2026-10-09/runs-2026-10-16/T2/lint_probe.py\n@@\n-def broken(\n+def fixed() -> None:\n+    pass\n*** End Patch";
const CAPTURED_T3 = "*** Begin Patch\n*** Add File: /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/T3_probe.py\n+def evaluate_input():\n+    return eval(input())\n+\n+def average(values):\n+    return sum(values) / len(values)\n*** End Patch";

const CASES = [
	{ name: "add new file", files: {}, steps: [ADD_NEW] },
	{ name: "add with empty body", files: {}, steps: ["*** Begin Patch\n*** Add File: /w/empty.txt\n*** End Patch"] },
	{ name: "add over existing file prepends", files: { "/w/a.txt": file("old\n") }, steps: ["*** Begin Patch\n*** Add File: /w/a.txt\n+new\n*** End Patch"] },
	{ name: "add line without +", files: {}, steps: ["*** Begin Patch\n*** Add File: /w/x.txt\nx\n*** End Patch"] },
	{ name: "update replaces a line", files: { "/w/a.txt": file("one\ntwo\nthree\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n one\n-two\n+TWO\n three\n*** End Patch"] },
	{ name: "update with @@ class header", files: { "/w/a.txt": file("class A:\n  def f():\n    pass\nclass B:\n  def f():\n    pass\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@ class B:\n   def f():\n-    pass\n+    return 1\n*** End Patch"] },
	{ name: "update with End of File marker", files: { "/w/a.txt": file("a\nb\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-b\n+c\n*** End of File\n*** End Patch"] },
	{ name: "update with no hunks", files: { "/w/a.txt": file("one\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n*** End Patch"] },
	{ name: "update with missing context", files: { "/w/a.txt": file("one\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-zzz\n+yyy\n*** End Patch"] },
	{ name: "update with end-of-file context longer than the file", files: { "/w/a.txt": file("a") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-x\n-y\n*** End of File\n*** End Patch"] },
	{ name: "missing Begin Patch", files: { "/w/a.txt": file("one\n") }, steps: ["*** Update File: /w/a.txt\n*** End Patch"] },
	{ name: "delete-only patch has no add/update header", files: { "/w/a.txt": file("one\n") }, steps: ["*** Begin Patch\n*** Delete File: /w/a.txt\n*** End Patch"] },
	{ name: "delete after update", files: { "/w/a.txt": file("one\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n*** Delete File: /w/b.txt\n*** End Patch"] },
	{ name: "move to after update", files: { "/w/a.txt": file("one\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n*** Move to: /w/b.txt\n@@\n-one\n+ONE\n*** End Patch"] },
	{ name: "two files in one patch, both missing", files: {}, steps: ["*** Begin Patch\n*** Add File: /w/x.txt\n+x\n*** Add File: /w/y.txt\n+y\n*** End Patch"] },
	{ name: "two files in one patch, first exists", files: { "/w/x.txt": file("q\n") }, steps: ["*** Begin Patch\n*** Update File: /w/x.txt\n+x\n*** Add File: /w/y.txt\n+y\n*** End Patch"] },
	{ name: "update of missing file with context", files: {}, steps: ["*** Begin Patch\n*** Update File: /w/none.txt\n@@\n-x\n+y\n*** End Patch"] },
	{ name: "update of missing file with + lines creates it", files: {}, steps: ["*** Begin Patch\n*** Update File: /w/none.txt\n+hello\n*** End Patch"] },
	{ name: "read error saying the file does not exist creates it", files: { "/w/a.txt": { kind: "error", message: "Unable to resolve nonexistent file: /w/a.txt" } }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n+z\n*** End Patch"] },
	{ name: "JSON-wrapped patch", files: {}, steps: [JSON.stringify({ patch: "*** Begin Patch\n*** Add File: /w/j.txt\n+j\n*** End Patch" })] },
	{ name: "JSON with another key is raw text", files: {}, steps: [JSON.stringify({ patch: "x", other: 1 })] },
	{ name: "CRLF original is written as LF text", files: { "/w/a.txt": file("one\r\ntwo\r\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-two\n+TWO\n*** End Patch"] },
	{ name: "CRLF patch text", files: { "/w/a.txt": file("one\ntwo\n") }, steps: ["*** Begin Patch\r\n*** Update File: /w/a.txt\r\n@@\r\n-two\r\n+TWO\r\n*** End Patch\r\n"] },
	{ name: "no trailing newline is kept", files: { "/w/a.txt": file("a\nb") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-b\n+c\n*** End Patch"] },
	{ name: "trailing spaces match with fuzz", files: { "/w/a.txt": file("x  \ny\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-x\n+X\n*** End Patch"] },
	{ name: "curly quotes match straight quotes", files: { "/w/a.txt": file("say \u201Chi\u201D\n") }, steps: ['*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-say "hi"\n+say bye\n*** End Patch'] },
	{ name: "update of an empty file", files: { "/w/a.txt": file("") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n+x\n*** End Patch"] },
	{ name: "patch without a file header", files: {}, steps: ["*** Begin Patch\n+x\n*** End Patch"] },
	{ name: "two hunks in one update", files: { "/w/a.txt": file("a\nb\nc\nd\ne\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-a\n+A\n@@\n-d\n+D\n*** End Patch"] },
	{ name: "pure insertion hunk", files: { "/w/a.txt": file("a\nb\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@\n a\n+x\n b\n*** End Patch"] },
	{ name: "unknown @@ header falls back to context search", files: { "/w/a.txt": file("one\ntwo\n") }, steps: ["*** Begin Patch\n*** Update File: /w/a.txt\n@@ nosuch\n-two\n+TWO\n*** End Patch"] },
	{ name: "Add File body with a @@ line", files: {}, steps: ["*** Begin Patch\n*** Add File: /w/n.txt\n@@\n+x\n*** End Patch"] },
	{ name: "read permission denied", files: { "/w/a.txt": { kind: "permissionDenied" } }, steps: [UPDATE_A] },
	{ name: "read of a binary file", files: { "/w/a.txt": { kind: "binary" } }, steps: [UPDATE_A] },
	{ name: "read of a file too large to edit", files: { "/w/a.txt": file("abc", { truncated: true, fileSize: 9000000n }) }, steps: [UPDATE_A] },
	{ name: "read invalid file without reason", files: { "/w/a.txt": { kind: "invalidFile", reason: "" } }, steps: [UPDATE_A] },
	{ name: "read invalid file with reason", files: { "/w/a.txt": { kind: "invalidFile", reason: "Path is a directory, not a file" } }, steps: [UPDATE_A] },
	{ name: "read error", files: { "/w/a.txt": { kind: "error", message: "boom" } }, steps: [UPDATE_A] },
	{ name: "read rejected", files: { "/w/a.txt": { kind: "rejected", reason: "nope" } }, steps: [UPDATE_A] },
	{ name: "write blocked by cursor ignore", files: {}, outcome: { kind: "permissionDenied", error: "Blocked by cursor ignore" }, steps: [ADD_NEW] },
	{ name: "write permission denied without detail", files: {}, outcome: { kind: "permissionDenied" }, steps: [ADD_NEW] },
	{ name: "write no space", files: {}, outcome: { kind: "noSpace" }, steps: [ADD_NEW] },
	{ name: "write rejected", files: {}, outcome: { kind: "rejected", reason: "user said no" }, steps: [ADD_NEW] },
	{ name: "write error", files: {}, outcome: { kind: "error", message: "disk on fire" }, steps: [ADD_NEW] },
	{
		name: "captured call 0038 (Add NOTE.md)",
		files: {},
		steps: [CAPTURED_0038],
		captured: ["Success. Updated the following files:\nA /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH-t2-worktree/NOTE.md"],
	},
	{
		name: "captured calls 0054 then 0055 (Add, then Update lint_probe.py)",
		files: {},
		steps: [CAPTURED_0054, CAPTURED_0055],
		captured: [
			"Success. Updated the following files:\nA /Users/arkadijcukavin/cursor-reverse-2026-10-09/runs-2026-10-16/T2/lint_probe.py",
			"The file /Users/arkadijcukavin/cursor-reverse-2026-10-09/runs-2026-10-16/T2/lint_probe.py has been updated.",
		],
	},
	{
		name: "captured call T3 009 (Add T3_probe.py)",
		files: {},
		steps: [CAPTURED_T3],
		captured: ["Success. Updated the following files:\nA /Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/T3_probe.py"],
	},
];

// Cursor's interaction handler: errors thrown by the tool body reach the caller unchanged, as in Cursor.
const interactionHandler = {
	emitPartialToolCall() {},
	emitToolCallDelta() {},
	rememberToolCallForArgPreservation() {},
	markToolCallForArgPreservation() {},
	emitToolCallError: async () => {},
	getAbortSignal: () => undefined,
	executeToolCall: async (ctx, _toolCall, _callId, promiseFn) => promiseFn(ctx),
};

async function* streamOf(value) {
	yield value;
}

function snapshot(store) {
	return [...store]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, read]) => [path, read.kind === "content" ? ["content", read.text] : [read.kind]]);
}

function cursorRead(store) {
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
				case "invalidFile":
					return result("invalidFile", new cursor.ReadInvalidFile({ path, reason: read.reason }));
				case "error":
					return result("error", new cursor.ReadError({ path, error: read.message }));
				case "rejected":
					return result("rejected", new cursor.ReadRejected({ path, reason: read.reason }));
				default:
					throw new Error(`no read case ${read.kind}`);
			}
		},
	};
}

function cursorWrite(store, writes, outcome) {
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
				case "error":
					return result("error", new cursor.WriteError({ path, error: outcome.message }));
				default:
					throw new Error(`no write case ${outcome.kind}`);
			}
			store.set(path, file(text));
			return result("success", new cursor.WriteSuccess({ path, linesCreated: text.split("\n").length, fileSize: BigInt(Buffer.byteLength(text)) }));
		},
	};
}

async function runCursor(testCase) {
	const store = new Map(Object.entries(testCase.files));
	const writes = [];
	const resources = {
		get(resource) {
			if (resource === cursor.readExecutorResource) return cursorRead(store);
			if (resource === cursor.writeExecutorResource) return cursorWrite(store, writes, testCase.outcome);
			throw new Error("ApplyPatch check asked for an unexpected resource");
		},
	};
	const stateHandler = { mode: undefined, plans: new Map(), todos: [], recordFileState() {} };
	const tool = cursor.createApplyPatchTool(resources, undefined, new cursor.FileOperationLockManager(), stateHandler, {});
	const results = [];
	for (const input of testCase.steps) {
		const ctx = cursor.createContext();
		const meta = { toolCallId: "call_check", enableAgentStoreConflictNotices: false };
		let rendered;
		try {
			const output = await tool.execute(ctx, interactionHandler, streamOf(input), meta);
			rendered = await cursor.renderEditResult(ctx, output, { allTools: {} });
		} catch (error) {
			const serialized = tool.serializeError(error);
			rendered = { ...(await cursor.renderEditResult(ctx, serialized.tool.value.result, { allTools: {} })), isError: true };
		}
		results.push({ text: rendered.content[0].text, isError: rendered.isError === true });
	}
	return { results, writes, files: snapshot(store) };
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
	const results = [];
	for (const input of testCase.steps) {
		results.push(await runApplyPatch(input, io));
	}
	return { results, writes, files: snapshot(store) };
}

// The oracle runs Cursor's code under Bun's JavaScriptCore, which words this TypeError differently from V8, the engine
// Cursor Desktop runs. The Cursor side is mapped to V8 wording so both sides compare on the same text.
const V8_WORDING = new Map([
	[
		"Error: undefined is not an object (evaluating 's3.normalize')",
		"Error: Cannot read properties of undefined (reading 'normalize')",
	],
]);

function normalizeEngineWording(run) {
	return { ...run, results: run.results.map((r) => ({ ...r, text: V8_WORDING.get(r.text) ?? r.text })) };
}

let failed = 0;
for (const testCase of CASES) {
	try {
		const expected = normalizeEngineWording(await runCursor(testCase));
		const actual = await runOurs(testCase);
		const problems = [];
		if (testCase.captured && testCase.captured.some((want, i) => expected.results[i]?.text !== want)) {
			problems.push(`  Cursor text differs from the captured call: ${JSON.stringify(expected.results.map((r) => r.text))}`);
		}
		if (JSON.stringify(expected) !== JSON.stringify(actual)) {
			problems.push(`  cursor ${JSON.stringify(expected)}\n  ours   ${JSON.stringify(actual)}`);
		}
		if (problems.length === 0) {
			console.log(`ok ${testCase.name}`);
		} else {
			failed++;
			console.log(`FAIL ${testCase.name}:\n${problems.join("\n")}`);
		}
	} catch (error) {
		failed++;
		console.log(`FAIL ${testCase.name}: ${error?.stack ?? error}`);
	}
}
console.log(failed === 0 ? `all ${CASES.length} cases match Cursor` : `${failed} of ${CASES.length} cases differ`);

// End-to-end cases: executeApplyPatch on real files in a temp workspace. The expected text and bytes follow Cursor's
// code paths (the read and write executors, the permission rules and performEdit's messages); they are written out
// here, not produced by running Cursor, because Cursor's encoding helpers are not exported from the bundle.
const { executeApplyPatch } = await import("../extensions/cursor-pi/tools/apply-patch.ts");
const { mkdtemp, mkdir, readFile, writeFile, rm } = await import("node:fs/promises");
const { tmpdir, homedir } = await import("node:os");
const { dirname, join, resolve } = await import("node:path");

const utf8Bytes = (s) => [...Buffer.from(s, "utf8")];
const latin1Bytes = (s) => [...Buffer.from(s, "latin1")];
const bomBytes = (s) => [0xef, 0xbb, 0xbf, ...Buffer.from(s, "utf8")];

async function runE2E(root, { files, input, approve, hasUI = true, expectFiles }) {
	for (const [name, bytes] of Object.entries(files)) {
		await mkdir(dirname(join(root, name)), { recursive: true });
		await writeFile(join(root, name), Buffer.from(bytes));
	}
	const prompts = [];
	const ctx = {
		cwd: root,
		hasUI,
		ui: {
			confirm: async (title, message) => {
				prompts.push(message);
				return approve ? approve(title, message) : false;
			},
		},
	};
	const result = await executeApplyPatch({ input }, undefined, ctx);
	const fileBytes = {};
	for (const name of Object.keys(expectFiles)) {
		try {
			fileBytes[name] = [...(await readFile(resolve(root, name)))];
		} catch {
			fileBytes[name] = null;
		}
	}
	return { text: result.content[0].text, isError: result.isError, prompts: prompts.length, files: fileBytes };
}

const outDir = join(homedir(), `.cursor-pi-apply-check-${process.pid}`);
const outFile = join(outDir, "out.txt");
const E2E = [
	{ name: "e2e update keeps CRLF line endings", files: { "crlf.txt": utf8Bytes("a\r\nb\r\nc\r\n") }, input: "*** Begin Patch\n*** Update File: crlf.txt\n@@\n a\n-b\n+B\n c\n*** End Patch", expect: { text: "The file crlf.txt has been updated.", isError: false, prompts: 0, files: { "crlf.txt": utf8Bytes("a\r\nB\r\nc\r\n") } } },
	{ name: "e2e update keeps LF line endings", files: { "lf.txt": utf8Bytes("a\nb\n") }, input: "*** Begin Patch\n*** Update File: lf.txt\n@@\n a\n-b\n+B\n*** End Patch", expect: { text: "The file lf.txt has been updated.", isError: false, prompts: 0, files: { "lf.txt": utf8Bytes("a\nB\n") } } },
	{ name: "e2e update keeps a UTF-8 BOM", files: { "bom.txt": bomBytes("a\nb\n") }, input: "*** Begin Patch\n*** Update File: bom.txt\n@@\n-b\n+B\n*** End Patch", expect: { text: "The file bom.txt has been updated.", isError: false, prompts: 0, files: { "bom.txt": bomBytes("a\nB\n") } } },
	{ name: "e2e update keeps a non-UTF-8 (latin1) file", files: { "latin.txt": latin1Bytes("caf\u00e9\nx\n") }, input: "*** Begin Patch\n*** Update File: latin.txt\n@@\n-x\n+y\n*** End Patch", expect: { text: "The file latin.txt has been updated.", isError: false, prompts: 0, files: { "latin.txt": latin1Bytes("caf\u00e9\ny\n") } } },
	{ name: "e2e add a file in a new directory", files: {}, input: "*** Begin Patch\n*** Add File: sub/new.txt\n+hello\n+world\n*** End Patch", expect: { text: "Success. Updated the following files:\nA sub/new.txt", isError: false, prompts: 0, files: { "sub/new.txt": utf8Bytes("hello\nworld\n") } } },
	{ name: "e2e protected config file: approved", files: {}, approve: async () => true, input: "*** Begin Patch\n*** Add File: .vscode/settings.json\n+{}\n*** End Patch", expect: { text: "Success. Updated the following files:\nA .vscode/settings.json", isError: false, prompts: 1, files: { ".vscode/settings.json": utf8Bytes("{}\n") } } },
	{ name: "e2e protected config file: rejected", files: {}, approve: async () => false, input: "*** Begin Patch\n*** Add File: .vscode/settings.json\n+{}\n*** End Patch", expect: { text: "Error: Edit rejected: ", isError: true, prompts: 1, files: { ".vscode/settings.json": null } } },
	{ name: "e2e .cursorignore blocks the read", files: { "secret.txt": utf8Bytes("x\n"), ".cursorignore": utf8Bytes("secret.txt\n") }, input: "*** Begin Patch\n*** Update File: secret.txt\n@@\n-x\n+y\n*** End Patch", expect: { text: "Error: Read permission denied: secret.txt", isError: true, prompts: 0, files: { "secret.txt": utf8Bytes("x\n"), ".cursorignore": utf8Bytes("secret.txt\n") } } },
	{ name: ".cursorignore itself cannot be written", files: {}, input: "*** Begin Patch\n*** Add File: .cursorignore\n+x\n*** End Patch", expect: { text: "Error: Write permission denied: .cursorignore: Blocked by permissions configuration", isError: true, prompts: 0, files: { ".cursorignore": null } } },
	{ name: "e2e outside the workspace: approved", files: {}, approve: async () => true, input: `*** Begin Patch\n*** Add File: ${outFile}\n+ok\n*** End Patch`, expect: { text: `Success. Updated the following files:\nA ${outFile}`, isError: false, prompts: 1, files: { [outFile]: utf8Bytes("ok\n") } } },
	{ name: "e2e outside the workspace: rejected", files: {}, approve: async () => false, input: `*** Begin Patch\n*** Add File: ${outFile}\n+ok\n*** End Patch`, expect: { text: "Error: Edit rejected: ", isError: true, prompts: 1, files: { [outFile]: null } } },
	{ name: "e2e outside the workspace: no UI", files: {}, hasUI: false, input: `*** Begin Patch\n*** Add File: ${outFile}\n+ok\n*** End Patch`, expect: { text: "Error: Edit rejected: ", isError: true, prompts: 0, files: { [outFile]: null } } },
];

let failedE2E = 0;
try {
	await mkdir(outDir, { recursive: true });
	for (const c of E2E) {
		await rm(outFile, { force: true });
		const root = await mkdtemp(join(tmpdir(), "apply-e2e-"));
		try {
			const got = await runE2E(root, { files: c.files, input: c.input, approve: c.approve, hasUI: c.hasUI, expectFiles: c.expect.files });
			const want = JSON.stringify(c.expect);
			const have = JSON.stringify({ text: got.text, isError: got.isError, prompts: got.prompts, files: got.files });
			if (want === have) {
				console.log(`ok ${c.name}`);
			} else {
				failedE2E++;
				console.log(`FAIL ${c.name}:\n  want ${want}\n  got  ${have}`);
			}
		} catch (error) {
			failedE2E++;
			console.log(`FAIL ${c.name}: ${error?.stack ?? error}`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
} finally {
		await rm(outDir, { recursive: true, force: true });
}
console.log(failedE2E === 0 ? `all ${E2E.length} end-to-end cases pass` : `${failedE2E} of ${E2E.length} end-to-end cases fail`);
process.exit(failed + failedE2E === 0 ? 0 : 1);
