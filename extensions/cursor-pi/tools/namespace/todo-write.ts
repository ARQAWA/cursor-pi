import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { lenientArray } from "../cursor-args.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";

// Cursor's TodoWrite (agent/dist/tools/core/todo/todo.js, prompt version "latest"), for the cursor namespace.
const NAMESPACE = "cursor";
const TODO_WRITE = capturedNamespaceDeclaration("TodoWrite");
const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
type TodoStatus = (typeof TODO_STATUSES)[number];

// The list a conversation keeps. Times are epoch milliseconds, as Cursor's TodoItem keeps them.
export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
	createdAt: number;
	updatedAt: number;
}

interface RawTodo {
	id: string;
	content: string | undefined;
	status: TodoStatus;
}

export interface NamespaceToolResult {
	text: string;
	isError: boolean;
}

// Session entry holding the todo list after each write, so a resumed session reads the list it ended with.
const TODOS_ENTRY = "cursor-pi-todos";
// Cursor's MAX_FINISHED_TODOS and its cleanup reminder threshold.
const MAX_FINISHED_TODOS = 50;
const FINISHED_TODO_CLEANUP_REMINDER_THRESHOLD = 20;
const FINISHED_TODO_CLEANUP_REMINDER = "You have many finished todos. Consider cleaning up old ones.";
const SUCCESS_HEAD = "Successfully updated TODOs. Make sure to follow and update your TODO list as you make progress. Cancel and add new TODO tasks as needed when the user makes a correction or follow-up request.";
const NO_IN_PROGRESS = " No TODOs are marked in-progress, make sure to mark them before starting the next.";
const MISSING_CONTENT = "Invalid argument: must provide 'content' for new todos items";

// zod's boolean reading for `merge` (the spellings Cursor's preprocessLenientBoolean takes).
const MERGE_SPELLINGS: Record<string, boolean> = { true: true, yes: true, "1": true, false: false, no: false, "0": false };

// The appendEntry of the Pi extension that registered this tool; set by register().
let appendSessionEntry: ((customType: string, data: unknown) => void) | undefined;

export function register(pi: ExtensionAPI): void {
	appendSessionEntry = (customType, data) => pi.appendEntry(customType, data);
	registerDynamicTool({ namespace: NAMESPACE, declaration: TODO_WRITE, conciseInstructions: capturedConciseInstruction(TODO_WRITE.name), execute: executeTodoWrite });
}

export async function executeTodoWrite(params: unknown, _signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const parsed = parseTodoWriteArgs(params);
	if (!parsed.ok) return { text: parsed.error, isError: false };
	const outcome = applyTodoWrite(storedTodos(ctx), parsed.merge, parsed.todos, Date.now());
	if (outcome.error !== undefined) return { text: outcome.error, isError: false };
	if (appendSessionEntry === undefined) throw new Error("TodoWrite is not registered with Pi");
	appendSessionEntry(TODOS_ENTRY, { todos: outcome.state });
	return { text: renderSuccess(outcome.shown), isError: false };
}

// The list the session's last TodoWrite left, or an empty list before any write.
function storedTodos(ctx: ExtensionToolContext): TodoItem[] {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === TODOS_ENTRY) {
			const todos = (entry.data as { todos?: unknown } | undefined)?.todos;
			return Array.isArray(todos) ? (todos as TodoItem[]) : [];
		}
	}
	return [];
}

// One zod issue as Cursor's error text carries it: JSON with the keys in zod's order.
interface ZodIssue {
	code: string;
	expected?: string;
	received?: string;
	options?: readonly (string | boolean)[];
	path: (string | number)[];
	message: string;
}

type ParsedArgs = { ok: true; merge: boolean; todos: RawTodo[] } | { ok: false; error: string };

// Cursor's TodoWrite parses twice. The streaming parser checks each todo with an id and a status as the arguments arrive,
// and its error is the bare issue list. The full parse prefixes "Invalid arguments: " to its issue list.
function parseTodoWriteArgs(params: unknown): ParsedArgs {
	const top = typeIssue(params, "object", []);
	if (top !== undefined) return { ok: false, error: invalidArguments([top]) };
	const fields = params as Record<string, unknown>;
	const streamed = streamedTodoIssues(fields.todos);
	if (streamed.length > 0) return { ok: false, error: JSON.stringify(streamed, null, 2) };
	const issues: ZodIssue[] = [];
	const merge = mergeFlag(fields, issues);
	const todos = todosArg(fields.todos, merge !== false, issues);
	if (issues.length > 0 || merge === undefined || todos === undefined) return { ok: false, error: invalidArguments(issues) };
	return { ok: true, merge, todos };
}

function invalidArguments(issues: ZodIssue[]): string {
	return `Invalid arguments: ${JSON.stringify(issues, null, 2)}`;
}

// The first todo that has an id and a status, when its id or content has the wrong type.
function streamedTodoIssues(todos: unknown): ZodIssue[] {
	if (!Array.isArray(todos)) return [];
	for (const item of todos) {
		if (typeof item !== "object" || item === null || !("id" in item) || !("status" in item)) continue;
		const fields = item as Record<string, unknown>;
		const issues = [typeIssue(fields.id, "string", ["id"]), fields.content === undefined ? undefined : typeIssue(fields.content, "string", ["content"]), enumIssue(fields.status, ["status"])];
		const found = issues.filter((issue): issue is ZodIssue => issue !== undefined);
		if (found.length > 0) return found;
	}
	return [];
}

// merge is true when absent (Cursor's preprocessTodoMerge); otherwise a lenient boolean.
function mergeFlag(fields: Record<string, unknown>, issues: ZodIssue[]): boolean | undefined {
	if (!Object.hasOwn(fields, "merge")) return true;
	const value = fields.merge;
	const read = mergeSpelling(value);
	if (read !== undefined) return read;
	issues.push({ code: "invalid_union_discriminator", options: [true, false], path: ["merge"], message: "Invalid discriminator value. Expected true | false" });
	return undefined;
}

// The boolean a merge spelling names; numbers and booleans read by their text, anything else is undefined.
function mergeSpelling(value: unknown): boolean | undefined {
	if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
	const key = String(value).trim().toLowerCase();
	return Object.hasOwn(MERGE_SPELLINGS, key) ? MERGE_SPELLINGS[key] : undefined;
}

// Each todo needs id and status; content is optional when merging and required when replacing.
function todosArg(value: unknown, optionalContent: boolean, issues: ZodIssue[]): RawTodo[] | undefined {
	const list = lenientArray(value, "todos");
	const listIssue = typeIssue(list, "array", ["todos"]);
	if (listIssue !== undefined) {
		issues.push(listIssue);
		return undefined;
	}
	const todos: RawTodo[] = [];
	(list as unknown[]).forEach((item, index) => {
		const path: (string | number)[] = ["todos", index];
		const itemIssue = typeIssue(item, "object", path);
		if (itemIssue !== undefined) {
			issues.push(itemIssue);
			return;
		}
		const fields = item as Record<string, unknown>;
		const id = typeIssue(fields.id, "string", [...path, "id"]);
		const content = optionalContent && fields.content === undefined ? undefined : typeIssue(fields.content, "string", [...path, "content"]);
		const status = enumIssue(fields.status, [...path, "status"]);
		const found = [id, optionalContent && fields.content === undefined ? undefined : content, status].filter((issue) => issue !== undefined);
		if (found.length > 0) {
			issues.push(...(found as ZodIssue[]));
			return;
		}
		todos.push({ id: fields.id as string, content: optionalContent ? (fields.content as string | undefined) : (fields.content as string), status: fields.status as TodoStatus });
	});
	return todos;
}

// zod's issue for a value of the wrong type ("Required" when absent).
function typeIssue(value: unknown, expected: "object" | "array" | "string", path: (string | number)[]): ZodIssue | undefined {
	if (value === undefined) return { code: "invalid_type", expected, received: "undefined", path, message: "Required" };
	if (matchesType(value, expected)) return undefined;
	const received = receivedName(value);
	return { code: "invalid_type", expected, received, path, message: `Expected ${expected}, received ${received}` };
}

// zod's issues for the status enum, in the key order Cursor's output shows: a missing or non-string status names the options as
// the expected type; an unknown string names them with zod's enum code.
function enumIssue(value: unknown, path: (string | number)[]): ZodIssue | undefined {
	if (typeof value === "string" && (TODO_STATUSES as readonly string[]).includes(value)) return undefined;
	const expected = TODO_STATUSES.map((status) => `'${status}'`).join(" | ");
	if (typeof value === "string") return { received: value, code: "invalid_enum_value", options: TODO_STATUSES, path, message: `Invalid enum value. Expected ${expected}, received '${value}'` };
	if (value === undefined) return { expected, received: "undefined", code: "invalid_type", path, message: "Required" };
	return { expected, received: receivedName(value), code: "invalid_type", path, message: `Expected ${expected}, received ${receivedName(value)}` };
}

function matchesType(value: unknown, expected: "object" | "array" | "string"): boolean {
	switch (expected) {
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array":
			return Array.isArray(value);
		case "string":
			return typeof value === "string";
	}
}

// zod's name for a JSON value's type.
function receivedName(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

// Cursor's executeCore: a merge updates or adds the named todos, a replace swaps the whole list. Nothing changes on error.
function applyTodoWrite(existing: TodoItem[], merge: boolean, todos: RawTodo[], now: number): { error?: string; state: TodoItem[]; shown: TodoItem[] } {
	const existingById = new Map(existing.map((todo) => [todo.id, todo] as const));
	const resolved = todos.map((raw) => {
		const before = existingById.get(raw.id);
		return { id: raw.id, content: raw.content || before?.content || "", status: raw.status, createdAt: before?.createdAt || now, updatedAt: now };
	});
	if (!merge) {
		const replaced = pruneFinishedTodos(resolved.map((todo) => ({ ...todo, createdAt: existingById.get(todo.id)?.createdAt || todo.createdAt })));
		return { state: replaced, shown: replaced };
	}
	const byId = new Map(existingById);
	for (const todo of resolved) {
		const before = byId.get(todo.id);
		if ((before === undefined || before.content === "") && todo.content === "") return { error: MISSING_CONTENT, state: existing, shown: existing };
		byId.set(todo.id, { id: todo.id, content: todo.content, status: todo.status, createdAt: before?.createdAt || todo.createdAt, updatedAt: todo.updatedAt });
	}
	const merged = pruneFinishedTodos([...byId.values()]);
	return { state: merged, shown: merged };
}

function isFinished(todo: TodoItem): boolean {
	return todo.status === "completed" || todo.status === "cancelled";
}

// Cursor's pruneFinishedTodos: beyond MAX_FINISHED_TODOS, the least recently updated finished todos are dropped.
function pruneFinishedTodos(todos: TodoItem[]): TodoItem[] {
	const finished = todos.map((todo, index) => ({ todo, index })).filter(({ todo }) => isFinished(todo));
	if (finished.length <= MAX_FINISHED_TODOS) return todos;
	const byRecency = [...finished].sort((a, b) => {
		const aUpdated = a.todo.updatedAt || a.todo.createdAt || 0;
		const bUpdated = b.todo.updatedAt || b.todo.createdAt || 0;
		if (aUpdated !== bUpdated) return aUpdated > bUpdated ? -1 : 1;
		return b.index - a.index;
	});
	const pruned = new Set(byRecency.slice(MAX_FINISHED_TODOS).map(({ index }) => index));
	return todos.filter((_todo, index) => !pruned.has(index));
}

// Cursor's renderUpdateTodosSuccessResult for the "latest" prompt. Its reminder is folded in as Cursor's renderer does:
// a system_reminder block after a blank line.
export function renderSuccess(shown: TodoItem[]): string {
	let message = SUCCESS_HEAD;
	if (shown.some((todo) => todo.status === "pending") && shown.every((todo) => todo.status !== "in_progress")) message += NO_IN_PROGRESS;
	message += `\n\nHere are the latest contents of your todo list:\n${shown.map((todo) => `- **${todo.status.toUpperCase()}**: ${todo.content} (id: ${todo.id})`).join("\n")}`;
	if (shown.filter(isFinished).length > FINISHED_TODO_CLEANUP_REMINDER_THRESHOLD) message += `\n\n<system_reminder>\n${FINISHED_TODO_CLEANUP_REMINDER}\n</system_reminder>`;
	return message;
}
