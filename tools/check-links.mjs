import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const manifestPath = path.join(root, "provenance", "manifest.json");
const exemptionsPath = path.join(root, "tools", "link-exemptions.json");
const exemptionReason =
  "Verbatim moved file (listed in provenance/manifest.json, or a byte-identical copy of a listed file): its bytes are fixed by sha256. The link points to material that was not moved (raw captures, local absolute paths, files of the source harness), to a path the file had in its source repository, or is part of captured prompt or tool text.";
const usage = "usage: bun tools/check-links.mjs [--write-exemptions]";

const linkPattern = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const codeSpanPattern = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const schemePattern = /^[a-z][a-z0-9+.-]*:/i;
const lineSuffixPattern = /:\d+(?::\d+)?$/;
const skipDirs = new Set([".git", "node_modules"]);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (file, target) => JSON.stringify([file, target]);
const toRel = (abs) => path.relative(root, abs).split(path.sep).join("/");

function listMarkdown(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) listMarkdown(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// Inline link and image targets outside fenced code blocks and code spans, with 1-based line numbers.
function linksIn(text) {
  const found = [];
  let fence = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = fencePattern.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.length && m[2].trim() === "") fence = null;
      continue;
    }
    if (m) {
      fence = { char: m[1][0], length: m[1].length };
      continue;
    }
    const prose = line.replace(codeSpanPattern, "");
    for (const match of prose.matchAll(linkPattern)) {
      const raw = match[1];
      const target = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
      found.push({ line: i + 1, target });
    }
  }
  return found;
}

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Returns null for targets that are not checked, otherwise whether the target exists on disk.
function targetExists(fileDir, target) {
  if (schemePattern.test(target) || target.startsWith("#")) return null;
  const cut = target.search(/[#?]/);
  const p = decode(cut === -1 ? target : target.slice(0, cut));
  if (fs.existsSync(path.resolve(fileDir, p))) return true;
  if (lineSuffixPattern.test(p)) {
    return fs.existsSync(path.resolve(fileDir, p.replace(lineSuffixPattern, "")));
  }
  return false;
}

function run() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--write-exemptions")) {
    console.error(usage);
    return 2;
  }
  const writeMode = args.includes("--write-exemptions");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const listed = new Set(manifest.files.map((entry) => entry.path));
  const manifestHashes = new Set(manifest.files.map((entry) => entry.sha256));
  // A file may exempt links when it is listed in the manifest or is byte-identical to a manifest entry.
  const allowed = (file) => {
    if (listed.has(file)) return true;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) return false;
    return manifestHashes.has(crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
  };

  const markdown = listMarkdown(root);
  let linkCount = 0;
  const broken = [];
  for (const abs of markdown) {
    const file = toRel(abs);
    const fileDir = path.dirname(abs);
    for (const { line, target } of linksIn(fs.readFileSync(abs, "utf8"))) {
      const exists = targetExists(fileDir, target);
      if (exists === null) continue;
      linkCount++;
      if (!exists) broken.push({ file, line, target });
    }
  }

  let exemptions = [];
  if (writeMode) {
    const unique = new Map();
    for (const { file, target } of broken) {
      if (allowed(file)) unique.set(keyOf(file, target), { file, target });
    }
    exemptions = [...unique.values()].sort((a, b) => compare(a.file, b.file) || compare(a.target, b.target));
    fs.writeFileSync(exemptionsPath, `${JSON.stringify({ reason: exemptionReason, links: exemptions }, null, 2)}\n`);
    console.log(`wrote ${toRel(exemptionsPath)}: ${exemptions.length} links`);
  } else if (fs.existsSync(exemptionsPath)) {
    const doc = JSON.parse(fs.readFileSync(exemptionsPath, "utf8"));
    if (!Array.isArray(doc.links)) throw new Error(`${toRel(exemptionsPath)}: "links" must be an array`);
    exemptions = doc.links;
  }

  // Only entries whose file is listed in the manifest, or is byte-identical to a manifest entry, may exempt a link.
  const brokenKeys = new Set(broken.map(({ file, target }) => keyOf(file, target)));
  const exemptKeys = new Set();
  const invalid = [];
  for (const entry of exemptions) {
    if (allowed(entry.file)) exemptKeys.add(keyOf(entry.file, entry.target));
    else invalid.push(entry);
  }
  const stale = exemptions.filter(
    (entry) => allowed(entry.file) && !brokenKeys.has(keyOf(entry.file, entry.target)),
  );

  const out = [];
  let brokenCount = 0;
  let exemptCount = 0;
  for (const { file, line, target } of broken) {
    if (exemptKeys.has(keyOf(file, target))) {
      exemptCount++;
    } else {
      brokenCount++;
      out.push(`BROKEN ${file}:${line} -> ${target}`);
    }
  }
  for (const { file, target } of stale) out.push(`STALE ${file} -> ${target}`);
  for (const { file, target } of invalid) {
    out.push(`INVALID_EXEMPTION ${file} -> ${target} (file is neither listed in provenance/manifest.json nor a byte-identical copy of a listed file)`);
  }
  out.push(
    `files: ${markdown.length}, links: ${linkCount}, broken: ${brokenCount}, exempt: ${exemptCount}, stale: ${stale.length}, invalid: ${invalid.length}`,
  );
  console.log(out.join("\n"));
  return brokenCount + stale.length + invalid.length > 0 ? 1 : 0;
}

try {
  process.exitCode = run();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
