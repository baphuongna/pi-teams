import type { BeforeAgentStartEvent, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { effectiveAutonomousConfig, loadConfig, type PiTeamsAutonomousConfig } from "../config/config.ts";
import { allAgents, discoverAgents } from "../agents/discover-agents.ts";
import { allTeams, discoverTeams } from "../teams/discover-teams.ts";
import { allWorkflows, discoverWorkflows } from "../workflows/discover-workflows.ts";

const DEFAULT_MAGIC_KEYWORDS: Record<string, string[]> = {
	implementation: ["autoteam", "team:", "implementation-team", "pi-crew", "dùng team", "use team"],
	review: ["review-team", "security review", "code review"],
	fastFix: ["fast-fix", "quick fix"],
	research: ["research-team", "deep research"],
};

const BULLET_OR_NUMBERED_TASK_RE = /^\s*(?:[-*•]|\d+[.)])\s+\S+/;
const ACTIONABLE_TASK_TERMS: readonly string[] = Array.from(new Set([
	"implement",
	"refactor",
	"migrate",
	"fix",
	"add",
	"update",
	"test",
	"review",
	"research",
	"analyze",
	"document",
	"docs",
	"sửa",
	"thêm",
	"cập nhật",
	"kiểm thử",
	"nghiên cứu",
	"phân tích",
	"viết docs",
]));

function mergeMagicKeywords(configured: Record<string, string[]> | undefined): Record<string, string[]> {
	return { ...DEFAULT_MAGIC_KEYWORDS, ...(configured ?? {}) };
}

function actionableLineCount(prompt: string): number {
	return prompt
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => BULLET_OR_NUMBERED_TASK_RE.test(line) && ACTIONABLE_TASK_TERMS.some((term) => line.toLowerCase().includes(term)))
		.length;
}

function hasTaskListSignal(prompt: string): boolean {
	const lower = prompt.toLowerCase();
	const bulletCount = prompt.split(/\r?\n/).filter((line) => BULLET_OR_NUMBERED_TASK_RE.test(line)).length;
	const explicitList = ["các task", "danh sách task", "todo", "tasks sau", "task list", "làm lần lượt"].some((term) => lower.includes(term));
	return bulletCount >= 3 || actionableLineCount(prompt) >= 2 || (explicitList && bulletCount >= 2);
}

export function detectTeamIntent(prompt: string, config: PiTeamsAutonomousConfig = {}): string[] {
	const lower = prompt.toLowerCase();
	const matches: string[] = [];
	for (const [intent, keywords] of Object.entries(mergeMagicKeywords(config.magicKeywords))) {
		if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) matches.push(intent);
	}
	if (hasTaskListSignal(prompt) && !matches.includes("taskList")) matches.push("taskList");
	return matches;
}

export function buildAutonomousPolicy(prompt: string, config: PiTeamsAutonomousConfig = {}): string {
	const effective = effectiveAutonomousConfig(config);
	const intents = detectTeamIntent(prompt, config);
	const asyncGuidance = effective.preferAsyncForLongTasks
		? "For long-running team runs, prefer async: true unless the user needs immediate foreground progress."
		: "Use async: true only when the task is clearly long-running or the user asks for background execution.";
	const worktreeGuidance = effective.allowWorktreeSuggestion === false
		? "Do not suggest worktree mode unless the user explicitly asks for it."
		: "Consider workspaceMode: 'worktree' for parallel or risky code-changing work in clean git repositories.";
	return [
		"# pi-crew Autonomous Delegation Policy",
		"",
		`Autonomy profile: ${effective.profile}.`,
		"You have access to the `team` tool for coordinated multi-agent work. Use it proactively when the task benefits from specialized roles, planning, review, verification, durable artifacts, async execution, or worktree isolation.",
		"",
		"Decision framework (not keyword-only):",
		"- Treat a user-supplied task list with 2+ actionable bullets/numbered items as a delegation candidate even when no pi-crew keyword appears.",
		"- Prefer `team` when tasks span multiple files/subsystems, require sequencing, combine implementation + tests/docs/review, or need independent exploration before edits.",
		"- If unsure whether subtasks conflict, call `team` with action='recommend' first instead of manually splitting work.",
		"- For assisted/aggressive autonomy and non-trivial multi-task work, prefer a team run or plan over direct single-agent execution.",
		"",
		"Use `team` automatically when:",
		"- The task spans multiple files, subsystems, or unclear code areas.",
		"- The prompt contains a non-trivial task list, roadmap, checklist, migration plan, or ordered implementation plan.",
		"- The task requires planning before implementation.",
		"- The task asks for implementation plus tests, review, verification, migration, architecture, security review, or debugging.",
		"- The task would benefit from explorer/planner/executor/reviewer/verifier roles.",
		"",
		"Do not use `team` when:",
		"- The user asks a simple factual question or tiny single-file edit.",
		"- The user explicitly asks you to work directly without delegation.",
		"- The tasks clearly modify the same small file region and can be completed safer by one agent without parallel fanout.",
		"- The action is destructive (`delete`, `forget`, `prune`, forced cleanup) and the user has not explicitly confirmed it.",
		"",
		"Recommended mappings:",
		"- Complex feature/refactor/migration -> action='run', team='implementation'.",
		"- Small bug fix -> action='run', team='fast-fix'.",
		"- Code/security review -> action='run', team='review'.",
		"- Research or documentation synthesis -> action='run', team='research'.",
		"- Unsure which team/workflow to use -> call the `team` tool with action='recommend' and the user's goal, then follow the suggested plan/run call if appropriate.",
		"- After delegating exploration/research/review, do not duplicate the same search manually. Continue only with non-overlapping work.",
		"- Before claiming delegated work is complete, inspect the run with action='status' or action='summary'.",
		"- Unsure or risky work -> action='plan' first, then run the selected team.",
		"",
		"Conflict-safe task splitting:",
		"- Do not parallelize subtasks that may edit the same file, same symbol, same migration path, package manifest, lockfile, or generated schema unless a planner explicitly sequences them.",
		"- For potential overlap, use plan/recommend first, assign one owner per file/symbol, and require workers to report intended changed files before editing.",
		"- Prefer workspaceMode: 'worktree' for parallel implementation in clean git repositories, but still avoid merging overlapping edits without review.",
		"- If workers discover overlap, blockers, missing requirements, or need leader decisions, they must use mailbox/status artifacts to ask the leader/orchestrator and pause risky edits.",
		"- The leader should resolve conflicts by sequencing, narrowing scope, or reassigning ownership before continuing.",
		"",
		asyncGuidance,
		worktreeGuidance,
		intents.length > 0 ? `Detected pi-crew routing signals/intents in the user prompt: ${intents.join(", ")}. Consider the matching team workflow if appropriate.` : "No explicit pi-crew routing signal was detected; decide based on complexity, risk, task-list structure, and conflict potential.",
	].join("\n");
}

function sourcePriority(source: string): number {
	if (source === "project") return 0;
	if (source === "user" || source === "git") return 1;
	return 2;
}

function capLines(lines: string[], maxChars: number): string[] {
	const kept: string[] = [];
	let used = 0;
	for (const line of lines) {
		const next = used + line.length + 1;
		if (next > maxChars) {
			kept.push("- ...resource guidance truncated to stay within prompt budget");
			break;
		}
		kept.push(line);
		used = next;
	}
	return kept;
}

export function buildResourceRoutingGuidance(cwd: string, maxChars = 5000): string {
	const teams = allTeams(discoverTeams(cwd)).sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source)).slice(0, 12);
	const workflows = allWorkflows(discoverWorkflows(cwd)).sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source)).slice(0, 12);
	const agents = allAgents(discoverAgents(cwd)).sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source)).slice(0, 16);
	const lines = [
		"# pi-crew Available Resources",
		"Use project-scoped resources over user/builtin resources when names overlap.",
		"Teams:",
		...(teams.length ? teams.map((team) => `- ${team.name} (${team.source}): ${team.description}; defaultWorkflow=${team.defaultWorkflow ?? "default"}; roles=${team.roles.map((role) => `${role.name}->${role.agent}`).join(", ") || "none"}${team.routing?.triggers?.length ? `; triggers=${team.routing.triggers.join(",")}` : ""}${team.routing?.useWhen?.length ? `; useWhen=${team.routing.useWhen.join(";")}` : ""}`) : ["- (none)"]),
		"Workflows:",
		...(workflows.length ? workflows.map((workflow) => `- ${workflow.name} (${workflow.source}): ${workflow.description}; steps=${workflow.steps.map((step) => `${step.id}:${step.role}`).join(", ") || "none"}`) : ["- (none)"]),
		"Agents:",
		...(agents.length ? agents.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description}${agent.routing?.triggers?.length ? `; triggers=${agent.routing.triggers.join(",")}` : ""}${agent.routing?.useWhen?.length ? `; useWhen=${agent.routing.useWhen.join(";")}` : ""}${agent.routing?.avoidWhen?.length ? `; avoidWhen=${agent.routing.avoidWhen.join(";")}` : ""}${agent.routing?.cost ? `; cost=${agent.routing.cost}` : ""}${agent.routing?.category ? `; category=${agent.routing.category}` : ""}`) : ["- (none)"]),
	];
	return capLines(lines, maxChars).join("\n");
}

export function appendAutonomousPolicy(systemPrompt: string, userPrompt: string, config: PiTeamsAutonomousConfig = {}, cwd?: string): string {
	const resourceGuidance = cwd ? `\n\n${buildResourceRoutingGuidance(cwd)}` : "";
	return `${systemPrompt}\n\n${buildAutonomousPolicy(userPrompt, config)}${resourceGuidance}`;
}

export function registerAutonomousPolicy(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event: BeforeAgentStartEvent) => {
		const options = (event as BeforeAgentStartEvent & { systemPromptOptions?: { cwd?: unknown } }).systemPromptOptions ?? {};
		const cwd = typeof options.cwd === "string" ? options.cwd : undefined;
		const loaded = loadConfig(cwd);
		const autonomous = effectiveAutonomousConfig(loaded.config.autonomous);
		if (!autonomous.enabled) return undefined;
		if (!autonomous.injectPolicy) return undefined;
		return { systemPrompt: appendAutonomousPolicy(event.systemPrompt, event.prompt, autonomous, cwd) };
	});
}
