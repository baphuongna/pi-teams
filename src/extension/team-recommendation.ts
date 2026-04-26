import { detectTeamIntent } from "./autonomous-policy.ts";
import type { AgentConfig } from "../agents/agent-config.ts";
import type { TeamConfig } from "../teams/team-config.ts";
import type { PiTeamsAutonomousConfig } from "../config/config.ts";

export type DecompositionStrategy = "numbered" | "bulleted" | "conjunction" | "atomic";

export interface RecommendedSubtask {
	subject: string;
	description: string;
	role: string;
}

export interface TeamRecommendation {
	team: "default" | "implementation" | "review" | "fast-fix" | "research";
	workflow: "default" | "implementation" | "review" | "fast-fix" | "research";
	action: "plan" | "run";
	async: boolean;
	workspaceMode: "single" | "worktree";
	confidence: "low" | "medium" | "high";
	decomposition: { strategy: DecompositionStrategy; subtasks: RecommendedSubtask[]; fanout: number };
	reasons: string[];
}

const REVIEW_TERMS = ["review", "audit", "security", "vulnerability", "diff", "pr", "pull request"];
const RESEARCH_TERMS = ["research", "investigate", "compare", "analyze", "document", "docs", "explain", "architecture"];
const FAST_FIX_TERMS = ["quick fix", "fast-fix", "small bug", "typo", "one-line", "minor", "lint"];
const IMPLEMENTATION_TERMS = ["implement", "refactor", "migrate", "feature", "tests", "test", "integration", "upgrade", "build", "create", "add"];
const RISKY_TERMS = ["migration", "refactor", "large", "multiple", "parallel", "concurrent", "risky", "critical"];
const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+(.+)$/;
const BULLETED_LINE_RE = /^\s*[-*•]\s+(.+)$/;
const CONJUNCTION_SPLIT_RE = /\s+(?:and|,\s*and|,)\s+/i;
const FILE_REF_RE = /\b\S+\.\w{1,8}\b/g;
const CODE_SYMBOL_RE = /`[^`]+`/g;

function includesAny(text: string, terms: string[]): string[] {
	return terms.filter((term) => text.includes(term));
}

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function recommendRole(text: string): string {
	const lower = text.toLowerCase();
	if (includesAny(lower, ["test", "spec", "coverage", "verify"]).length > 0) return "test-engineer";
	if (includesAny(lower, ["security", "vulnerability", "auth", "owasp"]).length > 0) return "security-reviewer";
	if (includesAny(lower, ["review", "audit", "diff"]).length > 0) return "reviewer";
	if (includesAny(lower, ["doc", "readme", "guide", "write"]).length > 0) return "writer";
	if (includesAny(lower, ["research", "investigate", "explore", "find", "trace"]).length > 0) return "explorer";
	if (includesAny(lower, ["plan", "design", "architecture"]).length > 0) return "planner";
	return "executor";
}

function makeSubtask(text: string): RecommendedSubtask {
	const subject = text.trim().slice(0, 80) || "Task";
	return { subject, description: text.trim(), role: recommendRole(text) };
}

export function decomposeGoal(goal: string): { strategy: DecompositionStrategy; subtasks: RecommendedSubtask[]; fanout: number } {
	const lines = goal.split("\n").map((line) => line.trim()).filter(Boolean);
	const fileRefs = goal.match(FILE_REF_RE)?.length ?? 0;
	const codeSymbols = goal.match(CODE_SYMBOL_RE)?.length ?? 0;
	const hasParallelKeyword = /\b(?:parallel|concurrently|simultaneously|independently)\b/i.test(goal);
	if (fileRefs >= 3 || codeSymbols >= 3 || hasParallelKeyword) {
		const subtask = makeSubtask(goal);
		return { strategy: "atomic", subtasks: [subtask], fanout: 1 };
	}
	if (lines.length >= 2 && lines.every((line) => NUMBERED_LINE_RE.test(line))) {
		const subtasks = lines.map((line) => makeSubtask(line.match(NUMBERED_LINE_RE)?.[1] ?? line));
		return { strategy: "numbered", subtasks, fanout: subtasks.length };
	}
	if (lines.length >= 2 && lines.every((line) => BULLETED_LINE_RE.test(line))) {
		const subtasks = lines.map((line) => makeSubtask(line.match(BULLETED_LINE_RE)?.[1] ?? line));
		return { strategy: "bulleted", subtasks, fanout: subtasks.length };
	}
	if (lines.length === 1) {
		const parts = lines[0].split(CONJUNCTION_SPLIT_RE).map((part) => part.trim()).filter(Boolean);
		if (parts.length >= 2) {
			const subtasks = parts.map((part) => makeSubtask(part));
			return { strategy: "conjunction", subtasks, fanout: subtasks.length };
		}
	}
	const subtask = makeSubtask(goal);
	return { strategy: "atomic", subtasks: [subtask], fanout: 1 };
}

function metadataMatches(goal: string, values: string[] | undefined): string[] {
	const lower = goal.toLowerCase();
	return (values ?? []).filter((value) => lower.includes(value.toLowerCase()));
}

export function recommendTeam(goal: string, config: PiTeamsAutonomousConfig = {}, resources?: { teams?: TeamConfig[]; agents?: AgentConfig[] }): TeamRecommendation {
	const normalized = goal.toLowerCase();
	const intents = detectTeamIntent(goal, config);
	const reasons: string[] = [];
	let team: TeamRecommendation["team"] = "default";
	let workflow: TeamRecommendation["workflow"] = "default";
	let action: TeamRecommendation["action"] = "run";
	let confidence: TeamRecommendation["confidence"] = "medium";

	if (intents.length > 0) reasons.push(`Matched explicit intent keyword(s): ${intents.join(", ")}.`);

	const metadataTeamMatches = (resources?.teams ?? [])
		.map((candidate) => ({ team: candidate, matches: [...metadataMatches(goal, candidate.routing?.triggers), ...metadataMatches(goal, candidate.routing?.useWhen)] }))
		.filter((candidate) => candidate.matches.length > 0)
		.sort((a, b) => b.matches.length - a.matches.length);

	const reviewMatches = includesAny(normalized, REVIEW_TERMS);
	const researchMatches = includesAny(normalized, RESEARCH_TERMS);
	const fastFixMatches = includesAny(normalized, FAST_FIX_TERMS);
	const implementationMatches = includesAny(normalized, IMPLEMENTATION_TERMS);
	const riskyMatches = includesAny(normalized, RISKY_TERMS);

	if (metadataTeamMatches[0]) {
		team = metadataTeamMatches[0].team.name as TeamRecommendation["team"];
		workflow = (metadataTeamMatches[0].team.defaultWorkflow ?? metadataTeamMatches[0].team.name) as TeamRecommendation["workflow"];
		confidence = "high";
		reasons.push(`Matched team routing metadata for '${metadataTeamMatches[0].team.name}': ${metadataTeamMatches[0].matches.join(", ")}.`);
	} else if (intents.includes("review") || reviewMatches.length >= 2 || normalized.includes("security review")) {
		team = "review";
		workflow = "review";
		confidence = "high";
		reasons.push(`Review/audit terms detected: ${reviewMatches.join(", ") || "explicit review intent"}.`);
	} else if (intents.includes("research") || (researchMatches.length > 0 && implementationMatches.length === 0)) {
		team = "research";
		workflow = "research";
		confidence = researchMatches.length >= 2 ? "high" : "medium";
		reasons.push(`Research/analysis terms detected: ${researchMatches.join(", ")}.`);
	} else if (intents.includes("fastFix") || fastFixMatches.length > 0) {
		team = "fast-fix";
		workflow = "fast-fix";
		confidence = "high";
		reasons.push(`Small fix terms detected: ${fastFixMatches.join(", ") || "fast-fix intent"}.`);
	} else if (intents.includes("implementation") || implementationMatches.length > 0) {
		team = "implementation";
		workflow = "implementation";
		confidence = implementationMatches.length >= 2 || riskyMatches.length > 0 ? "high" : "medium";
		reasons.push(`Implementation terms detected: ${implementationMatches.join(", ") || "implementation intent"}.`);
	} else {
		action = "plan";
		confidence = wordCount(goal) < 8 ? "low" : "medium";
		reasons.push("No strong team-specific intent detected; start with planning/default discovery.");
	}

	const decomposition = decomposeGoal(goal);
	if (decomposition.strategy !== "atomic") reasons.push(`Goal decomposes into ${decomposition.subtasks.length} subtasks using ${decomposition.strategy} parsing.`);
	const async = config.preferAsyncForLongTasks === true && (wordCount(goal) > 24 || riskyMatches.length > 0 || implementationMatches.length >= 2 || decomposition.fanout >= 3);
	const workspaceMode = config.allowWorktreeSuggestion === false ? "single" : (riskyMatches.length > 0 && team === "implementation" ? "worktree" : "single");
	if (async) reasons.push("Task appears long/risky and config prefers async for long tasks.");
	if (workspaceMode === "worktree") reasons.push(`Risk/isolation terms detected: ${riskyMatches.join(", ")}.`);

	return { team, workflow, action, async, workspaceMode, confidence, decomposition, reasons };
}

export function formatRecommendation(goal: string, recommendation: TeamRecommendation): string {
	return [
		"pi-teams recommendation:",
		`Goal: ${goal}`,
		`Action: ${recommendation.action}`,
		`Team: ${recommendation.team}`,
		`Workflow: ${recommendation.workflow}`,
		`Async: ${recommendation.async}`,
		`Workspace mode: ${recommendation.workspaceMode}`,
		`Confidence: ${recommendation.confidence}`,
		`Decomposition: ${recommendation.decomposition.strategy} (${recommendation.decomposition.fanout} lane${recommendation.decomposition.fanout === 1 ? "" : "s"})`,
		"Subtasks:",
		...recommendation.decomposition.subtasks.map((task, index) => `- ${index + 1}. [${task.role}] ${task.subject}`),
		"Reasons:",
		...recommendation.reasons.map((reason) => `- ${reason}`),
		"Suggested tool call:",
		JSON.stringify({ action: recommendation.action, team: recommendation.team, workflow: recommendation.workflow, goal, async: recommendation.async, workspaceMode: recommendation.workspaceMode }, null, 2),
	].join("\n");
}
