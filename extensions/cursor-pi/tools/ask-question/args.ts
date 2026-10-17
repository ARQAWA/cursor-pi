// Cursor's zod parse of AskQuestion arguments. Pi does not check arguments, so this reproduces what Cursor reports for the
// same arguments: the same issues, in zod's order, with zod's messages.

import { lenientArray } from "../cursor-args.ts";

export interface AskQuestionOption {
	id: string;
	label: string;
}

export interface AskQuestionItem {
	id: string;
	prompt: string;
	options: AskQuestionOption[];
	allow_multiple?: boolean;
}

export interface AskQuestionArgs {
	title?: string;
	questions: AskQuestionItem[];
}

type Path = (string | number)[];

// zod's name for a JSON value's type, as in "Expected string, received number".
function receivedType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function fail(path: Path, message: string, issues: string[]): false {
	issues.push(`${path.length > 0 ? path.join(".") : "argument"}: ${message}`);
	return false;
}

// Records zod's issue when the value does not have the expected type; returns whether it does.
function expectType(value: unknown, expected: "string" | "boolean" | "object" | "array", path: Path, issues: string[]): boolean {
	let ok: boolean;
	if (expected === "array") ok = Array.isArray(value);
	else if (expected === "object") ok = typeof value === "object" && value !== null && !Array.isArray(value);
	else ok = typeof value === expected;
	if (ok) return true;
	return fail(path, value === undefined ? "Required" : `Expected ${expected}, received ${receivedType(value)}`, issues);
}

function checkQuestion(question: unknown, path: Path, issues: string[]): void {
	if (!expectType(question, "object", path, issues)) return;
	const fields = question as Record<string, unknown>;
	expectType(fields.id, "string", [...path, "id"], issues);
	expectType(fields.prompt, "string", [...path, "prompt"], issues);
	const optionsPath = [...path, "options"];
	if (expectType(fields.options, "array", optionsPath, issues)) {
		const options = fields.options as unknown[];
		if (options.length < 2) fail(optionsPath, "Array must contain at least 2 element(s)", issues);
		options.forEach((option, index) => {
			const optionPath = [...optionsPath, index];
			if (!expectType(option, "object", optionPath, issues)) return;
			const optionFields = option as Record<string, unknown>;
			expectType(optionFields.id, "string", [...optionPath, "id"], issues);
			expectType(optionFields.label, "string", [...optionPath, "label"], issues);
		});
	}
	if (fields.allow_multiple !== undefined) expectType(fields.allow_multiple, "boolean", [...path, "allow_multiple"], issues);
}

// The arguments after Cursor's AskQuestion schema. questions is read the way Cursor's lenientArray reads it, so a JSON array
// string is accepted as the array it holds.
export function parseAskQuestionArgs(input: unknown): { args: AskQuestionArgs } | { error: string } {
	const issues: string[] = [];
	let title: string | undefined;
	let questions: AskQuestionItem[] = [];
	if (expectType(input, "object", [], issues)) {
		const fields = input as Record<string, unknown>;
		if (fields.title !== undefined && expectType(fields.title, "string", ["title"], issues)) title = fields.title as string;
		const list = lenientArray(fields.questions, "questions");
		if (expectType(list, "array", ["questions"], issues)) {
			const items = list as unknown[];
			if (items.length < 1) fail(["questions"], "Array must contain at least 1 element(s)", issues);
			items.forEach((question, index) => checkQuestion(question, ["questions", index], issues));
			questions = items as AskQuestionItem[];
		}
	}
	if (issues.length > 0) return { error: `Invalid arguments:\n${issues.join("\n")}` };
	return { args: { title, questions } };
}
