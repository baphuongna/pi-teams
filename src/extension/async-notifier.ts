import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { listRuns } from "./run-index.ts";

export interface AsyncNotifierState {
	seenFinishedRunIds: Set<string>;
	interval?: ReturnType<typeof setInterval>;
}

function isFinished(status: string): boolean {
	return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked";
}

export function startAsyncRunNotifier(ctx: ExtensionContext, state: AsyncNotifierState, intervalMs = 5000): void {
	if (state.interval) clearInterval(state.interval);
	for (const run of listRuns(ctx.cwd)) {
		if (isFinished(run.status)) state.seenFinishedRunIds.add(run.runId);
	}
	state.interval = setInterval(() => {
		try {
			for (const run of listRuns(ctx.cwd).slice(0, 20)) {
				if (!isFinished(run.status) || state.seenFinishedRunIds.has(run.runId)) continue;
				state.seenFinishedRunIds.add(run.runId);
				const level = run.status === "completed" ? "info" : run.status === "cancelled" ? "warning" : "error";
				ctx.ui.notify(`pi-teams run ${run.status}: ${run.runId} (${run.team}/${run.workflow ?? "none"})`, level);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[pi-teams] async notifier error: ${message}`);
		}
	}, intervalMs);
}

export function stopAsyncRunNotifier(state: AsyncNotifierState): void {
	if (state.interval) clearInterval(state.interval);
	state.interval = undefined;
}
