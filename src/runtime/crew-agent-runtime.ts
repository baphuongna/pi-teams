import type { TeamTaskStatus } from "../state/contracts.ts";

export type CrewRuntimeKind = "scaffold" | "child-process" | "live-session";
export type CrewAgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "stopped";

export interface CrewAgentRecentTool {
	tool: string;
	args?: string;
	endedAt: string;
}

export interface CrewAgentProgress {
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartedAt?: string;
	recentTools: CrewAgentRecentTool[];
	recentOutput: string[];
	toolCount: number;
	tokens?: number;
	turns?: number;
	durationMs?: number;
	lastActivityAt?: string;
	activityState?: "active" | "needs_attention" | "stale";
	failedTool?: string;
}

export interface CrewAgentRecord {
	id: string;
	runId: string;
	taskId: string;
	agent: string;
	role: string;
	runtime: CrewRuntimeKind;
	status: CrewAgentStatus;
	startedAt: string;
	completedAt?: string;
	resultArtifactPath?: string;
	transcriptPath?: string;
	statusPath?: string;
	eventsPath?: string;
	outputPath?: string;
	toolUses?: number;
	jsonEvents?: number;
	progress?: CrewAgentProgress;
	error?: string;
}

export function taskStatusToAgentStatus(status: TeamTaskStatus): CrewAgentStatus {
	if (status === "completed") return "completed";
	if (status === "failed") return "failed";
	if (status === "cancelled" || status === "skipped") return "cancelled";
	if (status === "running") return "running";
	return "queued";
}
