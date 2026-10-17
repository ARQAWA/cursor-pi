import { type ArgIssue, checkType, invalidArguments, optionalBoolean, optionalLenientNumber, optionalNumber, optionalString } from "../cursor-args.ts";

export interface ShellArgs {
	command: string;
	working_directory?: string;
	block_until_ms?: number;
	description?: string;
	notify_on_output?: { pattern: string; reason: string; debounce_ms?: number };
	request_smart_mode_approval?: boolean;
	smart_mode_block_reason?: string;
}

// Cursor's Shell schema for this tool, in its key order: command is required and the other fields are optional. block_until_ms
// is lenient. The last three fields are notify_on_output and the smart-mode approval fields, which the captured schema lists.
export function parseShellArgs(params: unknown): { args: ShellArgs } | { error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const command = checkType(input.command, "string", ["command"], issues) ? (input.command as string) : "";
	const workingDirectory = optionalString(input.working_directory, ["working_directory"], issues);
	const blockUntilMs = optionalLenientNumber(input.block_until_ms, ["block_until_ms"], issues);
	const description = optionalString(input.description, ["description"], issues);
	const notify = parseNotifyOnOutput(input.notify_on_output, issues);
	const smartApproval = optionalBoolean(input.request_smart_mode_approval, ["request_smart_mode_approval"], issues);
	const smartReason = optionalString(input.smart_mode_block_reason, ["smart_mode_block_reason"], issues);
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return {
		args: {
			command,
			working_directory: workingDirectory,
			block_until_ms: blockUntilMs,
			description,
			notify_on_output: notify,
			request_smart_mode_approval: smartApproval,
			smart_mode_block_reason: smartReason,
		},
	};
}

// notify_on_output: an optional object whose pattern and reason are required strings and whose debounce_ms is an optional number.
function parseNotifyOnOutput(value: unknown, issues: ArgIssue[]): ShellArgs["notify_on_output"] {
	if (value === undefined) return undefined;
	if (!checkType(value, "object", ["notify_on_output"], issues)) return undefined;
	const input = value as Record<string, unknown>;
	const pattern = checkType(input.pattern, "string", ["notify_on_output", "pattern"], issues) ? (input.pattern as string) : "";
	const reason = checkType(input.reason, "string", ["notify_on_output", "reason"], issues) ? (input.reason as string) : "";
	const debounceMs = optionalNumber(input.debounce_ms, ["notify_on_output", "debounce_ms"], issues);
	return { pattern, reason, debounce_ms: debounceMs };
}
