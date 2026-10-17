// Cursor's UserInfo block for a workspace: user_info, git_status, agent_transcripts, rules and the skills catalog, in
// Cursor's order and with Cursor's text. Sections that need Cursor's account or servers are not rendered.
import { CURSOR_FEATURE_FLAGS } from "./feature-flags.ts";
import { truncateGitStatus } from "./git-status.ts";
import { lineBreakOf, paragraphOf, renderContent, rulesSectionElement, sectionOf, type CursorRule, type PromptElement, type PromptNode } from "./rules.ts";
import { buildAgentSkillsSection, type DiscoveredSkill } from "./skills.ts";

const GIT_STATUS_NOTE =
	"This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.";
const CURSOR_WORKTREE_NOTE = "You are operating in a Cursor worktree, do not edit files outside of it unless explicitly asked to do so by the user.";
const NON_PRIMARY_WORKTREE_NOTE =
	"If editing a git workspace within your current directory, do not search or edit non-primary worktrees unless the user explicitly requests you to do so.";
const HOME_DIR_WORKTREE_NOTE = "This applies especially to Cursor-managed worktrees in ~/.cursor/worktrees.";
const TRANSCRIPT_CITATION =
	"cite parent chat transcripts to the user as [<title for chat <=6 words>](<uuid excluding .jsonl>). Don't discuss the folder structure.";

export interface GitRepoState {
	path: string;
	status?: string;
}

export interface AgentStoreMount {
	kind: "self" | "user";
	path: string;
}

export interface UserInfoProps {
	osVersion: string;
	shell: string;
	workspacePath: string;
	isWorkingDirHomeDir: boolean;
	gitRepos: GitRepoState[];
	todaysDate: string;
	terminalsFolder: string;
	agentTranscriptsFolder: string;
	stores: AgentStoreMount[];
	rules: CursorRule[];
	skills: DiscoveredSkill[];
	// The <dynamic_tool_catalog> section; absent when no dynamic namespace is available.
	dynamicCatalog?: PromptElement;
	// The <available_subagent_types> and <available_subagent_models> sections; the parent's user_info carries them, a child's not.
	subagentCatalog?: string;
}

// Cursor's getFriendlyDateForTimeZone, for example "Friday Oct 16, 2026".
export function friendlyDate(now: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "2-digit", year: "numeric" }).formatToParts(now);
	const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
	return `${lookup.weekday} ${lookup.month} ${Number.parseInt(lookup.day, 10)}, ${lookup.year}`;
}

export function renderUserInfo(props: UserInfoProps): string {
	return renderContent([
		userInfoSection(props),
		gitStatusSection(props.gitRepos),
		agentTranscriptsSection(props.agentTranscriptsFolder),
		rulesSectionElement(props.rules, [props.workspacePath]),
		props.subagentCatalog,
		buildAgentSkillsSection(props.skills, [props.workspacePath], CURSOR_FEATURE_FLAGS.aliasSkillCatalogPathPrefixes),
		props.dynamicCatalog,
	]);
}

function userInfoSection(props: UserInfoProps): PromptElement {
	const hasGitRepos = props.gitRepos.length > 0;
	const knownRepoText = hasGitRepos
		? props.gitRepos.length > 1
			? `at:\n${props.gitRepos.map((repo) => `- ${repo.path}`).join("\n")}`
			: `at ${props.gitRepos[0].path}`
		: "";
	const gitRepoStatusText = hasGitRepos ? `Yes, ${knownRepoText}` : "No";
	const nonPrimaryWarning = !hasGitRepos;
	const workspace = props.workspacePath;
	const workspaceLine: PromptElement = {
		type: "p",
		children: [
			"Workspace Path: ",
			workspace,
			isWorktreesPath(workspace) && [lineBreakOf(), CURSOR_WORKTREE_NOTE],
			nonPrimaryWarning && [lineBreakOf(), NON_PRIMARY_WORKTREE_NOTE],
			nonPrimaryWarning && props.isWorkingDirHomeDir && [lineBreakOf(), HOME_DIR_WORKTREE_NOTE],
		],
	};
	const shownStores = CURSOR_FEATURE_FLAGS.agentStorePathsAdvertisedInPrompt
		? props.stores
		: props.stores.filter((store) => store.kind !== "user");
	return sectionOf("user_info", {}, [
		paragraphOf(`OS Version: ${props.osVersion}`),
		paragraphOf(`Shell: ${props.shell}`),
		workspaceLine,
		paragraphOf(`Is directory a git repo: ${gitRepoStatusText}`),
		paragraphOf(`Today's date: ${props.todaysDate}`),
		paragraphOf(`Terminals folder: ${props.terminalsFolder}`),
		shownStores.length > 0 && storesParagraph(shownStores),
	]);
}

function storesParagraph(stores: AgentStoreMount[]): PromptElement {
	const userStore = stores.find((store) => store.kind === "user");
	return {
		type: "p",
		children: [
			"Available persistent agent stores:",
			lineBreakOf(),
			stores
				.map((store) => `- ${store.kind === "self" ? "Current agent's store" : "User's personal store"}: ${store.path}`)
				.join("\n"),
			lineBreakOf(),
			"Use normal file tools with these absolute paths to read or write store contents. ",
			userStore !== undefined && `When the user says "my user store" or "my personal store," use ${userStore.path}. `,
			"Only use stores listed here; omitted stores are unavailable.",
		],
	};
}

function gitStatusSection(gitRepos: GitRepoState[]): PromptElement | undefined {
	const withStatus = gitRepos.filter((repo) => !!repo.status);
	if (withStatus.length === 0) return undefined;
	const blocks: PromptNode[] = withStatus.map((repo, index) => [
		index > 0 && lineBreakOf(),
		lineBreakOf(),
		paragraphOf(`Git repo: ${repo.path}`),
		wrapInCodeFence(truncateGitStatus(repo.status ?? "")),
	]);
	return sectionOf("git_status", {}, [paragraphOf(GIT_STATUS_NOTE), blocks]);
}

function wrapInCodeFence(status: string): string {
	const trimmed = status.trim();
	return trimmed === "" ? "" : `\`\`\`\n${trimmed}\n\`\`\``;
}

function agentTranscriptsSection(folder: string): PromptElement {
	return sectionOf("agent_transcripts", {}, [
		{
			type: "p",
			children: ["Agent transcripts (past chats) live in ", folder, ". They have names like", " ", "<uuid>", ".jsonl, ", TRANSCRIPT_CITATION],
		},
	]);
}

function isWorktreesPath(path: string): boolean {
	return path.replace(/\\/g, "/").includes(".cursor/worktrees");
}
