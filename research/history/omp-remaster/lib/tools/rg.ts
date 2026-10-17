// Reproduces Cursor's Grep tool: runs ripgrep and renders the matches as content, a file list or per-file counts inside a workspace_result block.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

export interface RgParams {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-A"?: number;
  "-B"?: number;
  "-C"?: number;
  "-i"?: boolean;
  multiline?: boolean;
  head_limit?: number;
  offset?: number;
}

const MAX_BUFFER = 256 * 1024 * 1024;

interface RgLine {
  line: number;
  text: string;
  isMatch: boolean;
}

interface RgFile {
  file: string;
  lines: RgLine[];
}

interface RgEvent {
  type: string;
  data?: {
    path: { text: string };
    lines?: { text: string };
    line_number?: number | null;
  };
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  error?: Error;
}

export async function rgTool(params: RgParams, cwd: string, signal?: AbortSignal): Promise<string> {
  try {
    const mode = params.output_mode ?? "content";
    const args = ["--json"];
    if (params["-i"]) args.push("-i");
    if (params.multiline) args.push("-U", "--multiline-dotall");
    if (params.glob) args.push("--glob", params.glob);
    if (params.type) args.push("--type", params.type);
    if (mode === "content") {
      if (params["-A"] !== undefined) args.push("-A", String(params["-A"]));
      if (params["-B"] !== undefined) args.push("-B", String(params["-B"]));
      if (params["-C"] !== undefined) args.push("-C", String(params["-C"]));
    }
    const ignoreFile = path.join(cwd, ".cursorignore");
    if (await exists(ignoreFile)) args.push("--ignore-file", ignoreFile);
    args.push("--regexp", params.pattern, "--", params.path ?? cwd);

    const result = await runRg(args, cwd, signal);
    if (result.error && result.code !== 1 && (result.code !== 2 || result.stdout.trim() === "")) {
      return `Error: ${result.stderr.trim() || result.error.message}`;
    }

    const files = parseRgJson(result.stdout, cwd);
    const offset = Math.max(0, params.offset ?? 0);
    const end = params.head_limit === undefined ? undefined : offset + params.head_limit;

    let body: string;
    if (mode === "content") {
      body = renderContent(files, params, offset, end);
    } else {
      const rows = files
        .filter((file) => countMatches(file) > 0)
        .map((file) => (mode === "count" ? `${file.file}:${countMatches(file)}` : file.file));
      const shown = rows.slice(offset, end);
      body = shown.join("\n");
      if (end !== undefined && end < rows.length) {
        body += `\n[Showing ${shown.length} of at least ${rows.length} matching files. Use offset=${end} to see more, or narrow the search.]`;
      }
    }
    if (body === "") body = "No matches found";
    return `<workspace_result workspace_path="${cwd}">\n${body}\n</workspace_result>`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderContent(files: RgFile[], params: RgParams, offset: number, end: number | undefined): string {
  const before = params["-B"] ?? params["-C"] ?? 0;
  const after = params["-A"] ?? params["-C"] ?? 0;
  const totalMatches = files.reduce((sum, file) => sum + countMatches(file), 0);
  let matchIndex = 0;
  let shownMatches = 0;
  const blocks: string[] = [];
  for (const file of files) {
    const shownMatchLines: RgLine[] = [];
    for (const line of file.lines) {
      if (!line.isMatch) continue;
      if (matchIndex >= offset && (end === undefined || matchIndex < end)) shownMatchLines.push(line);
      matchIndex++;
    }
    shownMatches += shownMatchLines.length;

    const chosen = new Set<RgLine>(shownMatchLines);
    for (const line of file.lines) {
      if (line.isMatch) continue;
      if (shownMatchLines.some((match) => match.line - before <= line.line && line.line <= match.line + after)) {
        chosen.add(line);
      }
    }
    if (chosen.size === 0) continue;

    const rendered = [...chosen]
      .sort((a, b) => a.line - b.line)
      .map((line) => (line.isMatch ? `  ${line.line}:${line.text}` : `  ${line.line}-${line.text}`));
    blocks.push([file.file, ...rendered].join("\n"));
  }

  let body = blocks.join("\n\n");
  if (end !== undefined && end < totalMatches) {
    body += `\n[Showing ${shownMatches} of at least ${totalMatches} matching lines. Use offset=${end} to see more, or narrow the search.]`;
  }
  return body;
}

function parseRgJson(stdout: string, cwd: string): RgFile[] {
  const files: RgFile[] = [];
  const byPath = new Map<string, RgFile>();
  for (const rawLine of stdout.split("\n")) {
    if (rawLine.trim() === "") continue;
    const event = JSON.parse(rawLine) as RgEvent;
    if (!event.data || (event.type !== "begin" && event.type !== "match" && event.type !== "context")) continue;

    const key = event.data.path.text;
    let file = byPath.get(key);
    if (!file) {
      file = { file: path.relative(cwd, path.resolve(cwd, key)), lines: [] };
      byPath.set(key, file);
      files.push(file);
    }
    if (event.type === "begin") continue;

    const isMatch = event.type === "match";
    const firstLine = event.data.line_number ?? 0;
    const texts = (event.data.lines?.text ?? "").replace(/\r?\n$/, "").split("\n");
    for (let i = 0; i < texts.length; i++) {
      file.lines.push({ line: firstLine + i, text: texts[i], isMatch });
    }
  }
  return files;
}

function countMatches(file: RgFile): number {
  return file.lines.filter((line) => line.isMatch).length;
}

function runRg(args: string[], cwd: string, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile("rg", args, { cwd, maxBuffer: MAX_BUFFER, signal, encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr, code: 0 });
        return;
      }
      resolve({ stdout, stderr, code: typeof error.code === "number" ? error.code : null, error });
    });
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
