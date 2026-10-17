// A Chrome DevTools Protocol connection over WebSocket. Each page target gets its own connection.
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
type Listener = (method: string, params: any) => void;

export class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Set<Listener>();
	private closed = false;

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => this.receive(String(event.data)));
		socket.addEventListener("close", () => this.fail(new Error("The browser connection closed.")));
	}

	static connect(url: string): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.addEventListener("open", () => resolve(new CdpConnection(socket)), { once: true });
			socket.addEventListener("error", () => reject(new Error(`Could not connect to the browser at ${url}.`)), { once: true });
		});
	}

	get isOpen(): boolean {
		return !this.closed;
	}

	send(method: string, params: Record<string, unknown> = {}): Promise<any> {
		if (this.closed) return Promise.reject(new Error("The browser connection closed."));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// Resolves with the params of the next event with this name; rejects after timeoutMs.
	waitFor(method: string, timeoutMs: number): Promise<any> {
		return new Promise((resolve, reject) => {
			let off: () => void = () => {};
			const timer = setTimeout(() => {
				off();
				reject(new Error(`Timed out waiting for ${method}.`));
			}, timeoutMs);
			off = this.on((name, params) => {
				if (name !== method) return;
				clearTimeout(timer);
				off();
				resolve(params);
			});
		});
	}

	close(): void {
		this.closed = true;
		this.socket.close();
	}

	private receive(text: string): void {
		const message = JSON.parse(text) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
		if (message.id !== undefined) {
			const waiter = this.pending.get(message.id);
			if (waiter === undefined) return;
			this.pending.delete(message.id);
			if (message.error) waiter.reject(new Error(message.error.message));
			else waiter.resolve(message.result);
			return;
		}
		if (message.method === undefined) return;
		for (const listener of [...this.listeners]) listener(message.method, message.params);
	}

	private fail(error: Error): void {
		this.closed = true;
		for (const waiter of this.pending.values()) waiter.reject(error);
		this.pending.clear();
	}
}

// Runs an expression in the page and returns its value. A page exception becomes an Error with its first line as the message.
export async function evaluateInPage<T = unknown>(conn: CdpConnection, expression: string): Promise<T> {
	const result = await conn.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
	if (result.exceptionDetails !== undefined) {
		const details = result.exceptionDetails as { text?: string; exception?: { description?: string } };
		const raw = details.exception?.description ?? details.text ?? "Page script failed.";
		throw new Error(raw.split("\n")[0].replace(/^Error: /, ""));
	}
	return result.result?.value as T;
}
