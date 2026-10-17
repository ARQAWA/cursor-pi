// Checks that GitHub links into earendil-works/pi docs point at the pinned commit and resolve to real lines and symbols.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const USAGE = "usage: bun tools/check-pi-refs.mjs [--pi <dir>] [files...]";
const LINK_RE =
  /\[([^\]]*)\]\((https:\/\/github\.com\/earendil-works\/pi\/blob\/([^\/)]+)\/([^)#\s]+)(?:#L(\d+)(?:-L(\d+))?)?)\)/g;
const CODE_SPAN_RE = /`([^`]+)`/g;

class UsageError extends Error {}

function git(args) {
  try {
    return execFileSync("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 30,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function readPin() {
  const pin = JSON.parse(fs.readFileSync(path.join(ROOT, "pi-pin.json"), "utf8"));
  for (const key of ["repo", "tag", "commit"]) {
    if (typeof pin[key] !== "string" || pin[key] === "") {
      throw new Error(`pi-pin.json: "${key}" must be a non-empty string`);
    }
  }
  return pin;
}

function defaultDocs() {
  const docsDir = path.join(ROOT, "docs");
  if (!fs.existsSync(docsDir)) return [];
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(docsDir, entry.name))
    .sort();
}

function cloneSource(pin, tmp) {
  const dir = path.join(tmp, "pi");
  git(["clone", "--depth", "1", "--branch", pin.tag, pin.repo, dir]);
  const head = git(["-C", dir, "rev-parse", "HEAD"]).toString("utf8").trim();
  if (head !== pin.commit) {
    throw new Error(`clone of ${pin.tag} is at ${head}, expected ${pin.commit}`);
  }
  return dir;
}

// Returns the file's lines at the pinned commit, or null when the path is not a blob there.
function readPinned(clone, commit, filePath) {
  const spec = `${commit}:${filePath}`;
  let type;
  try {
    type = git(["-C", clone, "cat-file", "-t", spec]).toString("utf8").trim();
  } catch {
    return null;
  }
  if (type !== "blob") return null;
  const lines = git(["-C", clone, "show", spec]).toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function createPinnedReader(clone, commit) {
  const cache = new Map();
  return (filePath) => {
    if (!cache.has(filePath)) cache.set(filePath, readPinned(clone, commit, filePath));
    return cache.get(filePath);
  };
}

// Each ref gets one status: the first failing check in this order wins.
function classify({ ref, filePath, startLine, endLine, spans }, pin, linesAt) {
  if (ref !== pin.commit) return "UNPINNED";
  const lines = linesAt(filePath);
  if (lines === null) return "NO_FILE";
  if (startLine === undefined) return filePath.includes("/") ? "NO_LINE" : "OK";
  const last = endLine ?? startLine;
  if (startLine < 1 || last < startLine || last > lines.length) return "NO_LINE";
  for (const span of spans) {
    if (!lines.slice(startLine - 1, last).some((line) => line.includes(span))) return "NO_SYMBOL";
  }
  return "OK";
}

function checkFiles(files, clone, pin) {
  const linesAt = createPinnedReader(clone, pin.commit);
  const counts = { refs: 0, ok: 0, failed: 0 };
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    for (const match of text.matchAll(LINK_RE)) {
      const [, linkText, , ref, filePath, startDigits, endDigits] = match;
      const status = classify(
        {
          ref,
          filePath,
          startLine: startDigits === undefined ? undefined : Number(startDigits),
          endLine: endDigits === undefined ? undefined : Number(endDigits),
          spans: [...linkText.matchAll(CODE_SPAN_RE)].map((span) => span[1]),
        },
        pin,
        linesAt,
      );
      const line = text.slice(0, match.index).split("\n").length;
      const lineRef =
        startDigits === undefined ? "" : endDigits === undefined ? `#L${startDigits}` : `#L${startDigits}-L${endDigits}`;
      console.log(`${status} ${rel}:${line} ${filePath}${lineRef}`);
      counts.refs++;
      if (status === "OK") counts.ok++;
      else counts.failed++;
    }
  }
  console.log(`refs: ${counts.refs}, ok: ${counts.ok}, failed: ${counts.failed}`);
  return counts.failed > 0 || counts.refs === 0 ? 1 : 0;
}

function main() {
  let piDir = null;
  const inputs = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pi") {
      if (i + 1 >= argv.length) throw new UsageError("--pi needs a directory");
      piDir = path.resolve(argv[++i]);
    } else if (argv[i].startsWith("-")) {
      throw new UsageError(`unknown option: ${argv[i]}`);
    } else {
      inputs.push(path.resolve(argv[i]));
    }
  }

  const pin = readPin();
  const files = inputs.length > 0 ? inputs : defaultDocs();
  let tmp = null;
  let clone = piDir;
  try {
    if (piDir !== null) {
      try {
        git(["-C", piDir, "cat-file", "-e", `${pin.commit}^{commit}`]);
      } catch {
        throw new Error(`--pi ${piDir} does not contain commit ${pin.commit}`);
      }
    } else {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-pi-refs-"));
      clone = cloneSource(pin, tmp);
    }
    return checkFiles(files, clone, pin);
  } finally {
    if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
}
