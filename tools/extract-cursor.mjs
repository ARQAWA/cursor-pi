// Extracts the agent modules of an installed Cursor Desktop build into a temp
// folder and records their hashes. Cursor code is never written inside the repo.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = path.join(import.meta.dir, "..");
const DEFAULT_APP = "/Applications/Cursor.app";
const RESOURCES_DIR = "Contents/Resources/app";
const DAEMON_PATH = "Contents/Resources/app/extensions/cursor-agent-host/dist/agent-host-daemon/dist/bin/daemon.cjs";
const USAGE = "usage: bun tools/extract-cursor.mjs [--app <Cursor.app>] [--out <dir>] [--record <file>] [--check <file>]";
const ESM_MARKER = /__esm\(\{\s*"([^"]+)"\(\)\s*\{/g;
const COMMONJS_MARKER = /__commonJS\(\{\s*"([^"]+)"\(/g;

class UsageError extends Error {}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// Resolves the nearest existing ancestor through symlinks, so a symlinked --out cannot point into the repo unnoticed.
async function resolveThroughSymlinks(target) {
  let current = path.resolve(target);
  const rest = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== "ENOENT" || parent === current) throw error;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function readRecord(file) {
  let record;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new UsageError(`cannot read record ${file}: ${error.message}`);
  }
  if (!Array.isArray(record?.modules)) throw new UsageError(`not a record file: ${file}`);
  return record;
}

function findModules(pretty) {
  const esm = [...pretty.matchAll(ESM_MARKER)].map((m) => ({ path: m[1], kind: "esm", index: m.index }));
  const commonJS = [...pretty.matchAll(COMMONJS_MARKER)].map((m) => ({ path: m[1], kind: "commonJS", index: m.index }));
  const markers = [...esm, ...commonJS].sort((a, b) => a.index - b.index);
  if (markers.length === 0) throw new Error("no module markers found in the transpiled daemon");
  // Each module starts at the beginning of the line that holds its marker.
  const starts = markers.map((m) => pretty.lastIndexOf("\n", m.index - 1) + 1);
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) throw new Error(`two modules start on one line: ${markers[i].path}`);
  }
  const modules = markers.map((m, i) => {
    const text = pretty.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : pretty.length);
    return { path: m.path, kind: m.kind, text, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
  });
  return { prelude: pretty.slice(0, starts[0]), modules, esmCount: esm.length, commonJSCount: commonJS.length };
}

function planTargets(modules, modulesDir) {
  const seen = new Set();
  return modules.map((m) => {
    let rel = m.path;
    while (rel.startsWith("../")) rel = `__/${rel.slice(3)}`;
    const target = path.join(modulesDir, rel);
    if (target === modulesDir || !isInside(target, modulesDir)) {
      throw new Error(`module path leaves the output dir: ${m.path}`);
    }
    if (seen.has(target)) throw new Error(`duplicate module path: ${m.path}`);
    seen.add(target);
    return target;
  });
}

async function writeOutput(outDir, modulesDir, prelude, pretty, modules, targets) {
  await mkdir(modulesDir, { recursive: true });
  await Bun.write(path.join(outDir, "pretty.js"), pretty);
  await Bun.write(path.join(outDir, "prelude.js"), prelude);
  for (const [i, m] of modules.entries()) {
    await mkdir(path.dirname(targets[i]), { recursive: true });
    await Bun.write(targets[i], m.text);
  }
}

function buildRecord(version, commit, daemonBytes, pretty, split) {
  return {
    app: { name: "Cursor", version, commit },
    daemon: { path: DAEMON_PATH, bytes: daemonBytes.length, sha256: sha256(daemonBytes) },
    transpiler: { bun: Bun.version, loader: "js" },
    pretty: { lines: pretty.split("\n").length, sha256: sha256(pretty) },
    markers: { esm: split.esmCount, commonJS: split.commonJSCount },
    modules: split.modules.map((m) => ({ path: m.path, kind: m.kind, bytes: m.bytes, sha256: m.sha256 })),
  };
}

function compareRecords(recorded, current) {
  const lines = [];
  let changed = 0;
  let missing = 0;
  let extra = 0;
  const fields = [
    ["app.version", recorded.app?.version, current.app.version],
    ["app.commit", recorded.app?.commit, current.app.commit],
    ["daemon.sha256", recorded.daemon?.sha256, current.daemon.sha256],
    ["pretty.sha256", recorded.pretty?.sha256, current.pretty.sha256],
  ];
  for (const [name, before, after] of fields) {
    if (before !== after) lines.push(`CHANGED ${name}: ${before} -> ${after}`);
  }
  const recordedByPath = new Map(recorded.modules.map((m) => [m.path, m]));
  const currentByPath = new Map(current.modules.map((m) => [m.path, m]));
  for (const m of recorded.modules) {
    if (!currentByPath.has(m.path)) {
      lines.push(`MISSING ${m.path}`);
      missing++;
    }
  }
  for (const m of current.modules) {
    const before = recordedByPath.get(m.path);
    if (!before) {
      lines.push(`EXTRA ${m.path}`);
      extra++;
      continue;
    }
    const reasons = [];
    if (before.kind !== m.kind) reasons.push(`kind ${before.kind} -> ${m.kind}`);
    if (before.sha256 !== m.sha256) reasons.push("sha256");
    if (reasons.length > 0) {
      lines.push(`CHANGED ${m.path} (${reasons.join(", ")})`);
      changed++;
    }
  }
  // Order is compared over the paths present on both sides, so an added or removed module does not shift every later entry.
  const recordedOrder = recorded.modules.map((m) => m.path).filter((p) => currentByPath.has(p));
  const currentOrder = current.modules.map((m) => m.path).filter((p) => recordedByPath.has(p));
  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i] !== recordedOrder[i]) {
      lines.push(`CHANGED order at position ${i + 1}: ${currentOrder[i]} (recorded: ${recordedOrder[i]})`);
      changed++;
    }
  }
  return { lines, changed, missing, extra, count: current.modules.length };
}

async function main(argv) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        app: { type: "string" },
        out: { type: "string" },
        record: { type: "string" },
        check: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const recorded = options.check ? await readRecord(options.check) : null;

  const appPath = path.resolve(options.app ?? DEFAULT_APP);
  const product = JSON.parse(await readFile(path.join(appPath, RESOURCES_DIR, "product.json"), "utf8"));
  const { version, commit } = product;
  if (typeof version !== "string" || typeof commit !== "string" || commit === "") {
    throw new Error("product.json has no string version and commit");
  }

  const outDir = path.resolve(options.out ?? path.join(os.tmpdir(), `cursor-${version}-${commit.slice(0, 8)}`));
  if (isInside(await resolveThroughSymlinks(outDir), await resolveThroughSymlinks(REPO_ROOT))) {
    throw new UsageError(`output dir is inside the repository: ${outDir}`);
  }

  const daemonBytes = await readFile(path.join(appPath, DAEMON_PATH));
  const pretty = new Bun.Transpiler({ loader: "js" }).transformSync(daemonBytes.toString("utf8"));
  const split = findModules(pretty);
  const modulesDir = path.join(outDir, "modules");
  const targets = planTargets(split.modules, modulesDir);
  await writeOutput(outDir, modulesDir, split.prelude, pretty, split.modules, targets);

  const record = buildRecord(version, commit, daemonBytes, pretty, split);
  console.log(`output: ${outDir}`);
  let failed = false;
  if (recorded) {
    const diff = compareRecords(recorded, record);
    if (recorded.transpiler?.bun !== record.transpiler.bun) {
      console.log(`WARNING transpiler.bun differs: recorded ${recorded.transpiler?.bun}, current ${record.transpiler.bun}`);
    }
    for (const line of diff.lines) console.log(line);
    console.log(`modules: ${diff.count}, changed: ${diff.changed}, missing: ${diff.missing}, extra: ${diff.extra}`);
    failed = diff.lines.length > 0;
  }
  if (options.record) {
    const recordFile = path.resolve(options.record);
    await mkdir(path.dirname(recordFile), { recursive: true });
    await Bun.write(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`record: ${recordFile}`);
  }
  console.log(`esm: ${split.esmCount}, commonJS: ${split.commonJSCount}, modules: ${split.modules.length}`);
  return failed ? 1 : 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`error: ${error.message}\n${USAGE}`);
    process.exitCode = 2;
  } else {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
