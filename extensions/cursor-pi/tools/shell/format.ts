// Shell result text, ported from Cursor's agent-side shell formatters (agent/dist/tools/core/shell/retry-helpers.js).
// Only the cases this tool produces are here.

export const SHELL_CHAR_HARD_LIMIT = 20000;
const TRUNCATION_EDGE = 10000;
const TRUNCATION_MARK = "\n\n... (output truncated) ...\n\n";

export interface OutputLocation {
	filePath: string;
	sizeBytes: number;
	lineCount: number;
}

export interface ShellRunValue {
	command: string;
	workingDirectory?: string;
	exitCode?: number;
	signal?: string;
	interleavedOutput?: string;
	executionTime?: number;
	localExecutionTimeMs?: number;
	outputLocation?: OutputLocation;
	shellId?: number;
	pid?: number;
	msToWait?: number;
	backgroundReason?: "TIMEOUT" | "USER_REQUEST";
	aborted?: boolean;
	abortReason?: "USER_ABORT";
}

export type ShellResultCase =
	| { case: "success"; value: ShellRunValue }
	| { case: "failure"; value: ShellRunValue }
	| { case: "spawnError"; value: { command: string; error: string } };

export interface ShellRenderInput {
	result: ShellResultCase;
	isBackground: boolean;
	terminalsFolder: string;
}

export function truncateOutput(text: string): { output: string; truncated: boolean } {
	if (text.length <= SHELL_CHAR_HARD_LIMIT) return { output: text, truncated: false };
	return { output: `${text.slice(0, TRUNCATION_EDGE)}${TRUNCATION_MARK}${text.slice(-TRUNCATION_EDGE)}`, truncated: true };
}

export function renderShellResult(input: ShellRenderInput): string {
	const { result, isBackground, terminalsFolder } = input;
	if (result.case === "spawnError") return renderSpawnError(result.value);
	const value = result.value;
	if (isBackground) return renderBackgroundStarted(value, terminalsFolder);
	if (value.shellId !== undefined && value.shellId !== 0) return renderBackgrounded(value, terminalsFolder);
	const formatted = renderForeground(value);
	const aborted = value.abortReason === "USER_ABORT" || (value.aborted === true && value.abortReason === undefined);
	return aborted ? `Command was aborted by the user.\n${formatted}` : formatted;
}

function outputPath(terminalsFolder: string, shellId: number | undefined): string {
	return terminalsFolder ? `${terminalsFolder}/${shellId}.txt` : `<terminals_folder>/${shellId}.txt`;
}

function renderBackgroundStarted(value: ShellRunValue, terminalsFolder: string): string {
	let message = `Background command started successfully.\nShell ID: ${value.shellId}\n`;
	if (value.pid) message += `PID: ${value.pid}\n`;
	return `${message}Command: ${value.command}\nOutput will be written to ${outputPath(terminalsFolder, value.shellId)}. Don't mention Shell ID to the user.`;
}

function renderBackgrounded(value: ShellRunValue, terminalsFolder: string): string {
	let text = `The command did not complete in ${value.msToWait}ms and was sent to the background.\n`;
	text += `Shell ID: ${value.shellId}\n`;
	if (value.pid) text += `PID: ${value.pid}\n`;
	text += `The output is being written to ${outputPath(terminalsFolder, value.shellId)}. Don't mention Shell ID to the user.\n\n`;
	text += partialOutputSection(value.interleavedOutput ?? "", "Output collected before backgrounding", " (truncated)", "No output was collected before backgrounding.");
	return text;
}

function partialOutputSection(partial: string, heading: string, truncatedSuffix: string, emptyMessage = ""): string {
	if (partial.length === 0) return emptyMessage;
	const { output, truncated } = truncateOutput(partial);
	return `${heading}${truncated ? truncatedSuffix : ""}:\n\n\`\`\`\n${output}\n\`\`\``;
}

function renderForeground(value: ShellRunValue): string {
	const executionTimeMs = value.localExecutionTimeMs ?? value.executionTime;
	const aborted = value.signal === "SIGTERM";
	const completion = completionMessage(aborted, executionTimeMs);
	const state = stateMessage(value.signal, value.workingDirectory);
	if (value.outputLocation) {
		return `Exit code: ${value.exitCode}\n\nCommand output has been written to: ${locationSummary(value.outputLocation)}\n\n${completion}\n\n${state}`;
	}
	const combined = truncateOutput(value.interleavedOutput ?? "");
	const heading = `Command output${combined.truncated ? ` (truncated to ${SHELL_CHAR_HARD_LIMIT} characters)` : ""}:`;
	return `Exit code: ${value.exitCode}\n\n${heading}\n\n\`\`\`\n${combined.output}\n\`\`\`\n\n${completion}\n\n${state}`;
}

function renderSpawnError(value: { command: string; error: string }): string {
	const head = `Error: Command failed to spawn: ${value.error}`;
	return value.command.length > 0 ? `${head}\n\nCommand: ${value.command}` : head;
}

function completionMessage(aborted: boolean, executionTimeMs: number | undefined): string {
	if (aborted) return executionTimeMs !== undefined ? `Command aborted after ${executionTimeMs} ms.` : "Command aborted.";
	return executionTimeMs !== undefined ? `Command completed in ${executionTimeMs} ms.` : "Command completed.";
}

function stateMessage(signal: string | undefined, workingDirectory: string | undefined): string {
	if (signal === "SIGTERM") {
		return "The previous shell command aborted, so on the next invocation of this tool, a new shell will be started at the project root.";
	}
	let message = "Shell state (cwd, env vars) persists for subsequent calls.";
	if (workingDirectory?.trim()) message += ` Current directory: ${workingDirectory}`;
	return message;
}

function locationSummary(location: OutputLocation): string {
	const size = location.sizeBytes >= 1024 ? `${(location.sizeBytes / 1024).toFixed(1)} KB` : `${location.sizeBytes} bytes`;
	return `${location.filePath} (${size}, ${location.lineCount} lines)`;
}
