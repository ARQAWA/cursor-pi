// The local file access behind ApplyPatch: Cursor's read and write executors for one workspace, reduced to what an
// ApplyPatch call uses. A read records what it saw, and the write refuses to go on when the file has changed since.
import { createHash } from "node:crypto";
import { realpathSync, constants as fsConstants } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { PatchIO, PatchRead, PatchWrite } from "./edit-flow.ts";
import { MAX_OFS_FILE_SIZE, MAX_TEXT_SIZE, getBufferForWrite, getFormatForFile, readText, readTextStreaming, setFileEncoding } from "./local-encoding.ts";
import type { WriteBlock } from "./local-policy.ts";
import { blockForRead, blockForWrite, resolvePath, resolvePermissionsPath } from "./local-policy.ts";

export interface LocalPatchIOOptions {
	workspace: string;
	approve: (title: string, message: string) => Promise<boolean>;
}

type Fingerprint = { byteLength: number; sha256: string };
type Recorded = { kind: "absent" } | ({ kind: "fingerprint" } & Fingerprint);

const QUOTA_MESSAGE = "Agent-store quota exceeded: this write was rejected because the storage quota is full. Nothing was written; your local copy is intact. Delete or truncate files to free space (including resolved *.conflict* files), then retry. Do not retry the same write without freeing space first.";
const NO_FOLLOW_WRITE_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_CLOEXEC ?? 0);

class SymlinkRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SymlinkRefusedError";
	}
}

export function createLocalPatchIO({ workspace, approve }: LocalPatchIOOptions): PatchIO {
	// What each read saw, keyed by resolved path. A write takes its entry once.
	const recorded = new Map<string, Recorded>();
	return {
		async read(path: string): Promise<PatchRead> {
			const resolvedPath = resolvePath(path, workspace);
			if (await blockForRead(resolvedPath)) {
				recorded.delete(resolvedPath);
				return { kind: "permissionDenied" };
			}
			const fingerprint = await fingerprintFile(resolvedPath).catch(() => undefined);
			const result = await readContent(resolvedPath);
			if (result.kind === "notFound") recorded.set(resolvedPath, { kind: "absent" });
			else if (result.kind === "content" && fingerprint !== undefined) recorded.set(resolvedPath, { kind: "fingerprint", ...fingerprint });
			else recorded.delete(resolvedPath);
			return result;
		},
		async write(path: string, content: string): Promise<PatchWrite> {
			if (isInvalidFileUrl(path)) return { kind: "error", message: `${path} is not a valid file URL. Use an absolute path instead.` };
			const resolvedPath = resolvePath(path, workspace);
			const taken = recorded.get(resolvedPath);
			recorded.delete(resolvedPath);
			await rememberExistingEncoding(resolvedPath);
			const writeTargetPath = (await resolvePermissionsPath(resolvedPath)).resolvedPath;
			const block: WriteBlock | undefined = basename(resolvedPath).toLowerCase() === ".cursorignore" ? { type: "permissionsConfig" } : await blockForWrite(writeTargetPath, workspace);
			if (block?.type === "needsApproval") {
				if (await fileChangedSinceRead(taken, writeTargetPath)) return staleWrite(resolvedPath);
				if (!(await approve("Approve edit", `${block.reason}: ${resolvedPath}`))) return { kind: "rejected", reason: "" };
			} else if (block) {
				return { kind: "permissionDenied", error: deniedMessage(block) };
			}
			const dir = dirname(writeTargetPath);
			if (await directoryRemovedSinceRead(taken, dir)) return staleWrite(resolvedPath);
			try {
				await mkdir(dir, { recursive: true });
			} catch (error) {
				return isPermissionError(error) ? { kind: "permissionDenied", error: "Permission denied" } : { kind: "error", message: messageOf(error) };
			}
			const { buffer } = await getBufferForWrite(resolvedPath, content, workspace);
			if (await fileChangedSinceRead(taken, writeTargetPath)) return staleWrite(resolvedPath);
			try {
				await writeFileNoFollow(writeTargetPath, buffer);
				return { kind: "success" };
			} catch (error) {
				return writeFailure(error);
			}
		},
	};
}

async function readContent(resolvedPath: string): Promise<PatchRead> {
	let stats;
	try {
		stats = await stat(resolvedPath);
	} catch (error) {
		return readFailure(error);
	}
	if (stats.isDirectory()) return { kind: "invalidFile", reason: "Path is a directory, not a file" };
	if (!stats.isFile()) return { kind: "invalidFile", reason: "Path is neither a file nor a directory" };
	try {
		const format = await getFormatForFile(resolvedPath);
		const isPdf = extname(resolvedPath).toLowerCase() === ".pdf";
		// Images, PDFs and videos are returned as data, which an edit rejects as binary.
		if (format.isImageFile || isPdf || (format.isBinaryFile && format.isVideoFile)) return { kind: "binary" };
		if (format.isBinaryFile) return { kind: "invalidFile", reason: "File content is binary data, not text" };
		const streamed = await readTextStreaming(resolvedPath, format);
		setFileEncoding(resolvedPath, streamed.cacheEncoding);
		return { kind: "content", text: streamed.content, truncated: streamed.truncated, fileSize: BigInt(stats.size) };
	} catch (error) {
		return readFailure(error);
	}
}

function readFailure(error: unknown): PatchRead {
	const code = codeOf(error);
	if (code === "ENOENT") return { kind: "notFound" };
	if (code === "EACCES" || code === "EPERM") return { kind: "permissionDenied" };
	return { kind: "error", message: error instanceof Error ? error.message : "Unknown error occurred" };
}

function writeFailure(error: unknown): PatchWrite {
	if (error instanceof SymlinkRefusedError) return { kind: "permissionDenied", error: error.message };
	if (isPermissionError(error)) return { kind: "permissionDenied", error: "Permission denied" };
	if (codeOf(error) === "ENOSPC") return { kind: "noSpace" };
	if (codeOf(error) === "EDQUOT") return { kind: "error", message: QUOTA_MESSAGE };
	return { kind: "error", message: messageOf(error) };
}

function deniedMessage(block: WriteBlock): string {
	switch (block.type) {
		case "cursorIgnore":
			return "Blocked by cursor ignore";
		case "permissionsConfig":
			return "Blocked by permissions configuration";
		case "unsafeResolution":
			return block.message;
		case "needsApproval":
			return block.reason;
	}
}

function staleWrite(resolvedPath: string): PatchWrite {
	return { kind: "error", message: fileChangedAfterReadMessage(resolvedPath) };
}

function fileChangedAfterReadMessage(path: string): string {
	return `${path} changed on disk after this tool call read it. Nothing was written. Read the file again and retry.`;
}

// Cursor's write path reads the existing file first, which also remembers its encoding. Errors there are ignored.
async function rememberExistingEncoding(file: string): Promise<void> {
	try {
		const stats = await stat(file);
		if (stats.size <= MAX_OFS_FILE_SIZE) await readText(file);
	} catch {}
}

async function fileChangedSinceRead(recorded: Recorded | undefined, path: string): Promise<boolean> {
	if (recorded === undefined) return false;
	try {
		if (recorded.kind === "absent") return await pathExists(path);
		const current = await fingerprintFile(path);
		return current === undefined || current.byteLength !== recorded.byteLength || current.sha256 !== recorded.sha256;
	} catch {
		return false;
	}
}

async function directoryRemovedSinceRead(recorded: Recorded | undefined, directory: string): Promise<boolean> {
	if (recorded?.kind !== "fingerprint") return false;
	try {
		return !(await pathExists(directory));
	} catch {
		return false;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isMissingPath(error)) return false;
		throw error;
	}
}

// The size and SHA-256 of a regular file of at most MAX_TEXT_SIZE bytes; undefined for anything else.
async function fingerprintFile(path: string): Promise<Fingerprint | undefined> {
	try {
		const stats = await stat(path);
		if (!stats.isFile() || stats.size > MAX_TEXT_SIZE) return undefined;
		const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
		try {
			const opened = await handle.stat();
			if (!opened.isFile() || opened.size > MAX_TEXT_SIZE) return undefined;
			const hash = createHash("sha256");
			const chunk = Buffer.alloc(64 * 1024);
			let byteLength = 0;
			while (byteLength <= MAX_TEXT_SIZE) {
				const { bytesRead } = await handle.read(chunk, 0, chunk.length, byteLength);
				if (bytesRead === 0) break;
				byteLength += bytesRead;
				hash.update(chunk.subarray(0, bytesRead));
			}
			if (byteLength > MAX_TEXT_SIZE) return undefined;
			return { byteLength, sha256: hash.digest("hex") };
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (isMissingPath(error)) return undefined;
		throw error;
	}
}

// Cursor's writeFileNoFollow: the file is opened without following a symlink, and it is written only when it still
// resolves to the path it was opened under.
async function writeFileNoFollow(canonicalPath: string, data: Buffer): Promise<void> {
	let handle;
	try {
		handle = await open(canonicalPath, NO_FOLLOW_WRITE_FLAGS, 0o666);
	} catch (error) {
		if (isNoFollowRefusal(error)) throw new SymlinkRefusedError(`Refusing to write through a symlink at ${canonicalPath}`);
		throw error;
	}
	try {
		let resolvedNow: string;
		try {
			resolvedNow = realpathSync(canonicalPath);
		} catch {
			throw new SymlinkRefusedError(`Cannot verify canonical path before writing: ${canonicalPath}`);
		}
		if (resolvedNow !== canonicalPath) throw new SymlinkRefusedError(`Refusing write: ${canonicalPath} now resolves through a symlinked parent to ${resolvedNow}`);
		if (!(await handle.stat()).isFile()) throw new SymlinkRefusedError(`Refusing to write to non-regular file at ${canonicalPath}`);
		await handle.truncate(0);
		let offset = 0;
		while (offset < data.length) {
			const { bytesWritten } = await handle.write(data, offset, data.length - offset, offset);
			if (bytesWritten === 0) break;
			offset += bytesWritten;
		}
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function isNoFollowRefusal(error: unknown): boolean {
	const code = codeOf(error);
	if (code === "ELOOP" || code === "EMLINK") return true;
	return code === "EPERM" && typeof fsConstants.O_NOFOLLOW === "number";
}

function isInvalidFileUrl(path: string): boolean {
	if (!path.startsWith("file://")) return false;
	try {
		new URL(path);
		return false;
	} catch {
		return true;
	}
}

function isPermissionError(error: unknown): boolean {
	const code = codeOf(error);
	return code === "EACCES" || code === "EPERM";
}

function isMissingPath(error: unknown): boolean {
	const code = codeOf(error);
	return code === "ENOENT" || code === "ENOTDIR";
}

function codeOf(error: unknown): unknown {
	return (error as { code?: unknown } | undefined)?.code;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
