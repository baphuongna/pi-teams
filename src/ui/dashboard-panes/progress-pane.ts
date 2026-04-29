import type { RunUiSnapshot } from "../snapshot-types.ts";

export function renderProgressPane(snapshot: RunUiSnapshot | undefined): string[] {
	if (!snapshot) return ["Progress pane: snapshot unavailable"];
	const progress = snapshot.progress;
	return [
		`Progress pane: ${progress.completed}/${progress.total} completed · running=${progress.running} queued=${progress.queued} failed=${progress.failed}`,
		...snapshot.recentEvents.slice(-10).map((event) => {
			const seq = event.metadata?.seq !== undefined ? `#${event.metadata.seq}` : "#?";
			return `${seq} ${event.time} ${event.type}${event.taskId ? ` ${event.taskId}` : ""}${event.message ? ` · ${event.message}` : ""}`;
		}),
		...(snapshot.recentEvents.length ? [] : ["No recent events"]),
	];
}
