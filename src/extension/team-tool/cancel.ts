import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { withRunLockSync } from "../../state/locks.ts";
import { loadRunManifestById, saveRunTasks, updateRunStatus } from "../../state/state-store.ts";
import { saveCrewAgents, recordFromTask } from "../../runtime/crew-agent-records.ts";
import { writeForegroundInterruptRequest } from "../../runtime/foreground-control.ts";
import { logInternalError } from "../../utils/internal-error.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { result, type TeamContext } from "./context.ts";

export function handleCancel(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Cancel requires runId.", { action: "cancel", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId);
	if (!loaded) return result(`Run '${params.runId}' not found.`, { action: "cancel", status: "error" }, true);
	return withRunLockSync(loaded.manifest, () => {
		if (loaded.manifest.status === "completed" && !params.force) return result(`Run ${loaded.manifest.runId} is already completed; nothing to cancel. Use force: true to mark it cancelled anyway.`, { action: "cancel", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
		const tasks = loaded.tasks.map((task) => task.status === "queued" || task.status === "running" ? { ...task, status: "cancelled" as const, finishedAt: new Date().toISOString(), error: "Run cancelled by user request." } : task);
		saveRunTasks(loaded.manifest, tasks);
		try {
			saveCrewAgents(loaded.manifest, tasks.map((task) => recordFromTask(loaded.manifest, task, "child-process")));
		} catch (error) {
			logInternalError("team-tool.handleCancel.crewAgents", error, `runId=${loaded.manifest.runId}`);
		}
		try {
			writeForegroundInterruptRequest(loaded.manifest, "Run cancelled by user request.");
		} catch (error) {
			logInternalError("team-tool.handleCancel.interruptRequest", error, `runId=${loaded.manifest.runId}`);
		}
		const updated = updateRunStatus(loaded.manifest, "cancelled", "Run cancelled by user request. Already-finished worker processes are not retroactively changed.");
		return result(`Cancelled run ${updated.runId}.`, { action: "cancel", status: "ok", runId: updated.runId, artifactsRoot: updated.artifactsRoot });
	});
}
