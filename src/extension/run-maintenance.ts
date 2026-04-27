import * as fs from "node:fs";
import type { TeamRunManifest } from "../state/types.ts";
import { listRuns } from "./run-index.ts";

export interface PruneRunsResult {
	kept: string[];
	removed: string[];
}

function isFinished(run: TeamRunManifest): boolean {
	return run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "blocked";
}

export function pruneFinishedRuns(cwd: string, keep: number): PruneRunsResult {
	const finished = listRuns(cwd).filter((run) => run.cwd === cwd && isFinished(run)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const kept = finished.slice(0, keep).map((run) => run.runId);
	const removed: string[] = [];
	for (const run of finished.slice(keep)) {
		fs.rmSync(run.stateRoot, { recursive: true, force: true });
		fs.rmSync(run.artifactsRoot, { recursive: true, force: true });
		removed.push(run.runId);
	}
	return { kept, removed };
}
