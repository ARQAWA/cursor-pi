// Feature flags Cursor sends with the GPT-5.5 requests. Only the flags the captured requests prove are on; every other
// flag stays off, so the text it would add is not rendered.
export const CURSOR_FEATURE_FLAGS = {
	// runs-2026-10-16-T4/items/003-S1-user-7b2239a3.txt: the user turn starts with a <timestamp> line.
	userMessageTimestamps: true,
	// runs-2026-10-16-T4/items/002-S1-user-06a7b147.txt: skill paths are written relative to a $0 alias root.
	aliasSkillCatalogPathPrefixes: true,
	// runs-2026-10-16-T4/items/002-S1-user-06a7b147.txt: the user's personal store is listed in user_info.
	agentStorePathsAdvertisedInPrompt: true,
} as const;
