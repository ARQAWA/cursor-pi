// Reproduces Cursor's Glob tool: lists files matching a glob with ripgrep, newest first, showing at most 100 of them.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const MAX_BUFFER = 256 * 1024 * 1024;
const MAX_LISTED = 100;

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  error?: Error;
}

interface FoundFile {
  name: string;
  mtimeMs: number;
}

export async function globTool(
  params: { glob_pattern: string; target_directory?: string },
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = params.target_directory ?? cwd;
  const label = params.target_directory ?? ".";
  const pattern = params.glob_pattern.startsWith("**/") ? params.glob_pattern : `**/${params.glob_pattern}`;

  const result = await runRgFiles(pattern, root, signal);
  if (result.error && result.code !== 1) {
    return `Error: ${result.stderr.trim() || result.error.message}`;
  }

  const names = result.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.replace(/^\.\//, ""));
  const statted = await Promise.all(
    names.map(async (name): Promise<FoundFile | null> => {
      try {
        const info = await stat(path.resolve(root, name));
        return { name, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const files = statted
    .filter((file): file is FoundFile => file !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const total = files.length;
  let text = `Result of search in '${label}' (total ${total} files):\n`;
  for (const file of files.slice(0, MAX_LISTED)) {
    text += `- ${file.name}\n`;
  }
  if (total > MAX_LISTED) {
    text += `... ${total - MAX_LISTED} more files ... (Do a more specific search if needed)\n`;
  }
  return text;
}

function runRgFiles(pattern: string, root: string, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "rg",
      ["--files", "--glob", pattern],
      { cwd: root, maxBuffer: MAX_BUFFER, signal, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        resolve({ stdout, stderr, code: typeof error.code === "number" ? error.code : null, error });
      },
    );
  });
}
