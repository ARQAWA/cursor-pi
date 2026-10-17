// Reproduces Cursor's Read tool: returns a line window of a text file, numbers every tenth line and notes the lines left out.
import { readFile, stat } from "node:fs/promises";

const UNSUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"];

export async function readFileTool(params: { path: string; offset?: number; limit?: number }): Promise<string> {
  try {
    const info = await stat(params.path);
    if (info.isDirectory()) return `Error: ${params.path} is a directory`;
    const lowerPath = params.path.toLowerCase();
    if (UNSUPPORTED_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) {
      return "Error: Image and PDF files are not supported";
    }
    const content = await readFile(params.path, "utf8");
    if (content === "") return "File is empty.";
    return formatWindow(content, params.offset, params.limit);
  } catch (error) {
    if (isNotFound(error)) return "Error: File not found";
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function formatWindow(content: string, offset: number | undefined, limit: number | undefined): string {
  const lines = content.split("\n");
  const total = lines.length;
  let start: number;
  if (offset === undefined || offset === 0) start = 0;
  else if (offset > 0) start = offset - 1;
  else start = Math.max(0, total + offset);
  if (start >= total) start = total;
  const end = limit === undefined ? total : Math.min(total, start + Math.max(0, limit));
  const body = lines
    .slice(start, end)
    .map((line, index) => {
      const lineNumber = start + index + 1;
      return lineNumber % 10 === 0 ? `${String(lineNumber).padStart(6)}|${line}` : line;
    })
    .join("\n");
  const before = start;
  const after = total - end;
  return (
    (before > 0 ? `... ${before} lines not shown ...\n` : "") +
    body +
    (after > 0 ? `\n... ${after} lines not shown ...` : "")
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
