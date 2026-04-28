import { loadConfig } from "../../config/config.ts";
import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { appendEvent, readEvents } from "../../state/event-log.ts";
import { loadRunManifestById, updateRunStatus } from "../../state/state-store.ts";
import { aggregateUsage, formatUsage } from "../../state/usage.ts";
import { applyAttentionState, formatActivityAge, resolveCrewControlConfig } from "../../runtime/agent-control.ts";
import { readCrewAgents } from "../../runtime/crew-agent-records.ts";
import { checkProcessLiveness, isActiveRunStatus } from "../../runtime/process-status.ts";
import { formatTaskGraphLines, waitingReason } from "../../runtime/task-display.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { result, type TeamContext } from "./context.ts";

export function handleStatus(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Status requires runId.", { action: "status", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "status", status: "error" }, true);
	let { manifest, tasks } = loaded;
	let asyncLivenessLine: string | undefined;
	if (manifest.async) {
		const asyncState = manifest.async;
		const liveness = checkProcessLiveness(asyncState.pid);
		asyncLivenessLine = `Async: pid=${asyncState.pid ?? "unknown"} alive=${liveness.alive ? "true" : "false"} detail=${liveness.detail} log=${asyncState.logPath} spawnedAt=${asyncState.spawnedAt}`;
		if (!liveness.alive && isActiveRunStatus(manifest.status)) {
			manifest = updateRunStatus(manifest, "failed", `Async process stale: ${liveness.detail}`);
			appendEvent(manifest.eventsPath, { type: "async.stale", runId: manifest.runId, message: liveness.detail, data: { pid: asyncState.pid } });
		}
	}
	const counts = new Map<string, number>();
	for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
	const events = readEvents(manifest.eventsPath).slice(-8);
	const controlConfig = resolveCrewControlConfig(loadConfig(ctx.cwd).config);
	const crewAgents = readCrewAgents(manifest).map((agent) => applyAttentionState(manifest, agent, controlConfig));
	const artifactLines = manifest.artifacts.slice(-10).map((artifact) => `- ${artifact.kind}: ${artifact.path}${artifact.sizeBytes !== undefined ? ` (${artifact.sizeBytes} bytes)` : ""}`);
	const totalUsage = aggregateUsage(tasks);
	const activeAgents = crewAgents.filter((agent) => agent.status === "running");
	const completedAgents = crewAgents.filter((agent) => agent.status !== "running");
	const waitingTasks = tasks.filter((task) => task.status === "queued");
	const agentLine = (agent: typeof crewAgents[number]): string => `- ${agent.id} [${agent.status}] ${agent.role} -> ${agent.agent} runtime=${agent.runtime}${agent.model ? ` model=${agent.model}` : ""}${agent.usage ? ` usage=${formatUsage(agent.usage)}` : ""}${agent.progress?.activityState === "needs_attention" ? " needs_attention" : ""}${formatActivityAge(agent) ? ` activity=${formatActivityAge(agent)}` : ""}${agent.progress?.currentTool ? ` tool=${agent.progress.currentTool}` : ""}${agent.toolUses ? ` tools=${agent.toolUses}` : ""}${!agent.usage && agent.progress?.tokens ? ` tokens=${agent.progress.tokens}` : ""}${agent.progress?.turns ? ` turns=${agent.progress.turns}` : ""}${agent.jsonEvents !== undefined ? ` jsonEvents=${agent.jsonEvents}` : ""}${agent.statusPath ? ` status=${agent.statusPath}` : ""}${agent.error ? ` error=${agent.error}` : ""}`;
	const lines = [
		`Run: ${manifest.runId}`,
		`Team: ${manifest.team}`,
		`Workflow: ${manifest.workflow ?? "(none)"}`,
		`Status: ${manifest.status}`,
		`Workspace mode: ${manifest.workspaceMode}`,
		`Goal: ${manifest.goal}`,
		`Created: ${manifest.createdAt}`,
		`Updated: ${manifest.updatedAt}`,
		`State: ${manifest.stateRoot}`,
		`Artifacts: ${manifest.artifactsRoot}`,
		...(asyncLivenessLine ? [asyncLivenessLine] : []),
		"Task graph:",
		...formatTaskGraphLines(tasks),
		"Tasks:",
		...(tasks.length ? tasks.map((task) => `- ${task.id} [${task.status}] ${task.role} -> ${task.agent}${task.taskPacket ? ` scope=${task.taskPacket.scope}` : ""}${task.verification ? ` green=${task.verification.observedGreenLevel}/${task.verification.requiredGreenLevel}` : ""}${task.modelAttempts?.length ? ` attempts=${task.modelAttempts.length}` : ""}${task.modelRouting ? ` modelRouting=${task.modelRouting.requested ? `${task.modelRouting.requested}->` : ""}${task.modelRouting.resolved}${task.modelRouting.usedAttempt ? ` attempt=${task.modelRouting.usedAttempt + 1}` : ""}` : ""}${task.jsonEvents !== undefined ? ` jsonEvents=${task.jsonEvents}` : ""}${task.usage ? ` usage=${JSON.stringify(task.usage)}` : ""}${task.worktree ? ` worktree=${task.worktree.path}` : ""}${task.error ? ` error=${task.error}` : ""}`) : ["- (none)"]),
		`Task counts: ${[...counts.entries()].map(([status, count]) => `${status}=${count}`).join(", ") || "none"}`,
		"Active agents:",
		...(activeAgents.length ? activeAgents.map(agentLine) : ["- (none)"]),
		"Waiting tasks:",
		...(waitingTasks.length ? waitingTasks.map((task) => `- ${task.id} [queued] ${task.role} -> ${task.agent} ${waitingReason(task, tasks) ?? "waiting"}`) : ["- (none)"]),
		"Completed agents:",
		...(completedAgents.length ? completedAgents.map(agentLine) : ["- (none)"]),
		"Policy decisions:",
		...(manifest.policyDecisions?.length ? manifest.policyDecisions.map((item) => `- ${item.action} (${item.reason})${item.taskId ? ` ${item.taskId}` : ""}: ${item.message}`) : ["- (none)"]),
		`Total usage: ${formatUsage(totalUsage)}`,
		"",
		"Recent artifacts:",
		...(artifactLines.length ? artifactLines : ["- (none)"]),
		"",
		"Recent events:",
		...(events.length ? events.map((event) => `- ${event.time} ${event.type}${event.taskId ? ` ${event.taskId}` : ""}${event.message ? `: ${event.message}` : ""}`) : ["- (none)"]),
	];
	return result(lines.join("\n"), { action: "status", status: "ok", runId: manifest.runId, artifactsRoot: manifest.artifactsRoot });
}
