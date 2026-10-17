#!/usr/bin/env bun
// Compares Cursor Pi's ReadFile with Cursor Desktop's own read tool on the same fixtures and arguments.
// Cursor's side is createReadTool with LocalReadExecutor, evaluated from the extracted bundle through
// tools/cursor-oracle.mjs. Both sides must return the same content parts and the same isError flag.
// PDF text: Cursor's extractPdfText is replaced by its own extractPdfTextWorker, so the read formatting is Cursor's.
// Terminal and agent-tool captures: Cursor reads them under .cursor/projects, Cursor Pi under .cursor-pi/projects.
// Usage: bun tools/check-read-file.mjs   (exit 1 on any FAIL)

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { deflateSync } from "node:zlib";
import { createJimp } from "@jimp/core";
import jpeg from "@jimp/js-jpeg";
import { executeReadFile } from "../extensions/cursor-pi/tools/read-file.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

// calls/027-S2-ReadFile.md: the captured result for a missing file.
const CAPTURED_NOT_FOUND = "Error: File not found";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typeBytes = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, crc]);
}

// An 8-bit RGB PNG. rowPixels(y) returns the pixel bytes of row y; only rowCount rows are written, so rowCount below
// height makes a truncated image.
function makePng(width, height, rowCount, rowPixels) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const rows = [];
	for (let y = 0; y < rowCount; y++) rows.push(Buffer.concat([Buffer.from([0]), rowPixels(y)]));
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

const whitePng = (width, height, rowCount = height) => makePng(width, height, rowCount, () => Buffer.alloc(width * 3, 255));

// Pseudo-random pixels, so the PNG stays large after compression.
function noisePng(width, height) {
	let seed = 12345;
	return makePng(width, height, height, () => {
		const row = Buffer.alloc(width * 3);
		for (let i = 0; i < row.length; i++) {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
			row[i] = (seed >>> 16) & 255;
		}
		return row;
	});
}

// A JPEG encoded with the @jimp/js-jpeg version the Cursor bundle embeds.
const jpegEncoder = await createJimp({ formats: [jpeg] });

async function makeJpeg(width, height) {
	const data = Buffer.alloc(width * height * 4);
	for (let p = 0; p < width * height; p++) {
		data[p * 4] = p % width;
		data[p * 4 + 1] = Math.floor(p / width) & 255;
		data[p * 4 + 2] = 128;
		data[p * 4 + 3] = 255;
	}
	return jpegEncoder.fromBitmap({ data, width, height }).getBuffer("image/jpeg");
}

// A WebP lossless header only: the dimensions are what the read path inspects, the image data is never decoded here.
function makeWebpLosslessHeader(width, height) {
	const le32 = (n) => {
		const b = Buffer.alloc(4);
		b.writeUInt32LE(n >>> 0);
		return b;
	};
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	const body = Buffer.concat([Buffer.from([0x2f]), le32(bits)]);
	const chunk = Buffer.concat([Buffer.from("VP8L", "ascii"), le32(body.length), body]);
	return Buffer.concat([Buffer.from("RIFF", "ascii"), le32(4 + chunk.length), Buffer.from("WEBP", "ascii"), chunk]);
}

// A minimal one-page PDF whose page text is the two lines given.
function makePdf(first, second) {
	const stream = `BT /F1 18 Tf 20 100 Td (${first}) Tj 0 -24 Td (${second}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	objects.forEach((body, i) => {
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	return `${out}trailer\n<< /Root 1 0 R >>\n%%EOF\n`;
}

const GIF_1X1 = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const WEBP_1X1 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

const TERMINAL_CAPTURE = "---\npid: 1\n---\nfirst line\nsecond line\n\n---\nexit_code: 0\nended_at: 2026-01-01T00:00:00Z\n---\n";
const AGENT_TOOL_OUTPUT = "tool output\nmore\n";

const NOTEBOOK = JSON.stringify(
	{
		cells: [
			{ cell_type: "markdown", metadata: {}, source: ["# Title\n", "text"] },
			{
				cell_type: "code",
				execution_count: 1,
				metadata: {},
				source: "print(1)\n",
				outputs: [
					{ output_type: "stream", name: "stdout", text: ["1\n"] },
					{ output_type: "error", ename: "E", evalue: "x", traceback: ["\u001b[31mTraceback\u001b[0m", "line"] },
				],
			},
			{
				cell_type: "code",
				execution_count: 2,
				metadata: {},
				source: ["2"],
				outputs: [{ output_type: "execute_result", execution_count: 2, metadata: {}, data: { "text/plain": "2" } }],
			},
		],
		metadata: {},
		nbformat: 4,
		nbformat_minor: 5,
	},
	null,
	1,
);

// "line 1" ... "line N". Cursor counts the text after a final newline as one more line, so the captured-size
// fixtures omit that newline to match the 241- and 301-line totals in the captured calls.
const numbered = (count, endsWithNewline = true) =>
	Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + (endsWithNewline ? "\n" : "");

async function mainFixtures() {
	const brokenSource = await makeJpeg(16, 16);
	return {
		"text.txt": "alpha\nbeta\ngamma\n",
		"no-newline.txt": "alpha\nbeta",
		"crlf.txt": "one\r\ntwo\r\nthree\r\n",
		"bom.txt": "\uFEFFbom line\nsecond\n",
		"utf16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("h\u00e9llo\nw\u00f6rld\n", "utf16le")]),
		"cp1251.txt": Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a, 0xcc, 0xe8, 0xf0, 0x0a]),
		"empty.txt": "",
		"long.txt": numbered(10),
		"captured-241.txt": numbered(241, false),
		"captured-301.txt": numbered(301, false),
		"big.txt": "a".repeat(100_001) + "\n",
		"binary.dat": Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x7f]),
		"archive.zip": "PK\u0003\u0004",
		"pixel.png": whitePng(1, 1),
		"bad-png.png": whitePng(1, 5, 1),
		"big.png": whitePng(1200, 900),
		"noise.png": noisePng(700, 700),
		"pixel.jpg": await makeJpeg(2, 2),
		"big.jpg": await makeJpeg(1200, 900),
		"broken.jpg": brokenSource.subarray(0, 60),
		"pixel.gif": Buffer.from(GIF_1X1, "base64"),
		"pixel.webp": Buffer.from(WEBP_1X1, "base64"),
		"webp-big.webp": makeWebpLosslessHeader(2000, 2000),
		"doc.pdf": makePdf("Hello PDF", "Second line"),
		"broken.pdf": "%PDF-1.4\nnot a real pdf",
		"nb.ipynb": NOTEBOOK,
		"bad.ipynb": "{not json",
		"empty-nb.ipynb": JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
		"invalid-nb.ipynb": JSON.stringify({ cells: [{ cell_type: "nope", source: "" }] }),
		"secret.txt": "hidden\n",
		".cursorignore": "secret.txt\n",
	};
}

// The rule root: a file in a subfolder and a .cursor/rules file with globs that match it.
function rulesFixtures() {
	return {
		"text.txt": "alpha\nbeta\ngamma\n",
		".cursor/rules/ts.mdc": "---\nglobs: *.txt\n---\nUse two spaces.\n",
	};
}

const execFileAsync = promisify(execFile);

// The skills root: a glob-scoped skill at the root and a skill in a subfolder. Cursor's nested skill walk only runs inside a
// git repository, so the root is one.
function skillsFixtures() {
	return {
		"text.txt": "alpha\nbeta\ngamma\n",
		"sub/notes.txt": "nested\n",
		".cursor/skills/ts/SKILL.md": "---\ndescription: Two-space checks.\nglobs: \"*.txt\"\n---\nUse two spaces.\n",
		"sub/.cursor/skills/nested/SKILL.md": "---\ndescription: Nested folder skill.\n---\nNested body.\n",
	};
}

async function writeFixtureTree(files) {
	const base = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-read-")));
	for (const [name, content] of Object.entries(files)) {
		const path = join(base, name);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, content);
	}
	return base;
}

async function makeRoots() {
	const main = await writeFixtureTree(await mainFixtures());
	await mkdir(join(main, "dir"));
	await mkdir(join(main, ".cursor", "projects", "ws1", "terminals"), { recursive: true });
	await mkdir(join(main, ".cursor", "projects", "ws1", "agent-tools"), { recursive: true });
	await mkdir(join(main, ".cursor-pi", "projects", "ws1", "terminals"), { recursive: true });
	await mkdir(join(main, ".cursor-pi", "projects", "ws1", "agent-tools"), { recursive: true });
	for (const tree of [".cursor", ".cursor-pi"]) {
		await writeFile(join(main, tree, "projects", "ws1", "terminals", "12.txt"), TERMINAL_CAPTURE);
		await writeFile(join(main, tree, "projects", "ws1", "agent-tools", "out.txt"), AGENT_TOOL_OUTPUT);
		await writeFile(join(main, tree, "projects", "ws1", "agent-tools", "bin.txt"), whitePng(1, 1));
	}
	const rules = await writeFixtureTree(rulesFixtures());
	const skills = await writeFixtureTree(skillsFixtures());
	await execFileAsync("git", ["init", "-q"], { cwd: skills });
	return { main, rules, skills };
}

// The cases. Arguments are as the model sends them; "@BASE" stands for the case root. A case may name its root
// ("rules" or "skills"), a different path for Cursor Pi (`ours`), the rules and skills Cursor is given (`rules`, `skills`), and whether our text output
// has its .cursor-pi paths shown as .cursor paths (`normalize`).
const CASES = [
	{ name: "full text", args: { path: "text.txt" } },
	{ name: "absolute path", args: { path: "@BASE/text.txt" } },
	{ name: "file URL", args: { path: "file://@BASE/text.txt" } },
	{ name: "no trailing newline", args: { path: "no-newline.txt" } },
	{ name: "CRLF file", args: { path: "crlf.txt" } },
	{ name: "UTF-8 BOM", args: { path: "bom.txt" } },
	{ name: "UTF-16LE with BOM", args: { path: "utf16.txt" } },
	{ name: "windows-1251 detection", args: { path: "cp1251.txt" } },
	{ name: "empty file", args: { path: "empty.txt" } },
	{ name: "offset and limit", args: { path: "long.txt", offset: 3, limit: 2 } },
	{ name: "limit only", args: { path: "long.txt", limit: 4 } },
	{ name: "limit past the end", args: { path: "long.txt", offset: 9, limit: 5 } },
	{ name: "negative offset", args: { path: "long.txt", offset: -3 } },
	{ name: "negative offset and limit", args: { path: "long.txt", offset: -5, limit: 2 } },
	{ name: "negative offset past the start", args: { path: "long.txt", offset: -999 } },
	{ name: "offset 0", args: { path: "long.txt", offset: 0 } },
	{ name: "offset as numeric string", args: { path: "long.txt", offset: "2" } },
	{ name: "offset beyond the end", args: { path: "long.txt", offset: 99 } },
	{ name: "offset float", args: { path: "long.txt", offset: 1.5 } },
	{ name: "limit 0", args: { path: "long.txt", limit: 0 } },
	{ name: "captured 029 offset and limit", args: { path: "captured-241.txt", offset: 45, limit: 40 } },
	{ name: "captured 070 limit", args: { path: "captured-301.txt", limit: 100 } },
	{ name: "over 100000 characters", args: { path: "big.txt" } },
	{ name: "missing file", args: { path: "nope.txt" } },
	{ name: "directory", args: { path: "dir" } },
	{ name: "binary content", args: { path: "binary.dat" } },
	{ name: "unsupported extension", args: { path: "archive.zip" } },
	{ name: "blank path", args: { path: "   " } },
	{ name: "missing path", args: {} },
	{ name: "path not a string", args: { path: 5 } },
	{ name: "PNG", args: { path: "pixel.png" } },
	{ name: "PNG over 1024 px (downscaled)", args: { path: "big.png" } },
	{ name: "PNG over 1 MB (re-encoded)", args: { path: "noise.png" } },
	{ name: "JPEG", args: { path: "pixel.jpg" } },
	{ name: "JPEG over 1024 px (resized)", args: { path: "big.jpg" } },
	{ name: "broken JPEG", args: { path: "broken.jpg" } },
	{ name: "GIF", args: { path: "pixel.gif" } },
	{ name: "WebP within limits", args: { path: "pixel.webp" } },
	{ name: "WebP over the limits", args: { path: "webp-big.webp" } },
	{ name: "truncated PNG", args: { path: "bad-png.png" } },
	{ name: "PDF text", args: { path: "doc.pdf" } },
	{ name: "PDF with a broken body", args: { path: "broken.pdf" } },
	{ name: "notebook", args: { path: "nb.ipynb" } },
	{ name: "notebook with invalid JSON", args: { path: "bad.ipynb" } },
	{ name: "notebook with no cells", args: { path: "empty-nb.ipynb" } },
	{ name: "notebook with invalid schema", args: { path: "invalid-nb.ipynb" } },
	{
		name: "terminal capture",
		args: { path: ".cursor/projects/ws1/terminals/12.txt" },
		ours: { path: ".cursor-pi/projects/ws1/terminals/12.txt" },
	},
	{
		name: "terminal capture with range",
		args: { path: ".cursor/projects/ws1/terminals/12.txt", offset: 2, limit: 1 },
		ours: { path: ".cursor-pi/projects/ws1/terminals/12.txt", offset: 2, limit: 1 },
	},
	{
		name: "agent-tool output",
		args: { path: ".cursor/projects/ws1/agent-tools/out.txt" },
		ours: { path: ".cursor-pi/projects/ws1/agent-tools/out.txt" },
	},
	{
		name: "agent-tool output with binary magic",
		args: { path: ".cursor/projects/ws1/agent-tools/bin.txt" },
		ours: { path: ".cursor-pi/projects/ws1/agent-tools/bin.txt" },
		normalize: true,
	},
	{
		name: "rule reminder for a first read",
		root: "rules",
		args: { path: "text.txt" },
		rules: true,
	},
	{ name: "skill reminder for a glob-scoped skill", root: "skills", args: { path: "text.txt" }, skills: true },
	{ name: "skill reminder for a skill in a nested folder", root: "skills", args: { path: "sub/notes.txt" }, skills: true },
];

// Cursor's rule list for the rules root: the rule as the IDE would give it, with its globs.
function cursorRulesFor(rulesRoot) {
	return [
		{
			fullPath: join(rulesRoot, ".cursor", "rules", "ts.mdc"),
			content: "Use two spaces.\n",
			type: { type: { case: "fileGlobbed", value: { globs: ["*.txt"] } } },
		},
	];
}

// Cursor's agentSkills for the skills root, as Cursor's loader lists the two skills: the glob-scoped one and the one in a
// subfolder.
function cursorSkillsFor(skillsRoot) {
	const skill = (fullPath, description, globs) => ({ fullPath, description, globs, disableModelInvocation: false, environments: [], disabledEnvironments: [], scopedTo: [] });
	return [
		skill(join(skillsRoot, ".cursor", "skills", "ts", "SKILL.md"), "Two-space checks.", ["*.txt"]),
		skill(join(skillsRoot, "sub", ".cursor", "skills", "nested", "SKILL.md"), "Nested folder skill.", []),
	];
}

function substituteBase(args, base) {
	const out = {};
	for (const [key, value] of Object.entries(args)) {
		out[key] = typeof value === "string" ? value.replaceAll("@BASE", base) : value;
	}
	return out;
}

// Same shape on both sides: isError, then content parts with fields in a fixed order.
function normalize(output) {
	return {
		isError: output.isError === true,
		content: output.content.map((part) =>
			part.type === "image"
				? { type: "image", mimeType: part.mimeType, data: part.data }
				: { type: "text", text: part.text },
		),
	};
}

function showingCursorPaths(output) {
	return {
		isError: output.isError,
		content: output.content.map((part) => (part.type === "text" ? { type: "text", text: part.text.replaceAll(".cursor-pi/", ".cursor/") } : part)),
	};
}

// Cursor's session state keeps the unwrapped path string, as its readPaths set does.
function makeStateHandler(cursor) {
	return {
		readPaths: new Set(),
		// The IDE agent type: Cursor's skill environment filter reads it.
		agentType: "ide",
		recordReadPath(path) {
			this.readPaths.add(path.unwrap(cursor.PrivacyCapability.UNSAFE_ALWAYS_ALLOWED));
		},
		getBlobStore() {
			return undefined;
		},
	};
}

async function oursRead(root, args, session) {
	return normalize(await executeReadFile(args, undefined, { cwd: root, sessionManager: session }));
}

// Cursor's createReadTool with its LocalReadExecutor. Permission checks are stubbed to allow, and Cursor's
// .cursorignore path is not run here (see the ours-only case below).
async function cursorRead(cursor, root, args, { cursorRules, cursorSkills, stateHandler }) {
	const ctx = cursor.createContext();
	const executor = new cursor.LocalReadExecutor(
		{ shouldBlockFileRead: async () => false, shouldBlockRead: async () => false },
		root,
		{},
	);
	const tool = cursor.createReadTool({ get: () => executor }, {}, "latest", { enableNegativeOffset: true });
	const handler = {
		emitPartialToolCall() {},
		emitToolCallDelta() {},
		rememberToolCallForArgPreservation() {},
		markToolCallForArgPreservation() {},
		getAbortSignal() {
			return undefined;
		},
		async executeToolCall(callCtx, _toolCall, _toolCallId, run) {
			return run(callCtx);
		},
	};
	const meta = { toolCallId: "call-1", workspacePaths: [root], cursorRules, agentSkills: cursorSkills, stateHandler };
	const argsStream = (async function* () {
		yield JSON.stringify(args);
	})();
	try {
		const result = await tool.execute(ctx, handler, argsStream, meta);
		return normalize(await tool.render(ctx, result, {}));
	} catch (error) {
		const toolCall = tool.serializeError(error);
		return normalize(await tool.render(ctx, toolCall.tool.value.result, {}));
	}
}

let checkCount = 0;

function firstDifference(a, b) {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i;
}

function compare(name, want, got) {
	checkCount++;
	const a = JSON.stringify(want);
	const b = JSON.stringify(got);
	if (a === b) {
		console.log(`ok ${name}`);
		return true;
	}
	const at = firstDifference(a, b);
	console.log(`FAIL ${name}`);
	console.log(`  cursor: ${a.slice(Math.max(0, at - 60), at + 160)}`);
	console.log(`  ours:   ${b.slice(Math.max(0, at - 60), at + 160)}`);
	return false;
}

function report(name, ok, detail) {
	checkCount++;
	console.log(ok ? `ok ${name}` : `FAIL ${name}: ${detail}`);
	return ok;
}

async function runCase(cursor, roots, testCase) {
	const root = testCase.root === "rules" ? roots.rules : testCase.root === "skills" ? roots.skills : roots.main;
	const args = substituteBase(testCase.args, root);
	const oursArgs = substituteBase(testCase.ours ?? testCase.args, root);
	const cursorRules = testCase.rules ? cursorRulesFor(roots.rules) : undefined;
	const cursorSkills = testCase.skills ? cursorSkillsFor(roots.skills) : undefined;
	const want = await cursorRead(cursor, root, args, { cursorRules, cursorSkills, stateHandler: makeStateHandler(cursor) });
	const got = await oursRead(root, oursArgs, {});
	return compare(testCase.name, testCase.normalize ? showingCursorPaths(got) : got, want);
}

async function main() {
	// Skill discovery reads the home folder's skill folders, so HOME points at an empty folder for this check.
	process.env.HOME = await writeFixtureTree({});
	const roots = await makeRoots();
	const cursor = await loadCursor();
	initModule(cursor, "../agent/dist/tools/core/read/read.js");
	initModule(cursor, "../local-exec/dist/read.js");
	// PrivacyCapability, which Cursor's session state uses to unwrap recorded read paths.
	initModule(cursor, "../redaction/dist/privacy-mode.js");
	initModule(cursor, "../agent/dist/tools/core/read/pdf-worker.js");
	// Cursor's extractPdfText starts a worker pool that the oracle cannot run. It is replaced inside the bundle's context
	// with Cursor's own extractPdfTextWorker, and the bundle's pdf.js gets the worker handler of the same 5.4.296 build.
	// pdf.js replaces the host navigator when it loads, which breaks os.availableParallelism for rules.ts; put it back.
	const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	const pdfWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
	if (hostNavigator) Object.defineProperty(globalThis, "navigator", hostNavigator);
	cursor.pdfjsWorker = { WorkerMessageHandler: pdfWorker.WorkerMessageHandler };
	cursor.pdfTextOverride = async (bytes) => (await cursor.extractPdfTextWorker({ bytes })).text;
	vm.runInContext("extractPdfText = pdfTextOverride", cursor);

	let failed = 0;
	for (const testCase of CASES) {
		try {
			if (!(await runCase(cursor, roots, testCase))) failed++;
		} catch (error) {
			console.log(`FAIL ${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
			failed++;
		}
	}

	// Rule reminders are shown on the first read of a file in a session only. Both sides keep one session across reads.
	{
		const state = makeStateHandler(cursor);
		const session = {};
		const cursorFirst = await cursorRead(cursor, roots.rules, { path: "text.txt" }, { cursorRules: cursorRulesFor(roots.rules), stateHandler: state });
		const cursorSecond = await cursorRead(cursor, roots.rules, { path: "text.txt" }, { cursorRules: cursorRulesFor(roots.rules), stateHandler: state });
		const oursFirst = await oursRead(roots.rules, { path: "text.txt" }, session);
		const oursSecond = await oursRead(roots.rules, { path: "text.txt" }, session);
		if (!compare("rule reminder, first read in session", cursorFirst, oursFirst)) failed++;
		if (!compare("rule reminder, repeat read in session", cursorSecond, oursSecond)) failed++;
	}

	// Skill reminders follow the same rule: the first read of a file reminds, a repeat read does not.
	{
		const state = makeStateHandler(cursor);
		const session = {};
		const cursorFirst = await cursorRead(cursor, roots.skills, { path: "text.txt" }, { cursorSkills: cursorSkillsFor(roots.skills), stateHandler: state });
		const cursorSecond = await cursorRead(cursor, roots.skills, { path: "text.txt" }, { cursorSkills: cursorSkillsFor(roots.skills), stateHandler: state });
		const oursFirst = await oursRead(roots.skills, { path: "text.txt" }, session);
		const oursSecond = await oursRead(roots.skills, { path: "text.txt" }, session);
		if (!compare("skill reminder, first read in session", cursorFirst, oursFirst)) failed++;
		if (!compare("skill reminder, repeat read in session", cursorSecond, oursSecond)) failed++;
	}

	// Captured call 027-S2: the missing-file result text.
	const missing = await oursRead(roots.main, { path: "nope.txt" }, {});
	if (!report("captured 027 missing file text", missing.isError && missing.content[0].text === CAPTURED_NOT_FOUND, JSON.stringify(missing))) failed++;

	// Captured call 029-S3: offset 45, limit 40 on a 241-line file gives "44" above and "157" below.
	const cap029 = (await oursRead(roots.main, { path: join(roots.main, "captured-241.txt"), offset: 45, limit: 40 }, {})).content[0].text;
	if (
		!report(
			"captured 029 markers",
			cap029.startsWith("... 44 lines not shown ...\n") && cap029.endsWith("\n... 157 lines not shown ..."),
			JSON.stringify(cap029.slice(0, 80)),
		)
	)
		failed++;

	// Captured call 070-S4: limit 100 on a 301-line file gives "201" below and nothing above.
	const cap070 = (await oursRead(roots.main, { path: join(roots.main, "captured-301.txt"), limit: 100 }, {})).content[0].text;
	if (
		!report(
			"captured 070 markers",
			!cap070.startsWith("...") && cap070.endsWith("\n... 201 lines not shown ..."),
			JSON.stringify(cap070.slice(-80)),
		)
	)
		failed++;

	// .cursorignore: Cursor's ignore service is not run by the oracle, so only our result is checked.
	const ignored = await oursRead(roots.main, { path: join(roots.main, "secret.txt") }, {});
	if (!report("ours-only cursorignore secret.txt", ignored.isError && ignored.content[0].text === "Error: Permission denied", JSON.stringify(ignored))) failed++;

	console.log(failed === 0 ? `all ${checkCount} checks match Cursor` : `${failed} FAIL`);
	process.exit(failed === 0 ? 0 : 1);
}

await main();
