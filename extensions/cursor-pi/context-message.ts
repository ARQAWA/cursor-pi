// The context user message Cursor Pi places before the first user message of each conversation: Cursor's UserInfo
// block for the workspace, built from the workspace's rules, git state, skills and local agent stores.
import { resolve } from "node:path";
import { homedir, platform, release } from "node:os";
import { ensureAgentStores } from "./agent-stores.ts";
import { gitRepoPath, gitStatus } from "./git-status.ts";
import { discoverCursorRules } from "./rules.ts";
import { discoverAgentSkills } from "./skills.ts";
import { dynamicToolCatalogSection } from "./dynamic/catalog.ts";
import { dynamicNamespaces } from "./dynamic/namespaces.ts";
import { friendlyDate, renderUserInfo } from "./user-info.ts";
import { resolveTimeZone } from "./user-turn.ts";
import { projectDirFor, terminalsDirFor, transcriptsDirFor } from "./tools/shell/paths.ts";

export interface ContextSource {
	cwd: string;
	sessionId: string;
}

export async function buildContextMessageText(source: ContextSource, now: Date = new Date()): Promise<string> {
	const workspacePath = resolve(source.cwd);
	const projectDir = projectDirFor(workspacePath);
	const [rules, skills, repoPath, stores, namespaces] = await Promise.all([
		discoverCursorRules(workspacePath),
		discoverAgentSkills(workspacePath, homedir()),
		gitRepoPath(workspacePath),
		ensureAgentStores(source.sessionId),
		dynamicNamespaces(workspacePath),
	]);
	const status = repoPath === undefined ? undefined : await gitStatus(repoPath);
	return renderUserInfo({
		osVersion: `${platform()} ${release()}`,
		shell: suggestedShell(),
		workspacePath,
		isWorkingDirHomeDir: workspacePath === resolve(homedir()),
		gitRepos: repoPath === undefined ? [] : [{ path: repoPath, status }],
		todaysDate: friendlyDate(now, resolveTimeZone()),
		terminalsFolder: terminalsDirFor(projectDir),
		agentTranscriptsFolder: transcriptsDirFor(projectDir),
		stores: [
			{ kind: "self", path: stores.self },
			{ kind: "user", path: stores.user },
		],
		rules,
		skills,
		dynamicCatalog: dynamicToolCatalogSection(namespaces),
	});
}

// Cursor reads the shell from the user's login shell. The captures use zsh; other shells fall back to bash, which is
// Cursor's own default when the shell is unknown.
function suggestedShell(): string {
	return (process.env.SHELL ?? "").includes("zsh") ? "zsh" : "bash";
}
