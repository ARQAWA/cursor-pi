#!/usr/bin/env bun
// Checks the cursor-namespace EditNotebook against Cursor Desktop 3.25.6's own edit-notebook.js, run from the extracted bundle.
// Usage: bun tools/check-edit-notebook.mjs
// Cursor's tool and ours run the same steps on the same in-memory notebooks; each case compares the result text, isError, every
// write and the final files. Notebook parsing is compared on its own. The end-to-end cases run executeEditNotebook on real files;
// their expected bytes follow Cursor's JSON form and the encoding, line-ending, BOM and approval rules, written out here.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { executeEditNotebook, parseEditNotebookArgs, parseNotebook, runEditNotebook } from "../extensions/cursor-pi/tools/namespace/edit-notebook.ts";
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
	"../agent/dist/tools/core/notebook-utils.js",
	"../agent/dist/tools/core/edit/edit-notebook.js",
];

const cursor = await loadCursor();
for (const marker of CURSOR_MODULES) initModule(cursor, marker);

// The formatting options of Cursor's agent default config.
const FORMATTING = { shouldUseFormatCodeblock: true, gpt5StyleLineNumbers: false, gpt5CodexCatN: false };

let checks = 0;
let failures = 0;
function report(name, ok, detail = "") {
	checks += 1;
	if (ok) {
		console.log(`ok ${name}`);
		return;
	}
	failures += 1;
	console.log(`FAIL ${name}`);
	if (detail) console.log(detail);
}

const file = (value, extra = {}) => ({ kind: "content", text: value, truncated: false, fileSize: BigInt(Buffer.byteLength(value)), ...extra });
const CODE = (source, extra = {}) => ({ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source, ...extra });
const MD = (source) => ({ cell_type: "markdown", metadata: {}, source });
const notebook = (cells, { minor = 4, ...extra } = {}) => `${JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: minor, ...extra }, null, 1)}\n`;

const NB_A = notebook([CODE(["print(1)\n", "x = 2"]), MD("# Title")]);
const NB_B = notebook([CODE("y = 1", { execution_count: 3, metadata: { tags: ["t"] }, outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }, { output_type: "execute_result", execution_count: 3, data: { "text/plain": "2" }, metadata: {} }], attachments: {} })], { kernelspec: { name: "python3" } });
const NB_C = notebook([CODE(["a = 1"], { id: "abcd1234" })], { minor: 5 });
const NB_D = notebook([CODE("a = 1\na = 1")]);
const NB_E = notebook([CODE("aaa")]);
const NB_F = notebook([CODE("")]);
const NB_G = notebook([CODE(["keep\n", "drop me\n", "end"])]);
const NB_CRLF = NB_A.replace(/\n/g, "\r\n");
const NB_LATIN = notebook([CODE(["print(1)\n", "x = 2"]), MD("caf\u00e9")]);

const edit = (over) => ({ target_notebook: "nb.ipynb", cell_idx: 0, is_new_cell: false, cell_language: "python", old_string: "", new_string: "", ...over });
const insert = (over) => ({ target_notebook: "nb.ipynb", cell_idx: 1, is_new_cell: true, cell_language: "python", old_string: "", new_string: "z = 9", ...over });

const CASES = [
	{ name: "replace a line in a code cell", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "replace a range across two lines of a cell", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "print(1)\nx = 2", new_string: "z = 3" })] },
	{ name: "edit a markdown cell whose source is a string", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ cell_idx: 1, cell_language: "markdown", old_string: "# Title", new_string: "# Heading" })] },
	{ name: "two edits to one notebook in one run", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" }), edit({ old_string: "print(2)", new_string: "print(3)" })] },
	{ name: "whitespace-insensitive match on a trailing-space needle", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "print(1)  ", new_string: "print(9)" })] },
	{ name: "not found after relaxing whitespace, with a fuzzy hint", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "print(1)\nx = 3", new_string: "x = 4" })] },
	{ name: "not found with no line to suggest", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "zzz", new_string: "y" })] },
	{ name: "string found twice in the cell", files: { "nb.ipynb": file(NB_D) }, steps: [edit({ old_string: "a = 1", new_string: "b = 2" })] },
	{ name: "overlapping occurrences", files: { "nb.ipynb": file(NB_E) }, steps: [edit({ old_string: "aa", new_string: "b" })] },
	{ name: "old_string equal to new_string", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "x = 2", new_string: "x = 2" })] },
	{ name: "empty old_string on a cell with content", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "", new_string: "z" })] },
	{ name: "empty old_string on an empty cell fills it", files: { "nb.ipynb": file(NB_F) }, steps: [edit({ old_string: "", new_string: "new" })] },
	{ name: "a deleted line leaves its neighbours", files: { "nb.ipynb": file(NB_G) }, steps: [edit({ old_string: "drop me", new_string: "" })] },
	{ name: "a deleted tail line with no trailing newline", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "x = 2", new_string: "" })] },
	{ name: "CRLF in new_string is read as LF", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ old_string: "x = 2", new_string: "x = 5\r\ny = 6" })] },
	{ name: "CRLF file is parsed after CRLF is normalised", files: { "nb.ipynb": file(NB_CRLF) }, steps: [edit({ old_string: "x = 2", new_string: "x = 5" })] },
	{ name: "string index and string boolean are read", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ cell_idx: "1", is_new_cell: "false", cell_language: "markdown", old_string: "# Title", new_string: "# T" })] },
	{ name: "insert a code cell in the middle", files: { "nb.ipynb": file(NB_A) }, steps: [insert({})] },
	{ name: "insert a markdown cell", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_language: "markdown", new_string: "## Notes" })] },
	{ name: "insert a raw cell with several lines", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_language: "raw", new_string: "a\nb\n" })] },
	{ name: "insert past the end appends", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_idx: 99 })] },
	{ name: "insert at a negative index", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_idx: -1 })] },
	{ name: "insert at a fractional index", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_idx: 1.5 })] },
	{ name: "is_new_cell as the string true inserts at 0", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ cell_idx: 0, is_new_cell: "true" })] },
	{ name: "insert into a 4.5 notebook gives the cell an id", files: { "nb.ipynb": file(NB_C) }, steps: [insert({ cell_idx: 0, new_string: "a = 0" })] },
	{ name: "insert with old_string set", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ old_string: "x" })] },
	{ name: "edit index past the end", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ cell_idx: 5, old_string: "x", new_string: "y" })] },
	{ name: "edit at a negative index", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ cell_idx: -1, old_string: "x", new_string: "y" })] },
	{ name: "edit at a fractional index", files: { "nb.ipynb": file(NB_A) }, steps: [edit({ cell_idx: 1.5, old_string: "x", new_string: "y" })] },
	{ name: "notebook keeps only the schema's keys and order", files: { "nb.ipynb": file(NB_B) }, steps: [edit({ old_string: "y = 1", new_string: "y = 2" })] },
	{ name: "invalid JSON", files: { "nb.ipynb": file("{not json") }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "top-level array", files: { "nb.ipynb": file("[]") }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "notebook without cells", files: { "nb.ipynb": file('{"nbformat":4}') }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "cell with a bad cell_type", files: { "nb.ipynb": file('{"cells":[{"cell_type":"foo","source":"x"}]}') }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "cell with a non-string cell_type", files: { "nb.ipynb": file('{"cells":[{"cell_type":5,"source":"x"}]}') }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "cell without source", files: { "nb.ipynb": file('{"cells":[{"cell_type":"code"}]}') }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "several notebook problems in zod's order", files: { "nb.ipynb": file('{"cells":[{"cell_type":"code","source":"x","outputs":[{"output_type":5,"traceback":[1]}]},{"source":"y"}],"nbformat":"4"}') }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "binary file", files: { "nb.ipynb": { kind: "binary" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "file not found", files: {}, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "read permission denied", files: { "nb.ipynb": { kind: "permissionDenied" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "read error", files: { "nb.ipynb": { kind: "error", message: "boom" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "read error saying the file does not exist", files: { "nb.ipynb": { kind: "error", message: "Unable to resolve nonexistent file: nb.ipynb" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "invalid file with a reason", files: { "nb.ipynb": { kind: "invalidFile", reason: "Path is a directory, not a file" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "invalid file without a reason", files: { "nb.ipynb": { kind: "invalidFile", reason: "" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "read rejected", files: { "nb.ipynb": { kind: "rejected", reason: "nope" } }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "file too large to edit", files: { "nb.ipynb": file(NB_A, { truncated: true, fileSize: 9000000n }) }, steps: [edit({ old_string: "x", new_string: "y" })] },
	{ name: "write blocked by cursor ignore", files: { "nb.ipynb": file(NB_A) }, outcome: { kind: "permissionDenied", error: "Blocked by cursor ignore" }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "write permission denied without detail", files: { "nb.ipynb": file(NB_A) }, outcome: { kind: "permissionDenied" }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "write no space", files: { "nb.ipynb": file(NB_A) }, outcome: { kind: "noSpace" }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "write rejected", files: { "nb.ipynb": file(NB_A) }, outcome: { kind: "rejected", reason: "user said no" }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "write error", files: { "nb.ipynb": file(NB_A) }, outcome: { kind: "error", message: "disk on fire" }, steps: [edit({ old_string: "print(1)", new_string: "print(2)" })] },
	{ name: "no arguments", files: {}, steps: [{}] },
	{ name: "wrong argument types", files: {}, steps: [{ target_notebook: 5, cell_idx: "abc", is_new_cell: "yes", cell_language: null, old_string: "x", new_string: "y" }] },
	{ name: "is_new_cell spelled 1 is not a boolean", files: { "nb.ipynb": file(NB_A) }, steps: [insert({ is_new_cell: "1" })] },
	{ name: "old_string as a number", files: {}, steps: [edit({ old_string: 5, new_string: "y" })] },
	{ name: "array arguments", files: {}, steps: [[]] },
];

const PARSE_TEXTS = [
	NB_A,
	NB_B,
	NB_C,
	"{}",
	"[]",
	"null",
	"{not json",
	'{"cells":[]}',
	'{"cells":[],"nbformat":4,"nbformat_minor":5,"metadata":null}',
	'{"cells":[{"cell_type":"markdown","source":["a","b"],"metadata":{"x":1},"id":"abc12345","attachments":{}}]}',
	'{"cells":[{"cell_type":"code","source":"","execution_count":null,"outputs":[{"output_type":"display_data","data":{"text/plain":"x"},"metadata":{}}]}]}',
	'{"cells":[{"cell_type":"code","source":"x","execution_count":"1"}]}',
	'{"cells":[{"cell_type":"code","source":"x","outputs":[{"text":5}]}]}',
	'{"cells":[{"cell_type":"code","source":["a",1]}]}',
	'{"cells":"x"}',
	'{"cells":[{"cell_type":"foo","source":"x"}]}',
	'{"cells":[{"cell_type":5,"source":"x"}]}',
	'{"cells":[{"cell_type":"code"}]}',
	'{"cells":[{"cell_type":"code","source":"x","metadata":[]}]}',
	'{"cells":[{"cell_type":"code","source":"x","outputs":[{"output_type":5,"traceback":[1]}]},{"source":"y"}],"nbformat":"4"}',
	'{"nbformat":4}',
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

// Cell ids of notebook format 4.5 are random, so both sides' ids are masked before they are compared.
function masked(run) {
	const mask = (text) => text.replace(/"id": "[0-9a-f]{8}"/g, '"id": "<id>"');
	return {
		results: run.results,
		writes: run.writes.map(([path, text]) => [path, mask(text)]),
		files: run.files.map(([path, read]) => [path, read[0] === "content" ? ["content", mask(read[1])] : read]),
	};
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
			throw new Error("EditNotebook check asked for an unexpected resource");
		},
	};
	const stateHandler = { mode: undefined, plans: new Map(), todos: [], recordFileState() {} };
	const tool = cursor.createEditNotebookTool(resources, FORMATTING, new cursor.FileOperationLockManager(), stateHandler, "latest", undefined, undefined);
	const results = [];
	for (const args of testCase.steps) {
		const ctx = cursor.createContext();
		const meta = { toolCallId: "call_check", enableAgentStoreConflictNotices: false };
		let rendered;
		try {
			const output = await tool.execute(ctx, interactionHandler, streamOf(JSON.stringify(args)), meta);
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
	for (const args of testCase.steps) {
		const parsed = parseEditNotebookArgs(args);
		results.push(parsed.ok ? await runEditNotebook(parsed.args, io) : { text: `Error: ${parsed.error}`, isError: true });
	}
	return { results, writes, files: snapshot(store) };
}

// Notebook parsing on its own: Cursor's parseNotebook and ours must agree on success, the parsed notebook's JSON and the error text.
for (const text of PARSE_TEXTS) {
	const theirs = cursor.parseNotebook(text);
	const ours = parseNotebook(text);
	const same = ours.ok ? theirs.success === true && JSON.stringify(theirs.notebook) === JSON.stringify(ours.notebook) : theirs.success === false && theirs.errorDetails === ours.errorDetails;
	report(`parse ${JSON.stringify(text).slice(0, 80)}`, same, same ? "" : `  cursor ${JSON.stringify(theirs)}\n  ours   ${JSON.stringify(ours)}`);
}

for (const testCase of CASES) {
	try {
		const expected = masked(await runCursor(testCase));
		const actual = masked(await runOurs(testCase));
		const same = JSON.stringify(expected) === JSON.stringify(actual);
		report(testCase.name, same, same ? "" : `  cursor ${JSON.stringify(expected)}\n  ours   ${JSON.stringify(actual)}`);
	} catch (error) {
		report(testCase.name, false, `  ${error?.stack ?? error}`);
	}
}

// End-to-end cases: executeEditNotebook on real files in a temp workspace, with the bytes Cursor's paths produce.
const utf8 = (s) => [...Buffer.from(s, "utf8")];
const latin1 = (s) => [...Buffer.from(s, "latin1")];
const withBom = (s) => [0xef, 0xbb, 0xbf, ...Buffer.from(s, "utf8")];
const OUT_CODE = (source) => ({ cell_type: "code", metadata: {}, source, execution_count: null, outputs: [] });
const OUT_MD = (source) => ({ cell_type: "markdown", metadata: {}, source });
// Cursor writes JSON.stringify(notebook, null, 2) with no trailing newline.
const expectJson = (cells) => JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 2);
const EDIT_CELLS = [OUT_CODE(["print(2)\n", "x = 2"]), OUT_MD("# Title")];
const EDIT_TEXT = "The notebook cell at index 0 in nb.ipynb has been updated.";
const EDIT_ARGS = edit({ old_string: "print(1)", new_string: "print(2)" });
const outDir = join(homedir(), `.cursor-pi-edit-notebook-check-${process.pid}`);
const outFile = join(outDir, "out.ipynb");

const E2E = [
	{ name: "e2e edit keeps LF and writes no trailing newline", files: { "nb.ipynb": utf8(NB_A) }, args: EDIT_ARGS, expect: { text: EDIT_TEXT, isError: false, prompts: 0, files: { "nb.ipynb": utf8(expectJson(EDIT_CELLS)) } } },
	{ name: "e2e edit keeps CRLF endings", files: { "nb.ipynb": utf8(NB_CRLF) }, args: EDIT_ARGS, expect: { text: EDIT_TEXT, isError: false, prompts: 0, files: { "nb.ipynb": utf8(expectJson(EDIT_CELLS).replace(/\n/g, "\r\n")) } } },
	{ name: "e2e edit keeps a UTF-8 BOM", files: { "nb.ipynb": withBom(NB_A) }, args: EDIT_ARGS, expect: { text: EDIT_TEXT, isError: false, prompts: 0, files: { "nb.ipynb": withBom(expectJson(EDIT_CELLS)) } } },
	{ name: "e2e edit keeps a latin1 file", files: { "nb.ipynb": latin1(NB_LATIN) }, args: EDIT_ARGS, expect: { text: EDIT_TEXT, isError: false, prompts: 0, files: { "nb.ipynb": latin1(expectJson([OUT_CODE(["print(2)\n", "x = 2"]), OUT_MD("caf\u00e9")])) } } },
	{ name: "e2e insert a markdown cell at index 1", files: { "nb.ipynb": utf8(NB_A) }, args: insert({ cell_language: "markdown", new_string: "## Added" }), expect: { text: "A new markdown cell was created at index 1 in notebook nb.ipynb.", isError: false, prompts: 0, files: { "nb.ipynb": utf8(expectJson([OUT_CODE(["print(1)\n", "x = 2"]), { cell_type: "markdown", metadata: {}, source: ["## Added"] }, OUT_MD("# Title")])) } } },
	{ name: "e2e edit of a missing notebook", files: {}, args: edit({ target_notebook: "missing.ipynb", old_string: "x", new_string: "y" }), expect: { text: "File not found: missing.ipynb", isError: true, prompts: 0, files: { "missing.ipynb": null } } },
	{ name: "e2e .cursorignore blocks the read", files: { "secret.ipynb": utf8(NB_A), ".cursorignore": utf8("secret.ipynb\n") }, args: edit({ target_notebook: "secret.ipynb", old_string: "print(1)", new_string: "print(2)" }), expect: { text: "Read permission denied: secret.ipynb", isError: true, prompts: 0, files: { "secret.ipynb": utf8(NB_A) } } },
	{ name: "e2e outside the workspace: approved", files: { [outFile]: utf8(NB_A) }, args: edit({ target_notebook: outFile, old_string: "print(1)", new_string: "print(2)" }), approve: async () => true, expect: { text: `The notebook cell at index 0 in ${outFile} has been updated.`, isError: false, prompts: 1, files: { [outFile]: utf8(expectJson(EDIT_CELLS)) } } },
	{ name: "e2e outside the workspace: rejected", files: { [outFile]: utf8(NB_A) }, args: edit({ target_notebook: outFile, old_string: "print(1)", new_string: "print(2)" }), approve: async () => false, expect: { text: "Rejected: ", isError: true, prompts: 1, files: { [outFile]: utf8(NB_A) } } },
	{ name: "e2e outside the workspace: no UI", files: { [outFile]: utf8(NB_A) }, args: edit({ target_notebook: outFile, old_string: "print(1)", new_string: "print(2)" }), hasUI: false, expect: { text: "Rejected: ", isError: true, prompts: 0, files: { [outFile]: utf8(NB_A) } } },
	{ name: "e2e a non-JSON notebook", files: { "nb.ipynb": utf8("{oops") }, args: EDIT_ARGS, expect: { text: "Error: The notebook file is not valid JSON", isError: true, prompts: 0, files: { "nb.ipynb": utf8("{oops") } } },
];

async function runE2E(c) {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	const root = await mkdtemp(join(tmpdir(), "edit-notebook-e2e-"));
	try {
		for (const [name, bytes] of Object.entries(c.files)) {
			const path = resolve(root, name);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, Buffer.from(bytes));
		}
		const prompts = [];
		const ctx = {
			cwd: root,
			hasUI: c.hasUI !== false,
			ui: {
				confirm: async (title, message) => {
					prompts.push(message);
					return c.approve ? c.approve(title, message) : false;
				},
			},
		};
		const result = await executeEditNotebook(c.args, undefined, ctx);
		const files = {};
		for (const name of Object.keys(c.expect.files)) {
			files[name] = await readFile(resolve(root, name)).then((bytes) => [...bytes], () => null);
		}
		return { text: result.text, isError: result.isError, prompts: prompts.length, files };
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outDir, { recursive: true, force: true });
	}
}

for (const c of E2E) {
	try {
		const got = await runE2E(c);
		const want = c.expect;
		const same = got.text === want.text && got.isError === want.isError && got.prompts === want.prompts && JSON.stringify(got.files) === JSON.stringify(want.files);
		report(c.name, same, same ? "" : `  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
	} catch (error) {
		report(c.name, false, `  ${error?.stack ?? error}`);
	}
}

// Two edits to one notebook started together: the file lock runs the second after the first, so both edits land. Without the lock
// the second write would find the file changed since its read.
{
	const root = await mkdtemp(join(tmpdir(), "edit-notebook-lock-"));
	try {
		const path = join(root, "nb.ipynb");
		await writeFile(path, NB_A);
		const ctx = { cwd: root, hasUI: false, ui: { confirm: async () => false } };
		const [first, second] = await Promise.all([
			executeEditNotebook(edit({ old_string: "print(1)", new_string: "print(2)" }), undefined, ctx),
			executeEditNotebook(edit({ old_string: "x = 2", new_string: "x = 3" }), undefined, ctx),
		]);
		const after = await readFile(path, "utf8");
		const want = expectJson([OUT_CODE(["print(2)\n", "x = 3"]), OUT_MD("# Title")]);
		const same = first.isError === false && second.isError === false && after === want;
		report("two parallel edits to one notebook are serialized", same, same ? "" : `  first  ${JSON.stringify(first)}\n  second ${JSON.stringify(second)}\n  file   ${JSON.stringify(after)}\n  want   ${JSON.stringify(want)}`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

console.log(`${checks - failures} of ${checks} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
