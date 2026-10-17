#!/usr/bin/env bun
// Checks the rg tool against Cursor Desktop's own code. Each fixture is searched by Cursor's LocalGrepExecutor (the bundled
// ripgrep with --cursor-ignore), and the result is formatted by Cursor's grep formatters, pagination and error mapping.
// Captured calls from research/cursor/reverse are reproduced on fixtures built to their listed output.
// Usage: bun tools/check-rg.mjs

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { executeRg } from "../extensions/cursor-pi/tools/rg.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const execFileAsync = promisify(execFile);
const BUNDLED_RG = "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg";
// Cursor modules whose top-level variables the executor and formatters read.
const ORACLE_MODULES = [
	"../proto/dist/generated/agent/v1/grep_exec_pb.js",
	"../proto/dist/generated/agent/v1/glob_tool_pb.js",
	"../agent/dist/tools/common.js",
	"../agent/dist/tools/core/get-pr-code-tour.js",
	"../agent/dist/tools/core/ripgrep-error-classification.js",
	"../agent/dist/tools/core/grep/formatters.js",
	"../agent/dist/tools/core/grep/pagination.js",
	"../agent/dist/tools/core/grep/cache.js",
	"../agent/dist/tools/core/glob/glob.js",
	"../local-exec/dist/services/ignore-service.js",
	"../local-exec/dist/grep.js",
];

let cursorPromise;
function oracle() {
	cursorPromise ??= (async () => {
		const c = await loadCursor();
		for (const marker of ORACLE_MODULES) initModule(c, marker);
		c.configureRipgrepPath(BUNDLED_RG);
		return c;
	})();
	return cursorPromise;
}

const gitExecutor = {
	exec: async (_ctx, cwd, args) => {
		try {
			return { stdout: (await execFileAsync("git", args, { cwd })).stdout };
		} catch {
			return { stdout: "" };
		}
	},
};

// Cursor's rg tool path: LocalGrepExecutor.execute, then pagination, then resultToString7 (or serializeError + render).
async function cursorRg(c, ignore, root, p) {
	const exec = new c.LocalGrepExecutor(ignore, {}, root, {});
	const args = {
		clone() {
			return { ...this };
		},
		pattern: p.pattern,
		path: p.path,
		glob: p.glob,
		type: p.type,
		outputMode: p.output_mode ?? "content",
		multiline: p.multiline === true,
		caseInsensitive: p["-i"] === true,
		contextBefore: p["-B"] === undefined ? undefined : Math.ceil(p["-B"]),
		contextAfter: p["-A"] === undefined ? undefined : Math.ceil(p["-A"]),
		context: p["-C"] === undefined ? undefined : Math.ceil(p["-C"]),
		toolCallId: "check",
	};
	const result = await exec.execute(c.createContext(), args, { execId: "check" });
	if (result.result.case === "error") {
		const message = c.classifyRipgrepError(result.result.value.error, { pattern: p.pattern }).message;
		const modelVisible = c.truncateOutput(message, 15000, true).output;
		return { text: c.resultToString7({ result: { case: "error", value: { error: modelVisible } } }), isError: true };
	}
	const headLimit = p.head_limit === undefined ? undefined : Math.ceil(p.head_limit) || undefined;
	const offset = p.offset === undefined ? 0 : Math.floor(p.offset);
	// Cursor's root-target output carries the "./" prefix that the captured results do not show; the check strips it the same way.
	const text = c.resultToString7(c.applyGrepPagination(result, offset, headLimit));
	return { text: !p.path || p.path === "." ? text.replace(/^\.\//gm, "") : text, isError: false };
}

// Writes files and gives them descending mtimes: the first file is the newest, as in a listing sorted by mtime.
async function writeTree(base, files) {
	const now = Date.now() / 1000;
	for (const [index, [relativePath, content]] of Object.entries(files).entries()) {
		const file = join(base, relativePath);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
		const mtime = now - index * 60;
		await utimes(file, mtime, mtime);
	}
}

async function fixtureDir(files) {
	const base = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-rg-")));
	await writeTree(base, files);
	return base;
}

const hits = Array.from({ length: 2100 }, (_, i) => `hit ${i}`).join("\n") + "\n";
const longLines = Array.from({ length: 300 }, (_, i) => `long ${i} ${"x".repeat(100)}`).join("\n") + "\n";

const mainFiles = {
	"src/a.ts": "alpha\nbeta wallet_sync\ngamma\n",
	"src/sub/b.ts": "wallet_sync here\n",
	"src/secret.ts": "wallet_sync secret\n",
	"src/sub/deep/c.py": "one\nmatch line\nthree\nfour\nfive\nmatch again\n",
	"big.txt": hits,
	"long.txt": longLines,
	"README.md": "nothing here\n",
	"sub2/.cursorignore": "*.log\n# comment\n",
	"sub2/x.log": "hit in log\n",
	"sub2/y.txt": "hit in text\n",
	".cursorignore": "src/secret.ts\n",
};

const outsideDir = await fixtureDir({ "outside.txt": "wallet outside\n" });

const cases = [];
const main = await fixtureDir(mainFiles);
for (const params of [
	{ pattern: "wallet_sync" },
	{ pattern: "wallet_sync", output_mode: "files_with_matches" },
	{ pattern: "wallet_sync", output_mode: "count" },
	{ pattern: "match", "-C": 1 },
	{ pattern: "match", "-B": 1, "-A": 2 },
	{ pattern: "HIT", "-i": true, output_mode: "count", head_limit: 1 },
	{ pattern: "hit", output_mode: "files_with_matches", head_limit: 1, offset: 1 },
	{ pattern: "hit" },
	{ pattern: "hit", output_mode: "count" },
	{ pattern: "hit", offset: 5000000 },
	{ pattern: "zzz_none" },
	{ pattern: "zzz_none", output_mode: "files_with_matches" },
	{ pattern: "zzz_none", output_mode: "count" },
	{ pattern: "wallet", path: "src/sub" },
	{ pattern: "wallet", path: "src/secret.ts" },
	{ pattern: "wallet", path: outsideDir },
	{ pattern: "wallet", path: "nope" },
	{ pattern: "(" },
	{ pattern: "hit", type: "nosuchtype" },
	{ pattern: "hit", glob: "*.py" },
	{ pattern: "wallet", multiline: true, output_mode: "count" },
	{ pattern: "long" },
	{ pattern: "hit", path: "sub2", output_mode: "files_with_matches" },
	{ pattern: "wallet", path: "src/a.ts" },
	{ pattern: "wallet", path: "src/a.ts", "-C": 0 },
]) {
	cases.push({ name: `main ${JSON.stringify(params)}`, root: main, params });
}

// Captured calls reproduced on fixtures: the listed output is the expected text.
const captured = [];
{
	const root = await fixtureDir({ "src/app/cfg.py": "nothing\n", "src/app/other.py": "wallet\n" });
	captured.push({
		name: "captured 039 no matches with glob and head_limit",
		root,
		params: { pattern: "wallet|Python", glob: "*boundary*", head_limit: 25 },
		expected: `<workspace_result workspace_path="${root}">\nNo matches found\n</workspace_result>`,
	});
}
{
	const root = await fixtureDir({
		"src/superbot_ng/tests/test_wallet_scheduler_contracts.py": "def test_scheduler():\n    pass\n",
	});
	captured.push({
		name: "captured 037 no matches in one file",
		root,
		params: { pattern: "async def run_bounded_workers|processed_count|restart|unfinished", path: join(root, "src/superbot_ng/tests/test_wallet_scheduler_contracts.py"), "-C": 3 },
		expected: `<workspace_result workspace_path="${root}">\nNo matches found\n</workspace_result>`,
	});
}
{
	// The 24 files of captured call 002, newest first.
	const names = [
		"models/mongo.py", "rust/services/wallet_sync/src/daemon.rs", "rust/services/wallet_sync/src/session.rs", "docker-compose.app.yml",
		"tests/contracts/runtime/test_runtime_entrypoints_inventory_contracts.py", "rust/services/wallet_sync/src/store.rs",
		"src/superbot_ng/repositories/postgres/wallet/store_iterations.py", "src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py",
		"rust/Cargo.toml", "src/superbot_ng/repositories/postgres/wallet/store_roster.py", "migrations/postgres/000007_wallet_sync.sql",
		"rust/services/wallet_sync/src/main.rs", "src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py", "_scripts/redeploy_screen.sh",
		"src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py", "src/superbot_ng/repositories/postgres/wallet/store_sync_results.py",
		"tests/contracts/infra/test_clickhouse_infra_contracts.py", "tests/contracts/wallet/test_wallet_scheduler_contracts.py", "Makefile",
		"rust/services/wallet_sync/src/config.rs", "config.toml", "aWalletSync.py", "migrations/postgres/000012_wallet_due_scheduler.sql",
		"tests/contracts/wallet/test_wallet_ng_contracts.py",
	];
	const root = await fixtureDir(Object.fromEntries(names.map((name) => [name, "wallet_sync\n"])));
	captured.push({
		name: "captured 002 files_with_matches wallet_sync",
		root,
		params: { pattern: "wallet_sync", output_mode: "files_with_matches" },
		expected: `<workspace_result workspace_path="${root}">\n${names.join("\n")}\n</workspace_result>`,
	});
}

const validation = [
	{ params: { pattern: "" }, expected: 'Error running tool: pattern is empty. Pass "." to match every line.' },
	{ params: { pattern: "x", "-A": -1 }, expected: "Error running tool: -A is -1. Pass 0 or more context lines." },
];

let failed = 0;
function report(name, ok, detail) {
	if (ok) console.log(`ok ${name}`);
	else {
		failed++;
		console.log(`FAIL ${name}\n${detail}`);
	}
}

function diff(expected, actual) {
	let i = 0;
	while (i < expected.length && expected[i] === actual[i]) i++;
	const snippet = (text) => JSON.stringify(text.slice(Math.max(0, i - 60), i + 160));
	return `  first difference at char ${i} (expected ${expected.length} chars, ours ${actual.length})\n  expected: ${snippet(expected)}\n  ours:     ${snippet(actual)}`;
}

const c = await oracle();
const ignores = new Map();
function ignoreFor(root) {
	if (!ignores.has(root)) ignores.set(root, new c.LazyIgnoreService(gitExecutor, undefined, [root]));
	return ignores.get(root);
}

for (const { name, root, params } of cases) {
	const ours = await executeRg(params, undefined, { cwd: root });
	const expected = await cursorRg(c, ignoreFor(root), root, params);
	const text = ours.content[0].text;
	const ok = text === expected.text && Boolean(ours.isError) === expected.isError;
	report(name, ok, ok ? "" : `${diff(expected.text, text)}\n  error flag: expected ${expected.isError}, ours ${Boolean(ours.isError)}`);
}

for (const { params, expected } of validation) {
	const ours = await executeRg(params, undefined, { cwd: main });
	report(`validation ${JSON.stringify(params)}`, ours.content[0].text === expected, diff(expected, ours.content[0].text));
}

for (const { name, root, params, expected } of captured) {
	const ours = await executeRg(params, undefined, { cwd: root });
	report(name, ours.content[0].text === expected, diff(expected, ours.content[0].text));
}

console.log(failed === 0 ? `all ${cases.length + validation.length + captured.length} checks ok` : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
