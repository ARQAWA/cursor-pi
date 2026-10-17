#!/usr/bin/env bun
// Checks the Glob tool against Cursor Desktop's own code. Each fixture is searched by Cursor's LocalGrepExecutor (the bundled
// ripgrep with --cursor-ignore), mapped by Cursor's mapGrepResultToGlobToolResult and formatted by its formatFilesForGlob.
// Captured calls 004 and 012 from research/cursor/reverse are reproduced on fixtures built to their listed output.
// Usage: bun tools/check-glob.mjs

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { executeGlob } from "../extensions/cursor-pi/tools/glob.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const execFileAsync = promisify(execFile);
const BUNDLED_RG = "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg";
const ORACLE_MODULES = [
	"../proto/dist/generated/agent/v1/grep_exec_pb.js",
	"../proto/dist/generated/agent/v1/glob_tool_pb.js",
	"../agent/dist/tools/common.js",
	"../agent/dist/tools/core/get-pr-code-tour.js",
	"../agent/dist/tools/core/ripgrep-error-classification.js",
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

// Cursor's Glob path: normalizeGlob, the listing search, the glob mapping, then formatFilesForGlob.
async function cursorGlob(c, ignore, root, p) {
	const glob = c.normalizeGlob(p.glob_pattern);
	if (glob === "**/") return { text: 'glob_pattern is empty. Pass "*" to match every file.', isError: true };
	const exec = new c.LocalGrepExecutor(ignore, {}, root, {});
	const args = {
		clone() {
			return { ...this };
		},
		pattern: "",
		path: p.target_directory,
		glob,
		outputMode: "files_with_matches",
		toolCallId: "check",
	};
	const result = await exec.execute(c.createContext(), args, { execId: "check" });
	if (result.result.case === "error") {
		const message = c.classifyRipgrepError(result.result.value.error).message;
		const once = c.truncateOutput(message, 5000, true).output;
		return { text: c.formatFilesForGlob({ result: { case: "error", value: { error: once } } }, "."), isError: true };
	}
	const mapped = c.mapGrepResultToGlobToolResult(result);
	const searchRoot = mapped.result.case === "success" ? mapped.result.value.path || "." : ".";
	return { text: c.formatFilesForGlob(mapped, searchRoot), isError: false };
}

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
	const base = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-glob-")));
	await writeTree(base, files);
	return base;
}

const mainFiles = {
	"src/a.ts": "alpha\n",
	"src/sub/b.ts": "beta\n",
	"src/secret.ts": "secret\n",
	"src/sub/deep/c.py": "gamma\n",
	"big.txt": "big\n",
	"README.md": "nothing here\n",
	"sub2/.cursorignore": "*.log\n",
	"sub2/x.log": "log\n",
	"sub2/y.txt": "text\n",
	".cursorignore": "src/secret.ts\n",
};
const main = await fixtureDir(mainFiles);
const outsideDir = await fixtureDir({ "outside.txt": "outside\n", "more/inner.txt": "inner\n" });
const many = await fixtureDir(Object.fromEntries(Array.from({ length: 2100 }, (_, i) => [`many/file-${String(i).padStart(4, "0")}-with-a-longer-name.txt`, "x\n"])));

const cases = [
	{ root: main, params: { glob_pattern: "*.ts" } },
	{ root: main, params: { glob_pattern: "**/*.py" } },
	{ root: main, params: { glob_pattern: "src/*" } },
	{ root: main, params: { glob_pattern: "*.nothing" } },
	{ root: main, params: { glob_pattern: "*", target_directory: join(main, "src/sub") } },
	{ root: main, params: { glob_pattern: "*.txt", target_directory: "sub2" } },
	{ root: main, params: { glob_pattern: "*", target_directory: outsideDir } },
	{ root: main, params: { glob_pattern: "*", target_directory: "nope" } },
	{ root: main, params: { glob_pattern: "src\\*.ts" } },
	{ root: main, params: { glob_pattern: "*.ts", target_directory: join(main, "src") } },
	{ root: main, params: { glob_pattern: "*", target_directory: "src/secret.ts" } },
	{ root: many, params: { glob_pattern: "*", target_directory: join(many, "many") } },
];

// Captured call 004: "**/workers/wallet/**", 9 files, newest first.
const names004 = ["daemon", "scheduler", "__init__", "pending", "login_sync", "iteration", "fetch_event", "failures", "observer"];
const root004 = await fixtureDir(Object.fromEntries(names004.map((name) => [`src/superbot_ng/workers/wallet/${name}.py`, "\n"])));
// Captured call 012: "**/*wallet*", 57 files, newest first.
const names012 = [
	"rust/crates/steam_wallet/src/lib.rs", "src/superbot_ng/repositories/redis/wallet/__init__.py", "src/superbot_ng/domain/wallet/models.py",
	"src/superbot_ng/clients/steam/wallet/errors.py", "src/superbot_ng/repositories/postgres/wallet/store_sync_results.py",
	"src/superbot_ng/domain/wallet/__init__.py", "tests/contracts/wallet/test_wallet_scheduler_contracts.py",
	"src/superbot_ng/pipelines/wallet/envelope.py", "rust/services/wallet_sync/src/main.rs",
	"migrations/clickhouse/000011_wallet_daily_without_final.sql", "src/superbot_ng/clients/kafka/wallet/wallet_writer.py",
	"src/superbot_ng/workers/wallet/failures.py", "rust/services/wallet_sync/src/daemon.rs",
	"migrations/clickhouse/000003_wallet_stats_events.sql", "src/superbot_ng/repositories/postgres/wallet/__init__.py",
	"tests/contracts/wallet/test_wallet_ng_contracts.py", "src/superbot_ng/ports/wallet/__init__.py",
	"src/superbot_ng/pipelines/wallet/codec.py", "src/superbot_ng/ports/wallet/cooldown.py", "rust/services/wallet_sync/src/model.rs",
	"src/superbot_ng/pipelines/wallet/__init__.py", "rust/crates/steam_wallet/Cargo.toml", "rust/services/wallet_sync/src/session.rs",
	"src/superbot_ng/repositories/postgres/wallet/store_sync_failure_sql.py", "migrations/postgres/000007_wallet_sync.sql",
	"src/superbot_ng/repositories/postgres/wallet/store.py", "src/superbot_ng/workers/wallet/scheduler.py",
	"src/superbot_ng/repositories/postgres/wallet/store_retry_schedule.py", "src/superbot_ng/repositories/postgres/wallet/store_iterations.py",
	"src/superbot_ng/clients/steam/wallet/__init__.py", "tests/contracts/wallet/test_wallet_failure_contracts.py",
	"src/superbot_ng/workers/wallet/daemon.py", "tests/contracts/wallet/test_wallet_backlog_contracts.py",
	"src/superbot_ng/workers/wallet/login_sync.py", "rust/services/wallet_sync/src/lib.rs",
	"src/superbot_ng/repositories/postgres/wallet/store_roster.py", "src/superbot_ng/workers/wallet/fetch_event.py",
	"src/superbot_ng/repositories/postgres/wallet/store_stats_sql.py", "migrations/clickhouse/000013_wallet_daily_two_day_window.sql",
	"rust/services/wallet_sync/src/kafka.rs", "rust/services/wallet_sync/Cargo.toml", "src/superbot_ng/workers/wallet/observer.py",
	"src/superbot_ng/clients/steam/wallet/client.py", "rust/services/wallet_sync/src/store.rs", "src/superbot_ng/entrypoints/wallet/__init__.py",
	"src/superbot_ng/repositories/redis/wallet/cache.py", "rust/services/wallet_sync/src/config.rs",
	"src/superbot_ng/repositories/postgres/wallet/store_stats.py", "src/superbot_ng/workers/wallet/iteration.py", "aWalletSync.py",
	"src/superbot_ng/workers/wallet/pending.py", "migrations/postgres/000012_wallet_due_scheduler.sql",
	"src/superbot_ng/clients/kafka/wallet/__init__.py", "src/superbot_ng/clients/kafka/wallet/payload.py",
	"src/superbot_ng/use_cases/stats/wallet_conversion.py", "src/superbot_ng/entrypoints/wallet/runner.py",
	"src/superbot_ng/workers/wallet/__init__.py",
];
const root012 = await fixtureDir(Object.fromEntries(names012.map((name) => [name, "\n"])));
cases.push({ root: root012, params: { glob_pattern: "**/*wallet*" } });
const captured = [
	{
		name: "captured 004 Glob **/workers/wallet/**",
		root: root004,
		params: { glob_pattern: "**/workers/wallet/**" },
		expected: `Result of search in '.' (total 9 files):\n${names004.map((name) => `- src/superbot_ng/workers/wallet/${name}.py`).join("\n")}\n`,
	},
	{
		// Known difference: the capture lists files under wallet/ folders for this glob, which the bundled rg does not return
		// (Cursor's own executor returns the same 12 files, see the oracle case above). The listing probably came from the IDE's
		// indexed grep provider, which the local executor only uses when the IDE supplies one.
		name: "captured 012 Glob **/*wallet*",
		known: true,
		root: root012,
		params: { glob_pattern: "**/*wallet*" },
		expected: `Result of search in '.' (total 57 files):\n${names012.map((name) => `- ${name}`).join("\n")}\n`,
	},
];

const validation = [
	{ params: { glob_pattern: "" }, expected: { text: 'glob_pattern is empty. Pass "*" to match every file.', isError: true } },
	{ params: { glob_pattern: "/" }, expected: { text: 'glob_pattern is empty. Pass "*" to match every file.', isError: true } },
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

for (const { root, params } of cases) {
	const name = `glob ${JSON.stringify(params)}`;
	const ours = await executeGlob(params, undefined, { cwd: root });
	const expected = await cursorGlob(c, ignoreFor(root), root, params);
	const text = ours.content[0].text;
	const ok = text === expected.text && Boolean(ours.isError) === expected.isError;
	report(name, ok, ok ? "" : `${diff(expected.text, text)}\n  error flag: expected ${expected.isError}, ours ${Boolean(ours.isError)}`);
}

for (const { params, expected } of validation) {
	const ours = await executeGlob(params, undefined, { cwd: main });
	report(`validation ${JSON.stringify(params)}`, ours.content[0].text === expected.text && Boolean(ours.isError) === expected.isError, diff(expected.text, ours.content[0].text));
}

let known = 0;
for (const { name, root, params, expected, known: isKnown } of captured) {
	const ours = await executeGlob(params, undefined, { cwd: root });
	if (isKnown) {
		known++;
		console.log(`known difference ${name}\n${diff(expected, ours.content[0].text)}`);
		continue;
	}
	report(name, ours.content[0].text === expected, diff(expected, ours.content[0].text));
}

console.log(failed === 0 ? `all ${cases.length + validation.length + captured.length - known} checks ok, ${known} known difference(s)` : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
