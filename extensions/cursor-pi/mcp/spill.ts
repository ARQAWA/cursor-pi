// Cursor's large-output handling for MCP results (mcp-error-classification.js, agent-tools-file.js). Text over the inline limit
// goes to <project>/agent-tools/<uuid>.txt, and the result says where. When the write fails, the text is cut and a notice says so.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callResult } from "./format.ts";
import type { McpCallResult, McpContentBlock } from "./types.ts";

export const MCP_TEXT_FILE_THRESHOLD_BYTES = 40_000;
// Cursor's MAX_OUTPUT_FILE_SIZE: the 50 MB append limit less 1 MB of headroom.
const MAX_OUTPUT_FILE_BYTES = 50 * 1024 * 1024 - 1024 * 1024;

interface OutputLocation {
	filePath: string;
	sizeBytes: number;
	lineCount: number;
}

function truncateUtf8(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.byteLength <= maxBytes) return text;
	const decoded = buffer.subarray(0, maxBytes).toString("utf8");
	return decoded.endsWith("\uFFFD") ? decoded.slice(0, -1) : decoded;
}

// Cursor's writeToAgentToolsFile: the text, cut to the file limit, goes to <projectDir>/agent-tools/<uuid>.txt.
export async function writeAgentToolsFile(projectDir: string, content: string): Promise<OutputLocation | undefined> {
	const text = truncateUtf8(content, MAX_OUTPUT_FILE_BYTES);
	const filePath = join(projectDir, "agent-tools", `${randomUUID()}.txt`);
	try {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, text, "utf8");
	} catch {
		return undefined;
	}
	return { filePath, sizeBytes: Buffer.byteLength(text, "utf8"), lineCount: text.split("\n").length };
}

// Cursor's size wording: KB with one decimal from 1024 bytes up, otherwise bytes.
function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
}

function largeOutputText(location: OutputLocation): string {
	return `Large output has been written to: ${location.filePath} (${formatSize(location.sizeBytes)}, ${location.lineCount} lines)`;
}

// Cursor's buildTruncatedTextWithNotice: the text is cut so that the notice still fits under the inline limit.
export function truncatedWithNotice(text: string): string {
	const notice = `\n\n[Output truncated: the full MCP tool output was ${Buffer.byteLength(text, "utf8")} bytes, which exceeds the inline limit of ${MCP_TEXT_FILE_THRESHOLD_BYTES} bytes, and could not be written to a file. The remainder was discarded; do not retry the same call expecting the full output.]`;
	return truncateUtf8(text, MCP_TEXT_FILE_THRESHOLD_BYTES - Buffer.byteLength(notice, "utf8")) + notice;
}

// The first text block takes the file reference (or the truncated text); the other blocks keep their order.
function replaceFirstText(content: McpContentBlock[], replacement: string): McpContentBlock[] {
	const out: McpContentBlock[] = [];
	let placed = false;
	for (const block of content) {
		if (block.type !== "text") {
			out.push(block);
			continue;
		}
		if (!placed) {
			out.push({ type: "text", text: replacement });
			placed = true;
		}
	}
	return out;
}

// Cursor's spillLargeMcpTextOutput for a tool result: text over the limit is written out, or truncated when that fails.
export async function spillToolResult(result: McpCallResult, projectDir: string): Promise<McpCallResult> {
	const aggregate = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
	if (Buffer.byteLength(aggregate, "utf8") <= MCP_TEXT_FILE_THRESHOLD_BYTES) return result;
	const location = await writeAgentToolsFile(projectDir, aggregate);
	const replacement = location ? largeOutputText(location) : truncatedWithNotice(aggregate);
	return callResult(replaceFirstText(result.content, replacement), result.isError, result.structuredContent);
}

// Cursor's spillLargeMcpResourceText: resource text over the limit goes to a file, or is truncated when the write fails.
// The returned text is what FetchMcpResource shows under the resource header.
export async function spillResourceText(text: string, projectDir: string): Promise<string> {
	if (Buffer.byteLength(text, "utf8") <= MCP_TEXT_FILE_THRESHOLD_BYTES) return text;
	const location = await writeAgentToolsFile(projectDir, text);
	return location ? largeOutputText(location) : truncatedWithNotice(text);
}
