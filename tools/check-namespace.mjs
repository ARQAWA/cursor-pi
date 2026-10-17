#!/usr/bin/env bun
// Checks the cursor-namespace tools against Cursor Desktop 3.25.6's own code. For each case, Cursor's tool render runs on
// the same state (built with Cursor's TodoStatus values), and the text must equal what our executeTodoWrite returns.
// Argument errors are checked on our side only, since Cursor's zod messages are not reproduced here.
// Needs the extracted bundle (bun tools/extract-cursor.mjs). Exits non-zero on any FAIL.
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { capturedNamespaceDeclaration } from "../extensions/cursor-pi/tools/namespace/captured.ts";
import { executeTodoWrite, renderSuccess } from "../extensions/cursor-pi/tools/namespace/todo-write.ts";
import { registerCursorNamespace } from "../extensions/cursor-pi/tools/namespace/index.ts";
import { getDynamicTool, getDynamicNamespaceUseInstructions } from "../extensions/cursor-pi/dynamic/registry.ts";
import { capturedCursorUseInstructions, capturedConciseInstruction } from "../extensions/cursor-pi/dynamic/captured-instructions.ts";
import { deleteFile, executeDelete, renderDeleteOutcome } from "../extensions/cursor-pi/tools/namespace/delete.ts";

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/core/todo/todo.js");
if (!cursor.TodoStatus) throw new Error("TodoStatus is not in the Cursor bundle");
if (typeof cursor.createUpdateTodosTool !== "function") throw new Error("createUpdateTodosTool is not in the Cursor bundle");
const STATUS = {
	pending: cursor.TodoStatus.PENDING,
	in_progress: cursor.TodoStatus.IN_PROGRESS,
	completed: cursor.TodoStatus.COMPLETED,
	cancelled: cursor.TodoStatus.CANCELLED,
};

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

// Cursor's text for a list of todos: its render of a success result with these todos.
async function cursorRender(todos) {
	const tool = cursor.createUpdateTodosTool({}, { todos: [], setTodos() {}, getPrivacyMode: () => 0 }, "latest");
	const execResult = {
		result: {
			case: "success",
			value: { todos: todos.map((todo) => ({ id: todo.id, content: todo.content, status: STATUS[todo.status] })), wasMerge: true, totalCount: todos.length },
		},
	};
	const rendered = await tool.render(cursor.createContext(), execResult, {});
	return { text: rendered.content[0].text, reminders: rendered.systemReminders ?? [] };
}

// A Pi session stand-in: the entries a session would hold, and the appendEntry that writes them.
const session = { entries: [] };
const ctx = { sessionManager: { getBranch: () => session.entries } };
registerCursorNamespace({ appendEntry: (customType, data) => session.entries.push({ type: "custom", customType, data }) });

async function sameAsCursor(name, args, expectedTodos) {
	const ours = await executeTodoWrite(args, undefined, ctx);
	const expected = await cursorRender(expectedTodos);
	report(`${name}: text`, ours.text === expected.text && ours.isError === false, `  ours:   ${JSON.stringify(ours.text)}\n  cursor: ${JSON.stringify(expected.text)}`);
	return ours;
}

// Captured declaration: the tool is the one Cursor listed, with its schema.
const declared = capturedNamespaceDeclaration("TodoWrite");
report("declaration: TodoWrite schema lists merge and todos", JSON.stringify(declared.parameters.required) === JSON.stringify(["merge", "todos"]) && declared.name === "TodoWrite");

// Sequence on one session, so the state carries from call to call.
await sameAsCursor("replace with a pending and a completed todo", { merge: false, todos: [{ id: "t1", content: "Plan", status: "pending" }, { id: "t2", content: "Build", status: "completed" }] }, [
	{ id: "t1", content: "Plan", status: "pending" },
	{ id: "t2", content: "Build", status: "completed" },
]);
await sameAsCursor("merge sets t1 in progress and keeps its content", { merge: true, todos: [{ id: "t1", status: "in_progress" }, { id: "t3", content: "Test", status: "pending" }] }, [
	{ id: "t1", content: "Plan", status: "in_progress" },
	{ id: "t2", content: "Build", status: "completed" },
	{ id: "t3", content: "Test", status: "pending" },
]);
await sameAsCursor("merge with no in-progress todo adds the reminder line", { merge: true, todos: [{ id: "t1", status: "pending" }, { id: "t2", status: "pending" }] }, [
	{ id: "t1", content: "Plan", status: "pending" },
	{ id: "t2", content: "Build", status: "pending" },
	{ id: "t3", content: "Test", status: "pending" },
]);

// A new todo without content is refused and leaves the list as it was.
const before = JSON.stringify(session.entries);
const refused = await executeTodoWrite({ merge: true, todos: [{ id: "t9", status: "pending" }, { id: "t1", status: "completed" }] }, undefined, ctx);
report("missing content for a new todo: refused text", refused.text === "Invalid argument: must provide 'content' for new todos items", `  text: ${JSON.stringify(refused.text)}`);
report("missing content: state unchanged", JSON.stringify(session.entries) === before);


// Cleanup reminder: more than 20 finished todos adds Cursor's reminder, with the same text as Cursor's systemReminders.
const finished = Array.from({ length: 21 }, (_v, i) => ({ id: `f${i}`, content: `Done ${i}`, status: "completed" }));
const many = await executeTodoWrite({ merge: false, todos: [...finished, { id: "p", content: "Open", status: "pending" }] }, undefined, ctx);
const cursorMany = await cursorRender([...finished, { id: "p", content: "Open", status: "pending" }]);
const reminderText = cursorMany.reminders[0];
report("cleanup reminder: Cursor adds the reminder body", reminderText === "You have many finished todos. Consider cleaning up old ones.", `  reminders: ${JSON.stringify(cursorMany.reminders)}`);
report("cleanup reminder: our text carries the reminder", many.text.endsWith(`\n\n<system_reminder>\n${reminderText}\n</system_reminder>`), `  tail: ${JSON.stringify(many.text.slice(-160))}`);
report("cleanup reminder: text before it equals Cursor's", many.text.startsWith(cursorMany.text), `  ours:   ${JSON.stringify(many.text.slice(0, 200))}\n  cursor: ${JSON.stringify(cursorMany.text.slice(0, 200))}`);

// renderSuccess is the same function executeTodoWrite uses; its output for a no-in-progress list matches Cursor's.
report("renderSuccess matches executeTodoWrite text", renderSuccess([{ id: "a", content: "x", status: "pending", createdAt: 1, updatedAt: 1 }, { id: "b", content: "y", status: "pending", createdAt: 1, updatedAt: 1 }]).includes("No TODOs are marked in-progress"));

// Cursor's own execute, run on a JSON argument string: its success text, or the text its error result renders to.
const streamOf = (text) => (async function* () { yield text; })();
async function cursorExecute(args) {
	const tool = cursor.createUpdateTodosTool({}, { todos: [], plans: new Map(), setTodos() {}, getPrivacyMode: () => 0 }, "latest");
	const interactionHandler = {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
	};
	const callCtx = cursor.createContext();
	try {
		const result = await tool.execute(callCtx, interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "todo-probe" });
		return (await tool.render(callCtx, result, {})).content[0].text;
	} catch (error) {
		return (await tool.render(callCtx, tool.serializeError(error).tool.value.result, {})).content[0].text;
	}
}

// One todo: Cursor's execute decides whether the advertised minimum of two is enforced.
const solo = { merge: false, todos: [{ id: "solo", content: "Only", status: "pending" }] };
const soloCursor = await cursorExecute(solo);
const soloOurs = await executeTodoWrite(solo, undefined, ctx);
report("one todo: text equals Cursor's execute", soloOurs.text === soloCursor, `  ours:   ${JSON.stringify(soloOurs.text)}\n  cursor: ${JSON.stringify(soloCursor)}`);

// Malformed arguments: the text Cursor's execute renders.
const arrayArgs = [];
const arrayCursor = await cursorExecute(arrayArgs);
const arrayOurs = await executeTodoWrite(arrayArgs, undefined, ctx);
report("array arguments: text equals Cursor's execute", arrayOurs.text === arrayCursor, `  ours:   ${JSON.stringify(arrayOurs.text)}\n  cursor: ${JSON.stringify(arrayCursor)}`);

const badId = { merge: false, todos: [{ id: 5, content: "x", status: "pending" }, { id: "b", content: "y", status: "pending" }] };
const badIdCursor = await cursorExecute(badId);
const badIdOurs = await executeTodoWrite(badId, undefined, ctx);
report("numeric id: text equals Cursor's execute", badIdOurs.text === badIdCursor, `  ours:   ${JSON.stringify(badIdOurs.text)}\n  cursor: ${JSON.stringify(badIdCursor)}`);

// The reminder block Cursor folds into a tool result, as its renderer makes it.
report("reminder block: Cursor's renderSystemReminderBlock is available", typeof cursor.renderSystemReminderBlock === "function");
if (typeof cursor.renderSystemReminderBlock === "function") {
	const block = cursor.renderSystemReminderBlock("You have many finished todos. Consider cleaning up old ones.");
	report("reminder block: wire form equals ours", block === `<system_reminder>\nYou have many finished todos. Consider cleaning up old ones.\n</system_reminder>`, `  block: ${JSON.stringify(block)}`);
}

// The namespace entry point, run once above, put TodoWrite and Cursor's header into the cursor registry.
const registered = getDynamicTool("cursor", "TodoWrite");
report("registry: TodoWrite is registered in the cursor namespace", registered !== undefined);
report("registry: cursor header is Cursor's use instructions", getDynamicNamespaceUseInstructions("cursor") === capturedCursorUseInstructions());
report("registry: TodoWrite concise line is Cursor's", registered?.conciseInstructions === capturedConciseInstruction("TodoWrite"));

// Delete: Cursor's own Delete tool, its executor stubbed to return one result, against our rendered text for the same outcome.
async function cursorDeleteText(args, result) {
	const tool = cursor.createDeleteTool({ get: () => ({ execute: async () => ({ result }) }) }, { waitForLock: async () => undefined }, { recordFileState() {} }, "latest");
	const interactionHandler = {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
	};
	const callCtx = cursor.createContext();
	try {
		const out = await tool.execute(callCtx, interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "delete-probe" });
		return (await tool.render(callCtx, out, {})).content[0].text;
	} catch (error) {
		return (await tool.render(callCtx, tool.serializeError(error).tool.value.result, {})).content[0].text;
	}
}
const deletePath = "/w/a.txt";
const deleteCases = [
	["success", { path: deletePath }, { case: "success", value: { path: deletePath, fileSize: 60n, prevContent: "" } }, { case: "success", path: deletePath, fileSize: 60 }],
	["file not found", { path: deletePath }, { case: "fileNotFound", value: { path: deletePath } }, { case: "fileNotFound", path: deletePath }],
	["not a file", { path: "/w/d" }, { case: "notFile", value: { path: "/w/d", actualType: "directory" } }, { case: "notFile", path: "/w/d", actualType: "directory" }],
	["permission denied", { path: deletePath }, { case: "permissionDenied", value: { path: deletePath, isReadonly: false } }, { case: "permissionDenied", path: deletePath }],
	["file busy", { path: deletePath }, { case: "fileBusy", value: { path: deletePath } }, { case: "fileBusy", path: deletePath }],
	["rejected", { path: deletePath }, { case: "rejected", value: { path: deletePath, reason: "" } }, { case: "rejected" }],
	["error", { path: deletePath }, { case: "error", value: { path: deletePath, error: "EIO: i/o error" } }, { case: "error", path: deletePath, error: "EIO: i/o error" }],
	["blank path", { path: "   " }, { case: "error", value: { path: "   ", error: "path is empty or only whitespace" } }, { case: "error", path: "   ", error: "path is empty or only whitespace" }],
];
for (const [name, args, cursorResult, ours] of deleteCases) {
	const theirs = await cursorDeleteText(args, cursorResult);
	const mine = renderDeleteOutcome(ours);
	report(`Delete ${name}: text equals Cursor's`, mine === theirs, `  ours:   ${JSON.stringify(mine)}\n  cursor: ${JSON.stringify(theirs)}`);
}

// Malformed Delete arguments: Cursor's withSafeParsedArgs error text, read from the thrown error.
async function cursorDeleteArgError(args) {
	const tool = cursor.createDeleteTool({ get: () => ({ execute: async () => ({ result: { case: "success", value: { path: "/x", fileSize: 0n, prevContent: "" } } }) }) }, { waitForLock: async () => undefined }, { recordFileState() {} }, "latest");
	const interactionHandler = {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
	};
	try {
		await tool.execute(cursor.createContext(), interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "delete-args" });
		return "no error";
	} catch (error) {
		return error.modelVisibleErrorMessage ?? error.message;
	}
}
for (const args of [{}, { path: 5 }, []]) {
	const theirs = await cursorDeleteArgError(args);
	const mine = (await executeDelete(args, undefined, { cwd: "/w", hasUI: false })).text;
	report(`Delete arguments ${JSON.stringify(args)}: text equals Cursor's`, mine === theirs, `  ours:   ${JSON.stringify(mine)}\n  cursor: ${JSON.stringify(theirs)}`);
}

// Delete against real files: the approval, the stat, the unlink and the rejection without a UI.
const fs = await import("node:fs");
const os = await import("node:os");
const pathMod = await import("node:path");
const workspace = fs.mkdtempSync(pathMod.join(os.tmpdir(), "delete-check-"));
const deleteCtx = (hasUI) => ({ cwd: workspace, hasUI, ui: { confirm: async () => true } });
const removed = pathMod.join(workspace, "removed.txt");
fs.writeFileSync(removed, "0123456789");
const removedResult = await executeDelete({ path: removed }, undefined, deleteCtx(true));
report("Delete real file: success text and file removed", removedResult.text === `Successfully deleted file: ${removed} (10 bytes)` && !fs.existsSync(removed), `  text: ${JSON.stringify(removedResult.text)}`);
const missingResult = await executeDelete({ path: removed }, undefined, deleteCtx(true));
report("Delete real file: missing file text", missingResult.text === `Error deleting file : File not found: ${removed}`, `  text: ${JSON.stringify(missingResult.text)}`);
const keep = pathMod.join(workspace, "keep.txt");
fs.writeFileSync(keep, "keep");
const keptResult = await executeDelete({ path: keep }, undefined, deleteCtx(false));
report("Delete real file: no UI rejects and keeps the file", keptResult.text === "File deletion rejected: File deletion rejected" && fs.existsSync(keep), `  text: ${JSON.stringify(keptResult.text)}`);
const dir = pathMod.join(workspace, "dir");
fs.mkdirSync(dir);
const dirResult = await executeDelete({ path: dir }, undefined, deleteCtx(true));
report("Delete real directory: not-a-file text", dirResult.text === `Error deleting file : Path is not a file (directory): ${dir}`, `  text: ${JSON.stringify(dirResult.text)}`);
const direct = await deleteFile(keep, workspace, async () => false);
report("Delete executor: a refused approval returns rejected", direct.case === "rejected");

// TodoWrite argument errors that Cursor's execute reports; state is not changed by errors, so these run after the cases above.
const todoArgCases = [
	{ merge: "maybe", todos: [{ id: "a", status: "pending", content: "x" }] },
	{ merge: false, todos: "not json" },
	{ merge: false },
	{ merge: false, todos: [{ id: "a", content: "x" }] },
	{ merge: false, todos: [{ id: "a", status: "bogus", content: "x" }] },
	{ merge: false, todos: [{ id: "a", status: "pending", content: 5 }] },
	{ merge: false, todos: [{ id: "a", status: 5, content: "x" }] },
	{ merge: false, todos: [{ id: "a", status: null, content: "x" }] },
	{ merge: false, todos: [{ id: "a", status: ["pending"], content: "x" }] },
	{ merge: true, todos: [{ id: "a", status: "pending", content: 5 }] },
];
for (const args of todoArgCases) {
	const theirs = await cursorExecute(args);
	const mine = (await executeTodoWrite(args, undefined, ctx)).text;
	report(`TodoWrite ${JSON.stringify(args)}: text equals Cursor's execute`, mine === theirs, `  ours:   ${JSON.stringify(mine)}\n  cursor: ${JSON.stringify(theirs)}`);
}

console.log(`${checks - failures} of ${checks} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
