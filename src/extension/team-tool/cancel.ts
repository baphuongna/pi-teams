import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { withRunLockSync } from "../../state/locks.ts";
import { loadRunManifestById, saveRunTasks, updateRunStatus } from "../../state/state-store.ts";
import { saveCrewAgents, recordFromTask } from "../../runtime/crew-agent-records.ts";
import { writeForegroundInterruptRequest } from "../../runtime/foreground-control.ts";
import { cancellationReasonFromUnknown } from "../../runtime/cancellation.ts";
import { appendEvent } from "../../state/event-log.ts";
import { logInternalError } from "../../utils/internal-error.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { result, type TeamContext } from "./context.ts";

export interface AbortOwnedResult {
	abortedIds: string[];
	missingIds: string[];
	foreignIds: string[];
}

/**
 * Classify task IDs by ownership.
 * - Tasks with status "queued" or "running" that belong to the current session → abortedIds
 * - Task IDs not found in the run → missingIds
 * - Tasks with status "queued" or "running" that belong to a different session → foreignIds
 * - Tasks already completed/failed/cancelled → neither (not included in any list)
 *
 * Currently, task ownership is determined by the manifest's run-level ownership.
 * Since tasks in a single run are all owned by the session that created the run,
 * the ownerSessionId comes from the context. Foreign detection compares
 * the requesting session against the run's creating session.
 */
export function abortOwned(
	runId: string,
	taskIds: string[] | undefined,
	ctx: TeamContext,
): AbortOwnedResult {
	const loaded = loadRunManifestById(ctx.cwd, runId);
	if (!loaded) return { abortedIds: [], missingIds: taskIds ?? [], foreignIds: [] };

	const result: AbortOwnedResult = { abortedIds: [], missingIds: [], foreignIds: [] };
	const taskMap = new Map(loaded.tasks.map((t) => [t.id, t] as const));
	const targetIds = taskIds ?? loaded.tasks.map((t) => t.id);
	const foreignRun = typeof loaded.manifest.ownerSessionId === "string" && loaded.manifest.ownerSessionId !== ctx.sessionId;

	for (const id of targetIds) {
		const task = taskMap.get(id);
		if (!task) {
			result.missingIds.push(id);
			continue;
		}
		if (task.status !== "queued" && task.status !== "running" && task.status !== "waiting") continue;
		if (foreignRun) {
			result.foreignIds.push(id);
			continue;
		}
		result.abortedIds.push(id);
	}

	return result;
}

function cancelReasonFromParams(params: TeamToolParamsValue): { code: string; message: string } {
	const config = params.config && typeof params.config === "object" && !Array.isArray(params.config) ? params.config : undefined;
	const rawReason = config?.reason ?? config?.cancelReason;
	const reason = rawReason === undefined ? { code: "caller_cancelled" as const, message: "Run cancelled by user request." } : cancellationReasonFromUnknown(rawReason);
	return { code: reason.code, message: reason.message };
}

export function handleCancel(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Cancel requires runId.", { action: "cancel", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "cancel", status: "error" }, true);
	return withRunLockSync(loaded.manifest, () => {
		if ((loaded.manifest.status === "completed" || loaded.manifest.status === "cancelled") && !params.force) return result(`Run ${loaded.manifest.runId} is already ${loaded.manifest.status}; nothing to cancel. Use force: true to mark it cancelled anyway.`, { action: "cancel", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });

		// Classify tasks for foreign-aware cancellation
		const abortResult = abortOwned(loaded.manifest.runId, undefined, ctx);
		if (abortResult.abortedIds.length === 0 && abortResult.foreignIds.length > 0) {
			return result(`Run ${loaded.manifest.runId} belongs to another session; not cancelled.`, { action: "cancel", status: "error", runId: loaded.manifest.runId, foreignIds: abortResult.foreignIds }, true);
		}
		const cancellableIds = new Set(abortResult.abortedIds);
		const cancelReason = cancelReasonFromParams(params);
		const cancelMessage = `${cancelReason.message} (${cancelReason.code})`;

		const tasks = loaded.tasks.map((task) => {
			if (cancellableIds.has(task.id) && (task.status === "queued" || task.status === "running" || task.status === "waiting")) {
				return { ...task, status: "cancelled" as const, finishedAt: new Date().toISOString(), error: cancelMessage };
			}
			return task;
		});
		saveRunTasks(loaded.manifest, tasks);
		try {
			saveCrewAgents(loaded.manifest, tasks.map((task) => recordFromTask(loaded.manifest, task, "child-process")));
		} catch (error) {
			logInternalError("team-tool.handleCancel.crewAgents", error, `runId=${loaded.manifest.runId}`);
		}
		try {
			writeForegroundInterruptRequest(loaded.manifest, cancelMessage);
		} catch (error) {
			logInternalError("team-tool.handleCancel.interruptRequest", error, `runId=${loaded.manifest.runId}`);
		}
		for (const taskId of abortResult.abortedIds) {
			appendEvent(loaded.manifest.eventsPath, { type: "task.cancelled", runId: loaded.manifest.runId, taskId, message: cancelMessage, data: { reason: cancelReason.code } });
		}
		const updated = updateRunStatus(loaded.manifest, "cancelled", `${cancelMessage} Already-finished worker processes are not retroactively changed.`);

		// Build descriptive message including foreign/missing info
		const parts = [`Cancelled run ${updated.runId}.`];
		if (abortResult.foreignIds.length > 0) parts.push(` ${abortResult.foreignIds.length} task(s) belong to another session and were not cancelled: ${abortResult.foreignIds.join(", ")}.`);
		if (abortResult.missingIds.length > 0) parts.push(` ${abortResult.missingIds.length} task ID(s) not found: ${abortResult.missingIds.join(", ")}.`);

		return result(parts.join(""), {
			action: "cancel",
			status: "ok",
			runId: updated.runId,
			artifactsRoot: updated.artifactsRoot,
			abortedIds: abortResult.abortedIds,
			missingIds: abortResult.missingIds,
			foreignIds: abortResult.foreignIds,
		});
	});
}