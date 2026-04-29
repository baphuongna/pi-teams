import * as fs from "node:fs";
import type { TeamRunManifest } from "../state/types.ts";
import { agentOutputPath, readCrewAgents } from "./crew-agent-records.ts";
import type { CrewAgentRecord } from "./crew-agent-runtime.ts";

const TOOL_LABELS: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

export interface TextTailResult {
	path: string;
	text: string;
	bytes: number;
	truncated: boolean;
}

export function readTextTail(filePath: string, maxBytes = 64_000): TextTailResult {
	if (!fs.existsSync(filePath)) return { path: filePath, text: "", bytes: 0, truncated: false };
	const stat = fs.statSync(filePath);
	const bytesToRead = Math.min(stat.size, Math.max(0, maxBytes));
	const fd = fs.openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(bytesToRead);
		fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
		return { path: filePath, text: buffer.toString("utf-8"), bytes: stat.size, truncated: stat.size > bytesToRead };
	} finally {
		fs.closeSync(fd);
	}
}

function compactDuration(ms: number | undefined): string | undefined {
	if (ms === undefined || !Number.isFinite(ms)) return undefined;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function ageBetween(start: string | undefined, end: string | undefined): string | undefined {
	if (!start) return undefined;
	const stop = end ? new Date(end).getTime() : Date.now();
	const ms = Math.max(0, stop - new Date(start).getTime());
	return compactDuration(ms);
}

function activityText(agent: CrewAgentRecord): string {
	const parts: string[] = [];
	if (agent.progress?.activityState) parts.push(agent.progress.activityState);
	if (agent.progress?.currentTool) parts.push(TOOL_LABELS[agent.progress.currentTool] ?? `tool=${agent.progress.currentTool}`);
	if (agent.toolUses !== undefined) parts.push(`tools=${agent.toolUses}`);
	if (agent.progress?.tokens !== undefined) parts.push(`tokens=${agent.progress.tokens}`);
	if (agent.progress?.turns !== undefined) parts.push(`turns=${agent.progress.turns}`);
	const duration = compactDuration(agent.progress?.durationMs) ?? ageBetween(agent.startedAt, agent.completedAt);
	if (duration) parts.push(duration);
	if (agent.progress?.failedTool) parts.push(`failedTool=${agent.progress.failedTool}`);
	if (agent.progress?.recentOutput?.length) parts.push(`last=${agent.progress.recentOutput.at(-1)}`);
	return parts.join(" ") || "idle";
}

function statusGlyph(status: CrewAgentRecord["status"]): string {
	if (status === "completed") return "✓";
	if (status === "failed") return "✗";
	if (status === "running") return "▶";
	if (status === "cancelled" || status === "stopped") return "■";
	return "·";
}

function outputWarning(manifest: TeamRunManifest, agent: CrewAgentRecord): string {
	if (agent.status !== "completed") return "";
	try {
		const outputPath = agentOutputPath(manifest, agent.taskId);
		if (!fs.existsSync(outputPath)) return " no-output";
		return fs.statSync(outputPath).size === 0 ? " no-output" : "";
	} catch {
		return " no-output";
	}
}

function agentLine(manifest: TeamRunManifest, agent: CrewAgentRecord): string {
	return `- ${statusGlyph(agent.status)} ${agent.taskId} ${agent.role} → ${agent.agent} · ${agent.status} · ${agent.runtime} · ${activityText(agent)}${outputWarning(manifest, agent)}${agent.error ? ` · error=${agent.error}` : ""}`;
}

export function buildAgentDashboard(manifest: TeamRunManifest): { text: string; groups: Record<string, CrewAgentRecord[]> } {
	const agents = readCrewAgents(manifest);
	const groups: Record<string, CrewAgentRecord[]> = {
		running: agents.filter((agent) => agent.status === "running"),
		queued: agents.filter((agent) => agent.status === "queued"),
		recent: agents.filter((agent) => agent.status !== "running" && agent.status !== "queued"),
	};
	const lines = [
		`Crew agents for ${manifest.runId}`,
		`Run: ${manifest.status} · ${manifest.team}/${manifest.workflow ?? "none"} · agents=${agents.length}`,
		`Counts: running=${groups.running.length}, queued=${groups.queued.length}, recent=${groups.recent.length}`,
		"",
		"## Running",
		...(groups.running.length ? groups.running.map((agent) => agentLine(manifest, agent)) : ["- (none)"]),
		"",
		"## Queued",
		...(groups.queued.length ? groups.queued.map((agent) => agentLine(manifest, agent)) : ["- (none)"]),
		"",
		"## Recent",
		...(groups.recent.length ? groups.recent.slice(-10).map((agent) => agentLine(manifest, agent)) : ["- (none)"]),
	];
	return { text: lines.join("\n"), groups };
}

export function readAgentOutput(manifest: TeamRunManifest, taskId: string, maxBytes?: number): TextTailResult {
	return readTextTail(agentOutputPath(manifest, taskId), maxBytes);
}
