// Cursor's per-path file lock (FileOperationLockManager.waitForLock), shared by the tools that change files. A call waits for
// the calls before it on the same path, so their reads and writes never interleave. Keys are the path as the model wrote it,
// as Cursor keys them.
const queues = new Map<string, Promise<void>>();

export async function withFileLock<T>(path: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
	if (signal?.aborted) throw new Error("Aborted");
	const previous = queues.get(path) ?? Promise.resolve();
	let release = (): void => undefined;
	const current = new Promise<void>((resolve) => {
		release = () => resolve();
	});
	const tail = previous.then(() => current);
	queues.set(path, tail);
	await previous;
	try {
		if (signal?.aborted) throw new Error("Aborted");
		return await run();
	} finally {
		release();
		if (queues.get(path) === tail) queues.delete(path);
	}
}
