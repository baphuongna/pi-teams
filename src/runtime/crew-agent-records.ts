import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { atomicWriteJson, readJsonFile } from "../state/atomic-write.ts";
import type { CrewAgentProgress, CrewAgentRecord, CrewRuntimeKind } from "./crew-agent-runtime.ts";
import { taskStatusToAgentStatus } from "./crew-agent-runtime.ts";

export function agentsPath(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "agents.json");
}

export function agentStateDir(manifest: TeamRunManifest, taskId: string): string {
	return path.join(manifest.stateRoot, "agents", taskId);
}

export function agentStatusPath(manifest: TeamRunManifest, taskId: string): string {
	return path.join(agentStateDir(manifest, taskId), "status.json");
}

export function agentEventsPath(manifest: TeamRunManifest, taskId: string): string {
	return path.join(agentStateDir(manifest, taskId), "events.jsonl");
}

export function agentOutputPath(manifest: TeamRunManifest, taskId: string): string {
	return path.join(agentStateDir(manifest, taskId), "output.log");
}

export function readCrewAgents(manifest: TeamRunManifest): CrewAgentRecord[] {
	return readJsonFile<CrewAgentRecord[]>(agentsPath(manifest)) ?? [];
}

export function saveCrewAgents(manifest: TeamRunManifest, records: CrewAgentRecord[]): void {
	fs.mkdirSync(manifest.stateRoot, { recursive: true });
	atomicWriteJson(agentsPath(manifest), records);
	for (const record of records) writeCrewAgentStatus(manifest, record);
}

export function upsertCrewAgent(manifest: TeamRunManifest, record: CrewAgentRecord): void {
	const records = readCrewAgents(manifest).filter((item) => item.id !== record.id);
	records.push(record);
	saveCrewAgents(manifest, records);
	writeCrewAgentStatus(manifest, record);
}

export function writeCrewAgentStatus(manifest: TeamRunManifest, record: CrewAgentRecord): void {
	fs.mkdirSync(agentStateDir(manifest, record.taskId), { recursive: true });
	atomicWriteJson(agentStatusPath(manifest, record.taskId), record);
}

export function readCrewAgentStatus(manifest: TeamRunManifest, taskOrAgentId: string): CrewAgentRecord | undefined {
	const taskId = taskOrAgentId.includes(":") ? taskOrAgentId.split(":").pop()! : taskOrAgentId;
	return readJsonFile<CrewAgentRecord>(agentStatusPath(manifest, taskId));
}

export function appendCrewAgentEvent(manifest: TeamRunManifest, taskId: string, event: unknown): void {
	fs.mkdirSync(agentStateDir(manifest, taskId), { recursive: true });
	fs.appendFileSync(agentEventsPath(manifest, taskId), `${JSON.stringify({ time: new Date().toISOString(), event })}\n`, "utf-8");
}

export function readCrewAgentEvents(manifest: TeamRunManifest, taskId: string): unknown[] {
	const filePath = agentEventsPath(manifest, taskId);
	if (!fs.existsSync(filePath)) return [];
	return fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean).map((line) => {
		try { return JSON.parse(line) as unknown; } catch { return { raw: line }; }
	});
}

export function appendCrewAgentOutput(manifest: TeamRunManifest, taskId: string, text: string): void {
	if (!text.trim()) return;
	fs.mkdirSync(agentStateDir(manifest, taskId), { recursive: true });
	fs.appendFileSync(agentOutputPath(manifest, taskId), `${text}\n`, "utf-8");
}

export function emptyCrewAgentProgress(): CrewAgentProgress {
	return { recentTools: [], recentOutput: [], toolCount: 0 };
}

export function recordFromTask(manifest: TeamRunManifest, task: TeamTaskState, runtime: CrewRuntimeKind): CrewAgentRecord {
	return {
		id: `${manifest.runId}:${task.id}`,
		runId: manifest.runId,
		taskId: task.id,
		agent: task.agent,
		role: task.role,
		runtime,
		status: taskStatusToAgentStatus(task.status),
		startedAt: task.startedAt ?? new Date().toISOString(),
		completedAt: task.finishedAt,
		resultArtifactPath: task.resultArtifact?.path,
		transcriptPath: task.transcriptArtifact?.path ?? task.logArtifact?.path,
		statusPath: agentStatusPath(manifest, task.id),
		eventsPath: agentEventsPath(manifest, task.id),
		outputPath: agentOutputPath(manifest, task.id),
		toolUses: task.agentProgress?.toolCount,
		jsonEvents: task.jsonEvents,
		progress: task.agentProgress,
		error: task.error,
	};
}
