import * as fs from "node:fs";
import * as path from "node:path";
import { assertRunBundle } from "./run-bundle-schema.ts";
import { projectCrewRoot, userCrewRoot } from "../utils/paths.ts";
import { DEFAULT_PATHS } from "../config/defaults.ts";
import { assertSafePathId, resolveContainedRelativePath, resolveRealContainedPath } from "../utils/safe-paths.ts";

export interface ImportedRunBundleInfo {
	runId: string;
	importedAt: string;
	bundlePath: string;
	summaryPath: string;
}

function importRoot(cwd: string, scope: "project" | "user"): string {
	const base = scope === "project" ? projectCrewRoot(cwd) : userCrewRoot();
	return path.join(base, DEFAULT_PATHS.state.importsSubdir);
}

export function importRunBundle(cwd: string, bundlePath: string, scope: "project" | "user" = "project"): ImportedRunBundleInfo {
	const resolvedPath = path.isAbsolute(bundlePath) ? bundlePath : path.resolve(cwd, bundlePath);
	const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as unknown;
	assertRunBundle(raw);
	const runId = assertSafePathId("runId", raw.manifest.runId);
	const importedAt = new Date().toISOString();
	const importsRoot = importRoot(cwd, scope);
	fs.mkdirSync(importsRoot, { recursive: true });
	if (fs.lstatSync(importsRoot).isSymbolicLink()) throw new Error(`Invalid import root: ${importsRoot}`);
	resolveRealContainedPath(path.dirname(importsRoot), path.basename(importsRoot));
	const root = resolveContainedRelativePath(importsRoot, runId, "runId");
	fs.mkdirSync(root, { recursive: true });
	// TOCTOU note: mkdirSync would throw EEXIST if a symlink already existed.
	// The lstatSync check catches a symlink swapped in between mkdirSync and the check
	// (theoretically possible but requires local attacker with exact timing).
	// resolveRealContainedPath provides an additional real-path containment barrier.
	if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Invalid import directory: ${root}`);
	resolveRealContainedPath(importsRoot, runId);
	const targetJson = path.join(root, "run-export.json");
	const targetSummary = path.join(root, "README.md");
	for (const target of [targetJson, targetSummary]) {
		if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Invalid import target: ${target}`);
	}
	fs.writeFileSync(targetJson, `${JSON.stringify({ ...raw, importedAt, importedFrom: resolvedPath }, null, 2)}\n`, "utf-8");
	fs.writeFileSync(targetSummary, [
		`# Imported pi-crew run ${runId}`,
		"",
		`Imported: ${importedAt}`,
		`Source: ${resolvedPath}`,
		`Original export: ${raw.exportedAt}`,
		`Status: ${raw.manifest.status}`,
		`Team: ${raw.manifest.team}`,
		`Workflow: ${raw.manifest.workflow ?? "(none)"}`,
		`Goal: ${raw.manifest.goal}`,
		"",
		"## Tasks",
		...raw.tasks.map((task) => `- ${task.id}: ${task.status} (${task.role} -> ${task.agent})${task.error ? ` - ${task.error}` : ""}`),
		"",
	].join("\n"), "utf-8");
	return { runId, importedAt, bundlePath: targetJson, summaryPath: targetSummary };
}
