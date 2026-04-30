import { appendEvent, readEvents } from "../state/event-log.ts";
import type { CrewAttentionEventData, TeamRunManifest } from "../state/types.ts";

export interface AppendTaskAttentionInput {
	manifest: TeamRunManifest;
	taskId?: string;
	message: string;
	data: CrewAttentionEventData;
}

export function appendTaskAttentionEvent(input: AppendTaskAttentionInput): boolean {
	const recent = readEvents(input.manifest.eventsPath).slice(-100);
	const duplicate = recent.some((event) => event.type === "task.attention" && event.taskId === input.taskId && event.data?.reason === input.data.reason && event.data?.activityState === input.data.activityState);
	if (duplicate) return false;
	appendEvent(input.manifest.eventsPath, {
		type: "task.attention",
		runId: input.manifest.runId,
		taskId: input.taskId,
		message: input.message,
		data: { ...input.data },
	});
	return true;
}
