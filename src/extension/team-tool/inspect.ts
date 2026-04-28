import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { readEvents } from "../../state/event-log.ts";
import { loadRunManifestById } from "../../state/state-store.ts";
import { aggregateUsage, formatUsage } from "../../state/usage.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { result, type TeamContext } from "./context.ts";

export function handleEvents(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Events requires runId.", { action: "events", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "events", status: "error" }, true);
	const events = readEvents(loaded.manifest.eventsPath);
	const lines = [`Events for ${loaded.manifest.runId}:`, ...(events.length ? events.map((event) => `${event.time} ${event.type}${event.taskId ? ` ${event.taskId}` : ""}${event.message ? `: ${event.message}` : ""}${event.data ? ` ${JSON.stringify(event.data)}` : ""}`) : ["(none)"])];
	return result(lines.join("\n"), { action: "events", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
}

export function handleArtifacts(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Artifacts requires runId.", { action: "artifacts", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "artifacts", status: "error" }, true);
	const lines = [`Artifacts for ${loaded.manifest.runId}:`, ...(loaded.manifest.artifacts.length ? loaded.manifest.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path}${artifact.sizeBytes !== undefined ? ` (${artifact.sizeBytes} bytes)` : ""}${artifact.contentHash ? ` sha256=${artifact.contentHash.slice(0, 12)}` : ""}`) : ["- (none)"])];
	return result(lines.join("\n"), { action: "artifacts", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
}

export function handleSummary(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Summary requires runId.", { action: "summary", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "summary", status: "error" }, true);
	const usage = aggregateUsage(loaded.tasks);
	const lines = [
		`Summary for ${loaded.manifest.runId}`,
		`Status: ${loaded.manifest.status}`,
		`Team: ${loaded.manifest.team}`,
		`Workflow: ${loaded.manifest.workflow ?? "(none)"}`,
		`Goal: ${loaded.manifest.goal}`,
		`Usage: ${formatUsage(usage)}`,
		"Tasks:",
		...loaded.tasks.map((task) => `- ${task.id}: ${task.status} (${task.role} -> ${task.agent})${task.error ? ` - ${task.error}` : ""}`),
	];
	return result(lines.join("\n"), { action: "summary", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
}
