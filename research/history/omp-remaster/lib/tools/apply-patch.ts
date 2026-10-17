// Reproduces Cursor's ApplyPatch tool: applies one "*** Begin Patch" block that adds or updates a single file given by an absolute path.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD_PREFIX = "*** Add File: ";
const UPDATE_PREFIX = "*** Update File: ";
const END_OF_FILE = "*** End of File";

interface Hunk {
  headers: string[];
  lines: string[];
  endOfFile: boolean;
}

type LineMatcher = (fileLine: string, patchLine: string) => boolean;

const MATCHERS: LineMatcher[] = [
  (fileLine, patchLine) => fileLine === patchLine,
  (fileLine, patchLine) => fileLine.trimEnd() === patchLine.trimEnd(),
  (fileLine, patchLine) => fileLine.trim() === patchLine.trim(),
];

export async function applyPatchTool(input: string): Promise<string> {
  try {
    return await applyPatch(input);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function applyPatch(input: string): Promise<string> {
  const lines = input.split("\n");
  if (lines[0].trim() !== BEGIN) {
    throw new Error("invalid patch: first line must be *** Begin Patch");
  }
  let endIndex = lines.length - 1;
  while (endIndex >= 0 && lines[endIndex].trim() === "") endIndex--;
  if (endIndex < 1 || lines[endIndex].trim() !== END) {
    throw new Error("invalid patch: last non-empty line must be *** End Patch");
  }

  const header = lines[1];
  const body = lines.slice(2, endIndex);
  if (header.startsWith(ADD_PREFIX)) {
    const filePath = header.slice(ADD_PREFIX.length).trim();
    assertAbsolute(filePath);
    return addFile(filePath, body);
  }
  if (header.startsWith(UPDATE_PREFIX)) {
    const filePath = header.slice(UPDATE_PREFIX.length).trim();
    assertAbsolute(filePath);
    return updateFile(filePath, body);
  }
  throw new Error("invalid patch: expected *** Add File: or *** Update File: after *** Begin Patch");
}

function assertAbsolute(filePath: string): void {
  if (!path.isAbsolute(filePath)) throw new Error(`path must be absolute: ${filePath}`);
}

async function addFile(filePath: string, body: string[]): Promise<string> {
  for (const line of body) {
    if (!line.startsWith("+")) throw new Error(`invalid patch: add file line must start with +: ${line}`);
  }
  if (await exists(filePath)) throw new Error(`file already exists: ${filePath}`);
  const content = body.map((line) => line.slice(1)).join("\n") + "\n";
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return `Success. Updated the following files:\nA ${filePath}`;
}

async function updateFile(filePath: string, body: string[]): Promise<string> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) throw new Error(`File not found: ${filePath}`);
    throw error;
  }

  const hadFinalNewline = content.endsWith("\n");
  const fileLines = content.split("\n");
  if (hadFinalNewline) fileLines.pop();

  const hunks = parseHunks(body);
  if (hunks.length === 0) throw new Error("invalid patch: update has no hunks");

  let cursor = 0;
  for (const hunk of hunks) {
    for (const contextHeader of hunk.headers) {
      const found = findHeader(fileLines, cursor, contextHeader);
      if (found < 0) throw new Error(`context not found: ${contextHeader}`);
      cursor = found + 1;
    }

    const oldLines = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("-")).map((line) => line.slice(1));
    const newLines = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("+")).map((line) => line.slice(1));
    const index = hunk.endOfFile
      ? findAtEnd(fileLines, cursor, oldLines)
      : findSequence(fileLines, cursor, oldLines);
    if (index < 0) throw new Error(`context not found:\n${oldLines.join("\n")}`);

    fileLines.splice(index, oldLines.length, ...newLines);
    cursor = index + newLines.length;
  }

  await writeFile(filePath, fileLines.join("\n") + (hadFinalNewline ? "\n" : ""), "utf8");
  return `The file ${filePath} has been updated.`;
}

function parseHunks(body: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let afterEndOfFile = false;
  for (const line of body) {
    if (afterEndOfFile) {
      throw new Error(`invalid patch: unexpected line after *** End of File: ${line}`);
    }
    if (line === END_OF_FILE) {
      if (!current) throw new Error("invalid patch: *** End of File without a hunk");
      current.endOfFile = true;
      afterEndOfFile = true;
    } else if (line === "@@" || line.startsWith("@@ ")) {
      if (!current || current.lines.length > 0) {
        current = { headers: [], lines: [], endOfFile: false };
        hunks.push(current);
      }
      const header = line.slice(3);
      if (header.trim() !== "") current.headers.push(header);
    } else if (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+")) {
      if (!current) throw new Error(`invalid patch: hunk line before @@: ${line}`);
      current.lines.push(line);
    } else {
      throw new Error(`invalid patch: unexpected line: ${line}`);
    }
  }
  return hunks;
}

function findHeader(fileLines: string[], from: number, header: string): number {
  for (let i = from; i < fileLines.length; i++) {
    if (fileLines[i] === header) return i;
  }
  for (let i = from; i < fileLines.length; i++) {
    if (fileLines[i].trim() === header.trim()) return i;
  }
  return -1;
}

function findSequence(fileLines: string[], from: number, old: string[]): number {
  if (old.length === 0) return from;
  for (const matches of MATCHERS) {
    for (let i = from; i + old.length <= fileLines.length; i++) {
      if (matchesAt(fileLines, i, old, matches)) return i;
    }
  }
  return -1;
}

function findAtEnd(fileLines: string[], from: number, old: string[]): number {
  if (old.length === 0) return fileLines.length;
  const start = fileLines.length - old.length;
  if (start < from) return -1;
  return MATCHERS.some((matches) => matchesAt(fileLines, start, old, matches)) ? start : -1;
}

function matchesAt(fileLines: string[], start: number, old: string[], matches: LineMatcher): boolean {
  return old.every((line, j) => matches(fileLines[start + j], line));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
