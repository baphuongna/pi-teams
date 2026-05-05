import type { RunUiSnapshot } from "../snapshot-types.ts";

export function renderProgressPane(snapshot: RunUiSnapshot | undefined): string[] {
	if (!snapshot) return ["Progress pane: snapshot unavailable"];
	const progress = snapshot.progress;
	const groupJoins = snapshot.groupJoins ?? [];
	const groupJoinLines = groupJoins.length ? groupJoins.map((item) => `group join ${item.partial ? "partial" : "completed"}: ${item.requestId} ack=${item.ack}`) : ["group joins: none"];
	const cancellationLine = snapshot.cancellationReason ? [`cancelled: reason=${snapshot.cancellationReason}`] : [];
	return [
		`Progress pane: ${progress.completed}/${progress.total} completed · running=${progress.running} queued=${progress.queued} failed=${progress.failed}`,
		...cancellationLine,
		...groupJoinLines,
		...snapshot.recentEvents.slice(-10).map((event) => {
			const seq = event.metadata?.seq !== undefined ? `#${event.metadata.seq}` : "#?";
			return `${seq} ${event.time} ${event.type}${event.taskId ? ` ${event.taskId}` : ""}${event.message ? ` · ${event.message}` : ""}`;
		}),
		...(snapshot.recentEvents.length ? [] : ["No recent events"]),
	];
}
