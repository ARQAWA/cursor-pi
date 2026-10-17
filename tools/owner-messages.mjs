// Lists owner (user) messages of omp session files, or checks decision quotes against them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = [
  "usage:",
  "  bun tools/owner-messages.mjs [--sessions-dir <dir>] list <session-id-or-prefix>...",
  "  bun tools/owner-messages.mjs [--sessions-dir <dir>] check <markdown-file>",
].join("\n");

const SESSION_HEADER_RE = /^Session `([0-9a-f-]{36})` \u00b7 (\S+)/;

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function defaultSessionsDir() {
  return process.env.OMP_SESSIONS_DIR || path.join(os.homedir(), ".omp", "agent", "sessions");
}

// Session files live at `<sessionsDir>/<project dir>/<timestamp>_<sessionId>.jsonl`.
function findSessionFiles(sessionsDir, id) {
  let projects;
  try {
    projects = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = path.join(sessionsDir, project.name);
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".jsonl") && name.includes(`_${id}`)) matches.push(path.join(dir, name));
    }
  }
  return matches;
}

function resolveSessionFile(sessionsDir, id) {
  const files = findSessionFiles(sessionsDir, id);
  if (files.length !== 1) {
    const reason = files.length === 0 ? "no session file matches" : `${files.length} session files match`;
    throw new Error(`session "${id}": ${reason} in ${sessionsDir}`);
  }
  return files[0];
}

function sessionIdOf(file) {
  return path.basename(file, ".jsonl").split("_").pop();
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function loadOwnerMessages(file) {
  const messages = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const text = messageText(entry.message.content);
    if (text.trim() === "") continue;
    messages.push({ timestamp: entry.timestamp ?? "", text });
  }
  return messages;
}

function listMode(sessionsDir, ids) {
  if (ids.length === 0) usage("list needs at least one session id or prefix");
  for (const id of ids) {
    if (!/^[0-9a-f-]+$/i.test(id)) usage(`not a session id or prefix: ${id}`);
  }
  const sessions = [];
  let failed = false;
  for (const id of ids) {
    try {
      const file = resolveSessionFile(sessionsDir, id);
      sessions.push({ id: sessionIdOf(file), messages: loadOwnerMessages(file) });
    } catch (error) {
      failed = true;
      process.stderr.write(`${error.message}\n`);
    }
  }
  if (failed) return 1;
  let out = "";
  let count = 0;
  for (const session of sessions) {
    session.messages.forEach((message, index) => {
      out += `## ${session.id} \u00b7 ${message.timestamp} \u00b7 #${index + 1}\n\n${message.text}\n\n`;
    });
    count += session.messages.length;
  }
  process.stdout.write(out);
  process.stderr.write(`listed ${count} owner messages from ${sessions.length} sessions\n`);
  return 0;
}

// A quote is a run of `>` lines, attributed by the first non-empty line after it.
function parseQuotes(lines) {
  const quotes = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith(">")) {
      i++;
      continue;
    }
    const start = i;
    const body = [];
    while (i < lines.length && lines[i].startsWith(">")) {
      body.push(lines[i].startsWith("> ") ? lines[i].slice(2) : lines[i].slice(1));
      i++;
    }
    let next = i;
    while (next < lines.length && lines[next].trim() === "") next++;
    const header = next < lines.length ? SESSION_HEADER_RE.exec(lines[next]) : null;
    quotes.push({
      line: start + 1,
      text: body.join("\n"),
      session: header ? header[1] : null,
      timestamp: header ? header[2] : null,
    });
  }
  return quotes;
}

function containsInOrder(haystack, fragments) {
  let from = 0;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}

function quoteFound(sessionsDir, sessionCache, quote) {
  if (!sessionCache.has(quote.session)) {
    try {
      sessionCache.set(quote.session, loadOwnerMessages(resolveSessionFile(sessionsDir, quote.session)));
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      sessionCache.set(quote.session, []);
    }
  }
  const fragments = quote.text
    .split("\u2026")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment !== "")
    .map(normalize);
  return sessionCache
    .get(quote.session)
    .some((message) => message.timestamp === quote.timestamp && containsInOrder(normalize(message.text), fragments));
}

function checkMode(sessionsDir, operands) {
  if (operands.length !== 1) usage("check needs exactly one markdown file");
  const [file] = operands;
  const quotes = parseQuotes(fs.readFileSync(file, "utf8").split("\n"));
  const sessionCache = new Map();
  const counts = { OK: 0, MISSING: 0, UNATTRIBUTED: 0 };
  const report = [];
  for (const quote of quotes) {
    let status = "UNATTRIBUTED";
    if (quote.session !== null) status = quoteFound(sessionsDir, sessionCache, quote) ? "OK" : "MISSING";
    counts[status]++;
    report.push(`${status} ${file}:${quote.line} ${quote.session ?? "-"} ${quote.timestamp ?? "-"}`);
  }
  report.push(
    `quotes: ${quotes.length}, found: ${counts.OK}, missing: ${counts.MISSING}, unattributed: ${counts.UNATTRIBUTED}`,
  );
  process.stdout.write(`${report.join("\n")}\n`);
  return counts.MISSING + counts.UNATTRIBUTED > 0 ? 1 : 0;
}

function main(argv) {
  let sessionsDir = defaultSessionsDir();
  const operands = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sessions-dir") {
      if (i + 1 >= argv.length) usage("--sessions-dir needs a directory");
      sessionsDir = argv[++i];
    } else if (arg.startsWith("-")) {
      usage(`unknown option: ${arg}`);
    } else {
      operands.push(arg);
    }
  }
  const [mode, ...rest] = operands;
  if (mode === "list") return listMode(sessionsDir, rest);
  if (mode === "check") return checkMode(sessionsDir, rest);
  return usage(mode === undefined ? "missing mode: list or check" : `unknown mode: ${mode}`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
