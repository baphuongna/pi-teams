import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";

/**
 * Creates a lightweight snapshot of task state for event emission.
 * Prevents mutation-during-callback issues by copying relevant fields.
 */
export function snapshotTaskState(task: TeamTaskState): Readonly<TeamTaskState> {
	return {
		...task,
		dependsOn: [...task.dependsOn],
		usage: task.usage ? { ...task.usage } : undefined,
		agentProgress: task.agentProgress ? { ...task.agentProgress } : undefined,
		heartbeat: task.heartbeat ? { ...task.heartbeat } : undefined,
		modelAttempts: task.modelAttempts?.map((a) => ({ ...a })),
		modelRouting: task.modelRouting ? { ...task.modelRouting } : undefined,
		claim: task.claim ? { ...task.claim } : undefined,
		checkpoint: task.checkpoint ? { ...task.checkpoint } : undefined,
		attempts: task.attempts?.map((a) => ({ ...a })),
		worktree: task.worktree ? { ...task.worktree } : undefined,
	};
}

/**
 * Session state snapshot for persistence before session switches.
 * Captures the minimal set of data needed to resume operations.
 */
export interface SessionStateSnapshot {
	/** ISO timestamp of the snapshot */
	capturedAt: string;
	/** Active run IDs at time of snapshot */
	activeRunIds: string[];
	/** Number of pending deliveries */
	pendingDeliveryCount: number;
	/** Session generation counter */
	sessionGeneration: number;
	/** Summary of active tasks by status */
	taskSummary: Record<string, number>;
}

/**
 * Create a session state snapshot for pre-switch persistence.
 */
export function createSessionSnapshot(
	activeRuns: TeamRunManifest[],
	pendingDeliveryCount: number,
	sessionGeneration: number,
): SessionStateSnapshot {
	const taskSummary: Record<string, number> = {};
	for (const run of activeRuns) {
		taskSummary[run.status] = (taskSummary[run.status] ?? 0) + 1;
	}
	return {
		capturedAt: new Date().toISOString(),
		activeRunIds: activeRuns.map((r) => r.runId),
		pendingDeliveryCount,
		sessionGeneration,
		taskSummary,
	};
}
