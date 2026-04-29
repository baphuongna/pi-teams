import type { TeamTaskState } from "../state/types.ts";
import type { RunUiSnapshot } from "./snapshot-types.ts";

export interface HeartbeatSummary {
	runId: string;
	totalTasks: number;
	healthy: number;
	stale: number;
	dead: number;
	missing: number;
	worstStaleMs: number;
}

export interface HeartbeatSummaryOptions {
	staleMs?: number;
	deadMs?: number;
	now?: number | Date;
}

function nowMs(now: number | Date | undefined): number {
	if (typeof now === "number") return now;
	if (now instanceof Date) return now.getTime();
	return Date.now();
}

function isActiveTask(task: TeamTaskState): boolean {
	return task.status === "running" || task.status === "queued";
}

export function summarizeHeartbeats(snapshot: RunUiSnapshot, opts: HeartbeatSummaryOptions = {}): HeartbeatSummary {
	const staleMs = opts.staleMs ?? 60_000;
	const deadMs = opts.deadMs ?? 5 * 60_000;
	const current = nowMs(opts.now);
	const summary: HeartbeatSummary = { runId: snapshot.runId, totalTasks: snapshot.tasks.length, healthy: 0, stale: 0, dead: 0, missing: 0, worstStaleMs: 0 };
	for (const task of snapshot.tasks) {
		if (!isActiveTask(task)) continue;
		const heartbeat = task.heartbeat;
		if (!heartbeat) {
			summary.missing += 1;
			continue;
		}
		const age = Math.max(0, current - Date.parse(heartbeat.lastSeenAt));
		if (!Number.isFinite(age)) {
			summary.missing += 1;
			continue;
		}
		summary.worstStaleMs = Math.max(summary.worstStaleMs, age);
		if (heartbeat.alive === false || age > deadMs) summary.dead += 1;
		else if (age > staleMs) summary.stale += 1;
		else summary.healthy += 1;
	}
	return summary;
}
