// Cursor's text helpers for the web tools: the inline character cap, the file write threshold, the written-file note and the
// truncation notice.
export const CHAR_HARD_LIMIT = 100_000;
export const FILE_WRITE_THRESHOLD_BYTES = 20_000;

// The file a large result was written to; the same shape writeAgentToolsFile returns.
export interface OutputLocation {
	filePath: string;
	sizeBytes: number;
	lineCount: number;
}

// Cursor's size wording: KB with one decimal from 1024 bytes up, otherwise bytes.
function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
}

// Cursor's describeOutputLocation: the lead text, the file path, then the size and the line count.
export function describeOutputLocation(location: OutputLocation, leadText: string): string {
	return `${leadText} written to file: ${location.filePath}\nSize: ${formatSize(location.sizeBytes)}, ${location.lineCount} lines`;
}

// Cursor's truncateContent: the content cut at maxSize, with a note on how many lines were left out.
export function truncateContent(content: string, maxSize: number): string {
	if (content.length <= maxSize) return content;
	const truncatedPart = content.substring(maxSize);
	const linesTruncated = (truncatedPart.match(/\n/g) || []).length + 1;
	return `${content.substring(0, maxSize)}\n\n...[${linesTruncated} line${linesTruncated === 1 ? "" : "s"} truncated]`;
}
