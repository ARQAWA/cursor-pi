import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dir, "..");
const SOURCES_PATH = "provenance/sources.json";
const MANIFEST_PATH = "provenance/manifest.json";
const USAGE = "usage: bun tools/build-manifest.mjs --repo my-omp-harness=<git dir> --repo my-codex-harness=<git dir>";

function usageError(message) {
  console.error(USAGE);
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const repoDirs = new Map();
  for (let i = 0; i < argv.length; i++) {
    let value;
    if (argv[i] === "--repo") {
      value = argv[++i];
      if (value === undefined) usageError("--repo needs a value <name>=<git dir>");
    } else if (argv[i].startsWith("--repo=")) {
      value = argv[i].slice("--repo=".length);
    } else {
      usageError(`unknown argument: ${argv[i]}`);
    }
    const eq = value.indexOf("=");
    if (eq <= 0 || eq === value.length - 1) usageError(`--repo expects <name>=<git dir>, got: ${value}`);
    const name = value.slice(0, eq);
    if (repoDirs.has(name)) usageError(`repo given more than once: ${name}`);
    repoDirs.set(name, path.resolve(value.slice(eq + 1)));
  }
  return repoDirs;
}

function readSources() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, SOURCES_PATH), "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${SOURCES_PATH}: ${error.message}`);
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

function nulList(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function listTree(dir, commit, prefix) {
  const args = ["ls-tree", "-r", "-z", "--name-only", commit];
  if (prefix !== undefined) args.push("--", prefix);
  return nulList(gitIn(dir, args));
}

function diffNames(dir, base, commit) {
  return nulList(gitIn(dir, ["diff", "--name-only", "--no-renames", "-z", base, commit]));
}

function deletedNames(dir, commit, deletedIn) {
  return nulList(gitIn(dir, ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=D", commit, deletedIn]));
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

function expandRule(rule, ruleIndex, dir) {
  const item = (target, sourcePath) => ({
    target,
    sourcePath,
    commit: rule.commit,
    repo: rule.repo,
    branch: rule.branch,
    ruleIndex,
  });
  switch (rule.kind) {
    case "tree":
      return listTree(dir, rule.commit, rule.sourcePrefix).map((p) => {
        const hit = (rule.remap ?? []).find((m) => p.startsWith(m.sourcePrefix));
        const target = hit
          ? hit.targetPrefix + p.slice(hit.sourcePrefix.length)
          : rule.targetPrefix + p.slice(rule.sourcePrefix.length);
        return item(target, p);
      });
    case "diff":
      return diffNames(dir, rule.base, rule.commit)
        .filter((p) => rule.excludePrefix === undefined || !p.startsWith(rule.excludePrefix))
        .map((p) => item(rule.targetPrefix + p, p));
    case "paths":
      return rule.paths.map((p) => item(rule.targetPrefix + p, p));
    case "deleted":
      return deletedNames(dir, rule.commit, rule.deletedIn).map((p) => item(rule.targetPrefix + p, p));
    default:
      throw new Error(`rule #${ruleIndex} has unknown kind: ${rule.kind}`);
  }
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

function manifestFile(entry) {
  const file = {
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes,
    repo: entry.repo,
    branch: entry.branch,
    commit: entry.commit,
    sourcePath: entry.sourcePath,
  };
  if (entry.alsoAt.length > 0) file.alsoAt = entry.alsoAt;
  return file;
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function build() {
  const repoDirs = parseArgs(process.argv.slice(2));
  const sources = readSources();
  for (const name of Object.keys(sources.repos)) {
    if (!repoDirs.has(name)) usageError(`missing --repo ${name}=<git dir>`);
  }
  for (const name of repoDirs.keys()) {
    if (!Object.hasOwn(sources.repos, name)) usageError(`unknown repo: ${name}`);
  }

  const problems = [];

  const candidates = [];
  sources.rules.forEach((rule, ruleIndex) => {
    if (rule.kind === "alias") return;
    candidates.push(...expandRule(rule, ruleIndex, repoDirs.get(rule.repo)));
  });
  const blobs = readBlobsByRepo(
    candidates.map((c) => ({ repo: c.repo, commit: c.commit, path: c.sourcePath })),
    repoDirs,
  );

  const primary = new Map();
  const seenTargets = new Map();
  candidates.forEach((c, i) => {
    const prev = seenTargets.get(c.target);
    if (prev) {
      problems.push(`DUPLICATE ${c.target} is produced by rule #${prev.ruleIndex} and rule #${c.ruleIndex}`);
      return;
    }
    seenTargets.set(c.target, c);
    if (blobs[i] === null) {
      problems.push(`MISSING ${c.target} source ${c.repo}@${c.commit}:${c.sourcePath} is not a readable blob`);
      return;
    }
    primary.set(c.target, {
      path: c.target,
      sha256: sha256(blobs[i]),
      bytes: blobs[i].length,
      repo: c.repo,
      branch: c.branch,
      commit: c.commit,
      sourcePath: c.sourcePath,
      alsoAt: [],
    });
  });

  for (const rule of sources.rules) {
    if (rule.kind !== "alias") continue;
    const dir = repoDirs.get(rule.repo);
    const tree = listTree(dir, rule.commit);
    const covered = new Set();
    for (const r of sources.rules) {
      if (r.kind === "paths" && r.repo === rule.repo && r.commit === rule.commit) {
        for (const p of r.paths) covered.add(p);
      }
    }
    const aliasFiles = [];
    for (const p of tree) {
      const hit = rule.map.find((m) => p.startsWith(m.sourcePrefix));
      if (hit) {
        aliasFiles.push({ path: p, target: hit.targetPrefix + p.slice(hit.sourcePrefix.length) });
      } else if (!covered.has(p)) {
        problems.push(`UNCOVERED ${p} is in ${rule.repo}@${rule.commit} but no paths rule or alias prefix covers it`);
      }
    }
    const aliasBlobs = readBlobsByRepo(
      aliasFiles.map((f) => ({ repo: rule.repo, commit: rule.commit, path: f.path })),
      repoDirs,
    );
    aliasFiles.forEach((f, i) => {
      const entry = primary.get(f.target);
      if (!entry) {
        problems.push(`ALIAS-NO-ENTRY ${f.path} maps to ${f.target}, which no other rule produces`);
        return;
      }
      if (aliasBlobs[i] === null) {
        problems.push(`MISSING ${f.path} alias source is not a readable blob`);
        return;
      }
      if (sha256(aliasBlobs[i]) !== entry.sha256) {
        problems.push(`ALIAS-DIFFERS ${f.path} content differs from ${f.target}`);
        return;
      }
      entry.alsoAt.push({ repo: rule.repo, branch: rule.branch, commit: rule.commit, sourcePath: f.path });
    });
  }

  for (const entry of primary.values()) {
    const file = path.join(ROOT, entry.path);
    if (!fs.existsSync(file)) {
      problems.push(`MISSING ${entry.path} no file on disk`);
      continue;
    }
    const diskHash = sha256(fs.readFileSync(file));
    if (diskHash !== entry.sha256) {
      problems.push(`MISMATCH ${entry.path} disk sha256 ${diskHash} differs from source blob ${entry.sha256}`);
    }
  }

  for (const root of sources.movedRoots) {
    for (const file of listFiles(root)) {
      if (!primary.has(file)) problems.push(`UNLISTED ${file} is on disk but has no manifest entry`);
    }
  }

  if (problems.length > 0) {
    for (const line of problems) console.error(line);
    console.error(`build failed: ${problems.length} problems, ${MANIFEST_PATH} not written`);
    return 1;
  }

  const files = [...primary.values()].sort(byPath).map(manifestFile);
  const manifest = { generatedFrom: SOURCES_PATH, count: files.length, files };
  fs.writeFileSync(path.join(ROOT, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${files.length} files, ${files.filter((f) => f.alsoAt).length} with alsoAt`);
  return 0;
}

try {
  process.exitCode = build();
} catch (error) {
  console.error(`build failed: ${error.message}`);
  process.exitCode = 1;
}
