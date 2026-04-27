import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "../state/types.ts";
import { projectPiRoot, userPiRoot } from "../utils/paths.ts";

function readManifest(filePath: string): TeamRunManifest | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TeamRunManifest;
	} catch {
		return undefined;
	}
}

function collectRuns(root: string): TeamRunManifest[] {
	const runsRoot = path.join(root, "state", "runs");
	if (!fs.existsSync(runsRoot)) return [];
	return fs.readdirSync(runsRoot)
		.map((entry) => readManifest(path.join(runsRoot, entry, "manifest.json")))
		.filter((manifest): manifest is TeamRunManifest => manifest !== undefined);
}

export function listRuns(cwd: string): TeamRunManifest[] {
	const projectRuns = collectRuns(path.join(projectPiRoot(cwd), "teams"));
	const userRuns = collectRuns(path.join(userPiRoot(), "extensions", "pi-crew", "runs"));
	const byId = new Map<string, TeamRunManifest>();
	for (const run of [...userRuns, ...projectRuns]) byId.set(run.runId, run);
	return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
