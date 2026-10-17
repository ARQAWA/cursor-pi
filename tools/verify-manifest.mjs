import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dir, "..");
const SOURCES_PATH = "provenance/sources.json";
const MANIFEST_PATH = "provenance/manifest.json";
const USAGE = "usage: bun tools/verify-manifest.mjs [--repo <name>=<git dir or URL>]...";

function usageError(message) {
  console.error(USAGE);
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const overrides = new Map();
  for (let i = 0; i < argv.length; i++) {
    let value;
    if (argv[i] === "--repo") {
      value = argv[++i];
      if (value === undefined) usageError("--repo needs a value <name>=<git dir or URL>");
    } else if (argv[i].startsWith("--repo=")) {
      value = argv[i].slice("--repo=".length);
    } else {
      usageError(`unknown argument: ${argv[i]}`);
    }
    const eq = value.indexOf("=");
    if (eq <= 0 || eq === value.length - 1) usageError(`--repo expects <name>=<git dir or URL>, got: ${value}`);
    const name = value.slice(0, eq);
    if (overrides.has(name)) usageError(`repo given more than once: ${name}`);
    overrides.set(name, value.slice(eq + 1));
  }
  return overrides;
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${relPath}: ${error.message}`);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function git(args, input) {
  const result = spawnSync("git", args, { input, maxBuffer: 1 << 30 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout;
}

function gitIn(dir, args, input) {
  return git(["-C", dir, ...args], input);
}

// Reads blobs for {commit, path} requests in one cat-file call; null marks a missing or non-blob object.
function readBlobs(dir, requests) {
  if (requests.length === 0) return [];
  const input = requests.map(({ commit, path: p }) => {
    if (p.includes("\n")) throw new Error(`path contains a newline: ${JSON.stringify(p)}`);
    return `${commit}:${p}\n`;
  }).join("");
  const out = gitIn(dir, ["cat-file", "--batch"], input);
  const blobs = [];
  let pos = 0;
  for (let i = 0; i < requests.length; i++) {
    const eol = out.indexOf(0x0a, pos);
    if (eol < 0) throw new Error(`cat-file output ended early in ${dir}`);
    const header = out.toString("utf8", pos, eol).split(" ");
    pos = eol + 1;
    const last = header[header.length - 1];
    if (last === "missing" || last === "ambiguous") {
      blobs.push(null);
      continue;
    }
    const size = Number(last);
    const content = out.subarray(pos, pos + size);
    pos += size + 1;
    blobs.push(header[header.length - 2] === "blob" ? content : null);
  }
  return blobs;
}

function readBlobsByRepo(requests, repoDirs) {
  const blobs = new Array(requests.length).fill(null);
  for (const repo of new Set(requests.map((r) => r.repo))) {
    const dir = repoDirs.get(repo);
    if (dir === undefined) throw new Error(`no git dir for repo ${repo}`);
    const indexes = requests.flatMap((r, i) => (r.repo === repo ? [i] : []));
    const got = readBlobs(dir, indexes.map((i) => requests[i]));
    indexes.forEach((i, k) => {
      blobs[i] = got[k];
    });
  }
  return blobs;
}

function isUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^/\\\s]+@[^/\\\s]+:/.test(value);
}

// Returns a git dir: a local dir as given, a URL cloned bare without blobs, or a repo built from the listed bundles.
function prepareRepo(name, override, sourceRepo, work) {
  if (override !== undefined && !isUrl(override)) return path.resolve(override);
  const dest = path.join(work, `${name}.git`);
  if (override !== undefined) {
    git(["clone", "--bare", "--quiet", "--filter=blob:none", override, dest]);
  } else if (sourceRepo.bundles) {
    git(["init", "--bare", "--quiet", dest]);
    for (const bundle of sourceRepo.bundles) {
      git(["-C", dest, "fetch", "--quiet", path.join(ROOT, bundle), "refs/heads/*:refs/heads/*"]);
    }
  } else {
    git(["clone", "--bare", "--quiet", "--filter=blob:none", sourceRepo.url, dest]);
  }
  return dest;
}

function listFiles(root) {
  const files = [];
  const pending = [root.replace(/\/+$/, "")];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) pending.push(rel);
      else files.push(rel);
    }
  }
  return files;
}

function verify(sources, manifest, overrides, work) {
  const repoDirs = new Map();
  for (const [name, repo] of Object.entries(sources.repos)) {
    repoDirs.set(name, prepareRepo(name, overrides.get(name), repo, work));
  }

  const report = [];
  const counts = { verified: 0, mismatches: 0, missing: 0, unlisted: 0 };
  const listed = new Set();
  const jobs = [];
  for (const file of manifest.files) {
    listed.add(file.path);
    const diskFile = path.join(ROOT, file.path);
    if (!fs.existsSync(diskFile)) {
      report.push(`MISSING ${file.path} no file at this path`);
      counts.missing++;
      continue;
    }
    const diskHash = sha256(fs.readFileSync(diskFile));
    const locations = [{ repo: file.repo, commit: file.commit, sourcePath: file.sourcePath }, ...(file.alsoAt ?? [])];
    for (const loc of locations) jobs.push({ file, loc, diskFile, diskHash });
  }

  const blobs = readBlobsByRepo(
    jobs.map(({ loc }) => ({ repo: loc.repo, commit: loc.commit, path: loc.sourcePath })),
    repoDirs,
  );
  jobs.forEach(({ file, loc, diskFile, diskHash }, i) => {
    const where = `${loc.repo}@${loc.commit.slice(0, 12)}:${loc.sourcePath}`;
    if (blobs[i] === null) {
      report.push(`MISSING ${file.path} source ${where} is not a readable blob`);
      counts.missing++;
      return;
    }
    const tempFile = path.join(work, `location-${i}`);
    fs.writeFileSync(tempFile, blobs[i]);
    const problems = [];
    if (diskHash !== file.sha256) problems.push(`repo file sha256 ${diskHash} != manifest ${file.sha256}`);
    const blobHash = sha256(fs.readFileSync(tempFile));
    if (blobHash !== file.sha256) problems.push(`source blob sha256 ${blobHash} != manifest ${file.sha256}`);
    const cmp = spawnSync("cmp", ["-s", tempFile, diskFile]);
    if (cmp.status === 1) problems.push("cmp: source blob differs from repo file");
    else if (cmp.status !== 0) problems.push(`cmp failed (status ${cmp.status}): ${cmp.stderr.toString().trim()}`);
    if (problems.length > 0) {
      report.push(`MISMATCH ${file.path} ${where}: ${problems.join("; ")}`);
      counts.mismatches++;
    } else {
      counts.verified++;
    }
  });

  for (const root of sources.movedRoots) {
    for (const file of listFiles(root)) {
      if (!listed.has(file)) {
        report.push(`UNLISTED ${file} is on disk but not in the manifest`);
        counts.unlisted++;
      }
    }
  }

  for (const line of report) console.log(line);
  console.log(`verified: ${counts.verified} locations, mismatches: ${counts.mismatches}, missing: ${counts.missing}, unlisted: ${counts.unlisted}`);
  return counts.mismatches + counts.missing + counts.unlisted > 0 ? 1 : 0;
}

function main() {
  const overrides = parseArgs(process.argv.slice(2));
  const sources = readJson(SOURCES_PATH);
  const manifest = readJson(MANIFEST_PATH);
  for (const name of overrides.keys()) {
    if (!Object.hasOwn(sources.repos, name)) usageError(`unknown repo: ${name}`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "verify-manifest-"));
  try {
    return verify(sources, manifest, overrides, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`verify failed: ${error.message}`);
  process.exitCode = 1;
}
