import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { editDescription } from "@oh-my-pi/pi-natives";
import { resolve } from "node:path";

type NativeResult = { content: { type: string; text?: string }[]; details?: unknown; isError?: boolean };

const fileLocks = Symbol.for("my-omp-harness.fileLocks");
const lockStore = globalThis as unknown as Record<symbol, Set<string> | undefined>;
const inFlight = (lockStore[fileLocks] ??= new Set<string>());

function lockKey(path: string, cwd: string): string {
	if (path.includes("://")) return path;
	const absolute = resolve(cwd, path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
	const content =
		typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
			? result.content
			: [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			return block.text.split("\n")[0] ?? "";
		}
	}
	return "";
}

type PatchSection = {
	path: string;
	kind: "add" | "delete" | "update";
	lines: string[];
	move: boolean;
	hunks: string[][];
};
type Rejection = { index: number; total: number; text: string; lines: string[] };
type PatchRun = {
	path: string;
	status: "edited" | "partial" | "failed" | "busy";
	applied: number;
	total: number;
	results: NativeResult[];
	appliedHunks: number[];
	rejections: Rejection[];
	failure?: string;
};

/** Splits a `*** Begin Patch` envelope into file sections; undefined when the input cannot be split. */
function parsePatch(input: string): PatchSection[] | undefined {
	const lines = input.split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return undefined;
	const sections: PatchSection[] = [];
	let current: PatchSection | undefined;
	let hunkStarted = false;
	for (const line of lines.slice(1, -1)) {
		const header = /^\*\*\* (Add|Delete|Update) File: (.*)$/.exec(line);
		if (header) {
			current = {
				path: header[2]!,
				kind: header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update",
				lines: [line],
				move: false,
				hunks: [],
			};
			sections.push(current);
			hunkStarted = false;
			continue;
		}
		if (!current) return undefined;
		if (line.startsWith("*** Move to: ")) {
			if (current.kind !== "update" || current.lines.length !== 1) return undefined;
			current.move = true;
			current.lines.push(line);
			continue;
		}
		if (line.startsWith("*** ") && line !== "*** End of File") return undefined;
		current.lines.push(line);
		if (current.hunks.length === 0) current.hunks.push([]);
		if (line.startsWith("@@")) {
			if (hunkStarted) current.hunks.push([]);
			hunkStarted = true;
		}
		current.hunks.at(-1)!.push(line);
	}
	return sections.length > 0 ? sections : undefined;
}

/** Number of hunks a section counts for: 1 for Add, Delete and Update with Move. */
function hunkCount(section: PatchSection): number {
	return section.kind === "update" && !section.move ? Math.max(1, section.hunks.length) : 1;
}

function textOf(result: NativeResult): string {
	return result.content.flatMap(part => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

function diffOf(result: NativeResult): string {
	const details = result.details;
	return typeof details === "object" && details !== null && "diff" in details && typeof details.diff === "string" ? details.diff : "";
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;
	const editParameters = z.object({ input: z.string() });

	pi.on("session_start", async () => {
		try {
			lookup("edit.mode")?.override(pi.pi.settings, "apply_patch");
			lookup("edit.modelVariants")?.override(pi.pi.settings, {});
		} catch {}
	});

	pi.registerTool({
		name: "edit",
		label: "edit",
		loadMode: "essential",
		approval: "write",
		get description() {
			return "Read each existing target file before patching it; creating a new file does not require a prior read. " + editDescription("apply_patch")
				.replace("Edit files: `apply_patch` shell command.", "Call apply_patch with one mass patch in its JSON input string.")
				.replace("file references relative, NEVER absolute.", "Use absolute native file paths in every patch file header.");
		},
		get parameters() {
			return editParameters;
		},
		customWireName: "apply_patch",
		concurrency: (args: { input?: unknown } | undefined) => (typeof args?.input === "string" ? "exclusive" : "shared"),
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			const params = rawParams as { input: string };
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "edit is not available to this agent." }],
					isError: true,
				};
			}
			const sections = parsePatch(params.input);
			if (!sections) return ctx.invokeTool!({ input: params.input }, { signal, onUpdate });

			const callNative = async (input: string): Promise<{ result?: NativeResult; error?: string }> => {
				try {
					const result = (await ctx.invokeTool!({ input }, { signal, onUpdate })) as NativeResult;
					return result.isError ? { result, error: textOf(result) } : { result };
				} catch (error) {
					return { error: error instanceof Error ? error.message : String(error) };
				}
			};

			const applyGroup = async (key: string, group: PatchSection[]): Promise<PatchRun> => {
				const path = group[0]!.path;
				const total = group.reduce((sum, section) => sum + hunkCount(section), 0);
				if (inFlight.has(key)) return { path, status: "busy", applied: 0, total, results: [], appliedHunks: [], rejections: [] };
				inFlight.add(key);
				try {
					const whole = await callNative(`*** Begin Patch\n${group.flatMap(section => section.lines).join("\n")}\n*** End Patch`);
					if (whole.result && whole.error === undefined) {
						return { path, status: "edited", applied: total, total, results: [whole.result], appliedHunks: [], rejections: [] };
					}
					const hunks = group.every(section => section.kind === "update" && !section.move)
						? group.flatMap(section => section.hunks.map(lines => ({ path: section.path, lines })))
						: [];
					if (hunks.length < 2 || hunks.length !== total) {
						return { path, status: "failed", applied: 0, total, results: [], appliedHunks: [], rejections: [], failure: whole.error ?? "" };
					}
					const results: NativeResult[] = [];
					const appliedHunks: number[] = [];
					const rejections: Rejection[] = [];
					for (const [index, hunk] of hunks.entries()) {
						const outcome = await callNative(`*** Begin Patch\n*** Update File: ${hunk.path}\n${hunk.lines.join("\n")}\n*** End Patch`);
						if (outcome.result && outcome.error === undefined) {
							results.push(outcome.result);
							appliedHunks.push(index + 1);
						} else {
							rejections.push({ index: index + 1, total, text: outcome.error ?? "", lines: hunk.lines });
						}
					}
					const status = rejections.length === 0 ? "edited" : appliedHunks.length > 0 ? "partial" : "failed";
					return { path, status, applied: appliedHunks.length, total, results, appliedHunks, rejections };
				} finally {
					inFlight.delete(key);
				}
			};

			const patchGroups = new Map<string, PatchSection[]>();
			for (const section of sections) {
				const key = lockKey(section.path, ctx.cwd);
				patchGroups.set(key, [...(patchGroups.get(key) ?? []), section]);
			}
			const patchRuns = await Promise.all([...patchGroups].map(([key, group]) => applyGroup(key, group)));

			const out: string[] = [];
			for (const run of patchRuns) {
				if (run.status === "busy") {
					out.push(`Busy, not edited (another write or edit of this file is in progress): ${run.path}`);
					continue;
				}
				if (run.status === "edited") out.push(`Applied: ${run.path} (${run.total} hunk(s))`);
				if (run.status === "partial") out.push(`Applied: ${run.path} (hunks ${run.appliedHunks.join(", ")} of ${run.total})`);
				for (const result of run.results) {
					const text = textOf(result);
					if (text) out.push(text.split("\n").map(line => `  ${line}`).join("\n"));
				}
				for (const rejection of run.rejections) {
					out.push(`Rejected: ${run.path}, hunk ${rejection.index} of ${rejection.total}:`, rejection.text);
				}
				if (run.status === "failed" && run.rejections.length === 0) out.push(`Rejected: ${run.path}: ${run.failure || "failed"}`);
			}
			const applied = patchRuns.reduce((sum, run) => sum + run.applied, 0);
			const total = patchRuns.reduce((sum, run) => sum + run.total, 0);
			if (total > applied) out.push(`Applied ${applied} of ${total} hunks; rejected ${total - applied}.`);

			return {
				content: [{ type: "text" as const, text: out.join("\n") }],
				details: {
					diff: patchRuns.flatMap(run => run.results.map(result => diffOf(result))).filter(Boolean).join("\n"),
					perFileResults: patchRuns.map(run => ({
						path: run.path,
						diff: run.results.map(result => diffOf(result)).filter(Boolean).join("\n"),
						isError: run.status !== "edited",
					})),
					files: patchRuns.map(run => ({
						path: run.path,
						status: run.status,
						applied: run.applied,
						total: run.total,
						...(run.status === "partial" || run.status === "failed"
							? { message: (run.rejections[0]?.text ?? run.failure ?? "").split("\n")[0] || "failed" }
							: {}),
					})),
				},
				isError: patchRuns.some(run => run.status !== "edited"),
			};
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["edit"];
			return host ? (host.renderCall(...args) as Component) : new Text("edit", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["edit"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
