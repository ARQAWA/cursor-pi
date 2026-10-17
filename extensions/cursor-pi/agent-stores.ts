import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Cursor mounts the agent stores from its app support folder. Pi keeps local folders with the same layout instead.
const STORES_ROOT = join(homedir(), ".cursor-pi", "agent-stores", "cursor_agent_stores");

export interface AgentStoreFolders {
	self: string;
	user: string;
}

// The current agent's store is keyed by the Pi session; the user's personal store is shared by every session.
export async function ensureAgentStores(sessionId: string): Promise<AgentStoreFolders> {
	const self = join(STORES_ROOT, sessionId, "files");
	const user = join(STORES_ROOT, "user", "files");
	await mkdir(self, { recursive: true });
	await mkdir(user, { recursive: true });
	return { self, user };
}
