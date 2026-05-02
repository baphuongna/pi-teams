import * as fs from "node:fs";
import type { TeamRunManifest } from "../state/types.ts";
import { resolveRealContainedPath } from "../utils/safe-paths.ts";
import { projectCrewRoot } from "../utils/paths.ts";
import { listRuns } from "./run-index.ts";
import { logInternalError } from "../utils/internal-error.ts";

export interface PruneRunsResult {
	kept: string[];
	removed: string[];
}

function isFinished(run: TeamRunManifest): boolean {
	return run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "blocked";
}

function isSafeToPrune(cwd: string, run: TeamRunManifest): boolean {
	try {
		const crewRoot = projectCrewRoot(cwd);
		resolveRealContainedPath(crewRoot, run.stateRoot);
		resolveRealContainedPath(crewRoot, run.artifactsRoot);
		return true;
	} catch {
		return false;
	}
}

export function pruneFinishedRuns(cwd: string, keep: number): PruneRunsResult {
	const crewRoot = projectCrewRoot(cwd);
	const finished = listRuns(cwd).filter((run) => run.cwd === cwd && isFinished(run)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const kept = finished.slice(0, keep).map((run) => run.runId);
	const removed: string[] = [];
	for (const run of finished.slice(keep)) {
		if (!isSafeToPrune(cwd, run)) {
			logInternalError("prune.path-unsafe", new Error(`Skipping unsafe prune: stateRoot=${run.stateRoot}, artifactsRoot=${run.artifactsRoot}`), `runId=${run.runId}`);
			continue;
		}
		fs.rmSync(run.stateRoot, { recursive: true, force: true });
		fs.rmSync(run.artifactsRoot, { recursive: true, force: true });
		removed.push(run.runId);
	}
	return { kept, removed };
}
