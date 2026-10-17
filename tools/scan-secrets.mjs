// Scans the working tree and the git history inside provenance bundles for credential-shaped strings.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const BUNDLE_DIR = path.join(ROOT, "provenance", "bundles");
const ALLOWLIST_PATH = path.join(ROOT, "tools", "secret-allowlist.json");
const EMPTY_ALLOWLIST = '{ "entries": [] }\n';
const SKIP_DIR_NAMES = new Set([".git", "node_modules"]);
const BINARY_PROBE_BYTES = 8192;
const CONTEXT_CHARS = 40;

const RULES = [
  { name: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { name: "github-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { name: "openai-key", regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai-project-key", regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}\b/g },
  { name: "anthropic-key", regex: /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{40,}/g },
  { name: "aws-access-key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "slack-token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "bearer", regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{24,}=*/g },
  { name: "assigned-secret", regex: /["']?(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password)["']?\s*[:=]\s*["'][A-Za-z0-9_\-\/+=.]{24,}["']/gi },
];

const stats = { files: 0, binary: 0, blobs: 0, findings: 0, allowed: 0 };

function allowKey(rule, sha256) {
  return `${rule}:${sha256.toLowerCase()}`;
}

async function loadAllowlist() {
  let text;
  try {
    text = await readFile(ALLOWLIST_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(ALLOWLIST_PATH, EMPTY_ALLOWLIST);
    text = EMPTY_ALLOWLIST;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${ALLOWLIST_PATH} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed?.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain an "entries" array`);
  }
  const keys = new Set();
  for (const entry of parsed.entries) {
    if (typeof entry?.rule !== "string" || typeof entry?.sha256 !== "string") {
      throw new Error(`${ALLOWLIST_PATH} entries need string "rule" and "sha256" fields`);
    }
    keys.add(allowKey(entry.rule, entry.sha256));
  }
  return keys;
}

function oneLine(text) {
  return text.replace(/\r\n|[\r\n]/g, " ");
}

function newlineOffsets(text) {
  const offsets = [];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) offsets.push(i);
  return offsets;
}

// 1-based line of the character at index, given the offsets of all newlines in the text.
function lineNumber(offsets, index) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] < index) low = mid + 1;
    else high = mid;
  }
  return low + 1;
}

function isBinary(bytes) {
  return bytes.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

function scanText(text, location, allowed) {
  let newlines = null;
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.regex)) {
      newlines ??= newlineOffsets(text);
      const value = match[0];
      const sha256 = createHash("sha256").update(value).digest("hex");
      const line = lineNumber(newlines, match.index);
      const isAllowed = allowed.has(allowKey(rule.name, sha256));
      if (isAllowed) stats.allowed++;
      else stats.findings++;
      const context = text.slice(Math.max(0, match.index - CONTEXT_CHARS), match.index);
      console.log(
        `${isAllowed ? "ALLOWED" : "FINDING"} ${rule.name} ${location}:${line} sha256=${sha256} ` +
          `match=${oneLine(value.slice(0, 8))}…(${value.length} chars) context=${oneLine(context)}`,
      );
    }
  }
}

async function listWorkingFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listWorkingFiles(full)));
    else if (entry.isFile() && !entry.name.endsWith(".bundle")) files.push(full);
  }
  return files;
}

async function listBundles() {
  let entries;
  try {
    entries = await readdir(BUNDLE_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bundle"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(BUNDLE_DIR, name));
}

async function git(args, input) {
  const proc = Bun.spawn(["git", ...args], {
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited with ${code}: ${stderr.trim()}`);
  return Buffer.from(stdout);
}

async function scanBundle(bundlePath, workDir, index, allowed) {
  const label = path.relative(ROOT, bundlePath);
  const gitDir = path.join(workDir, `bundle-${index}.git`);
  await git(["init", "--bare", "--quiet", gitDir]);
  await git(["--git-dir", gitDir, "fetch", bundlePath, "refs/heads/*:refs/heads/*"]);

  const objectPaths = new Map();
  const objectShas = [];
  const revList = (await git(["--git-dir", gitDir, "rev-list", "--objects", "--all"])).toString("utf8");
  for (const line of revList.split("\n")) {
    if (line === "") continue;
    const space = line.indexOf(" ");
    const sha = space === -1 ? line : line.slice(0, space);
    objectShas.push(sha);
    if (space !== -1) objectPaths.set(sha, line.slice(space + 1));
  }
  if (objectShas.length === 0) return;

  const typed = (
    await git(
      ["--git-dir", gitDir, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
      `${objectShas.join("\n")}\n`,
    )
  ).toString("utf8");
  const blobShas = [];
  for (const line of typed.split("\n")) {
    const [sha, type] = line.split(" ");
    if (type === "blob") blobShas.push(sha);
  }
  if (blobShas.length === 0) return;

  const batch = await git(["--git-dir", gitDir, "cat-file", "--batch"], `${blobShas.join("\n")}\n`);
  let pos = 0;
  while (pos < batch.length) {
    const eol = batch.indexOf(10, pos);
    if (eol === -1) throw new Error(`${label}: unexpected end of cat-file output`);
    const header = batch.toString("utf8", pos, eol).split(" ");
    if (header.length !== 3 || header[1] !== "blob") {
      throw new Error(`${label}: cat-file could not read object "${header.join(" ")}"`);
    }
    const sha = header[0];
    const start = eol + 1;
    const end = start + Number(header[2]);
    pos = end + 1;
    stats.blobs++;
    const content = batch.subarray(start, end);
    if (isBinary(content)) {
      stats.binary++;
      continue;
    }
    scanText(content.toString("utf8"), `${label}:${sha}:${objectPaths.get(sha) ?? ""}`, allowed);
  }
}

async function main() {
  if (process.argv.length > 2) {
    console.error("usage: bun tools/scan-secrets.mjs");
    return 2;
  }
  const allowed = await loadAllowlist();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "scan-secrets-"));
  try {
    for (const file of await listWorkingFiles(ROOT)) {
      stats.files++;
      const content = await readFile(file);
      if (isBinary(content)) {
        stats.binary++;
        continue;
      }
      scanText(content.toString("utf8"), path.relative(ROOT, file), allowed);
    }
    const bundles = await listBundles();
    for (const [index, bundle] of bundles.entries()) {
      await scanBundle(bundle, workDir, index, allowed);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log(
    `files: ${stats.files}, binary: ${stats.binary}, blobs: ${stats.blobs}, findings: ${stats.findings}, allowed: ${stats.allowed}`,
  );
  return stats.findings > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  },
);
