import type { CrewRuntimeConfig } from "../config/config.ts";
import { writeArtifact } from "../state/artifact-store.ts";
import { appendEvent } from "../state/event-log.ts";
import { appendMailboxMessage } from "../state/mailbox.ts";
import type { ArtifactDescriptor, TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { aggregateTaskOutputs } from "./task-output-context.ts";

export type CrewGroupJoinMode = "off" | "group" | "smart";

export interface CrewGroupJoinDelivery {
	batchId: string;
	mode: CrewGroupJoinMode;
	partial: boolean;
	taskIds: string[];
	completed: string[];
	failed: string[];
	skipped: string[];
	remaining: string[];
	artifact?: ArtifactDescriptor;
	messageId?: string;
}

export function resolveGroupJoinMode(runtime?: CrewRuntimeConfig): CrewGroupJoinMode {
	return runtime?.groupJoin ?? "smart";
}

export function shouldGroupJoin(mode: CrewGroupJoinMode, batch: TeamTaskState[]): boolean {
	if (mode === "off") return false;
	if (mode === "group") return batch.length > 0;
	return batch.length > 1;
}

function batchIdFor(runId: string, taskIds: string[]): string {
	return `${runId}_${taskIds.join("+").replace(/[^a-zA-Z0-9_+-]/g, "_")}`;
}

function statusList(tasks: TeamTaskState[], status: TeamTaskState["status"]): string[] {
	return tasks.filter((task) => task.status === status).map((task) => task.id);
}

export function deliverGroupJoin(input: {
	manifest: TeamRunManifest;
	mode: CrewGroupJoinMode;
	batch: TeamTaskState[];
	allTasks: TeamTaskState[];
	partial?: boolean;
}): CrewGroupJoinDelivery | undefined {
	if (!shouldGroupJoin(input.mode, input.batch)) return undefined;
	const taskIds = input.batch.map((task) => task.id);
	const latest = taskIds.map((id) => input.allTasks.find((task) => task.id === id)).filter((task): task is TeamTaskState => Boolean(task));
	const completed = statusList(latest, "completed");
	const failed = statusList(latest, "failed");
	const skipped = statusList(latest, "skipped");
	const remaining = latest.filter((task) => task.status === "queued" || task.status === "running").map((task) => task.id);
	const partial = input.partial ?? remaining.length > 0;
	const batchId = batchIdFor(input.manifest.runId, taskIds);
	const summary = aggregateTaskOutputs(latest);
	const delivery: CrewGroupJoinDelivery = { batchId, mode: input.mode, partial, taskIds, completed, failed, skipped, remaining };
	const content = `${JSON.stringify({ ...delivery, createdAt: new Date().toISOString() }, null, 2)}\n`;
	const artifact = writeArtifact(input.manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: `metadata/group-joins/${batchId}.json`,
		producer: "group-join",
		content,
	});
	const mailbox = appendMailboxMessage(input.manifest, {
		direction: "outbox",
		from: "group-join",
		to: "leader",
		body: [
			`Group join ${partial ? "partial" : "completed"}: ${taskIds.join(", ")}`,
			`Completed: ${completed.join(", ") || "none"}`,
			`Failed: ${failed.join(", ") || "none"}`,
			`Skipped: ${skipped.join(", ") || "none"}`,
			`Remaining: ${remaining.join(", ") || "none"}`,
			"",
			summary,
		].join("\n"),
		status: "delivered",
	});
	appendEvent(input.manifest.eventsPath, {
		type: partial ? "agent.group_join.partial" : "agent.group_join.completed",
		runId: input.manifest.runId,
		message: `Group join ${partial ? "partial" : "completed"} for ${taskIds.length} task(s).`,
		data: { ...delivery, artifactPath: artifact.path, messageId: mailbox.id },
	});
	return { ...delivery, artifact, messageId: mailbox.id };
}
