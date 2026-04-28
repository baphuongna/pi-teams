import * as path from "node:path";
import { DEFAULT_ARTIFACT_CLEANUP } from "../../config/defaults.ts";
import { CLEANUP_MARKER_FILE, cleanupOldArtifacts } from "../../state/artifact-store.ts";
import { logInternalError } from "../../utils/internal-error.ts";
import { projectPiRoot, userPiRoot } from "../../utils/paths.ts";

export function runArtifactCleanup(cwd: string): void {
	try {
		cleanupOldArtifacts(path.join(userPiRoot(), "extensions", "pi-crew", "artifacts"), { maxAgeDays: DEFAULT_ARTIFACT_CLEANUP.maxAgeDays, markerFile: CLEANUP_MARKER_FILE });
		cleanupOldArtifacts(path.join(projectPiRoot(cwd), "artifacts"), { maxAgeDays: DEFAULT_ARTIFACT_CLEANUP.maxAgeDays, markerFile: CLEANUP_MARKER_FILE });
	} catch (error) {
		logInternalError("register.artifact-cleanup", error, `cwd=${cwd}`);
	}
}
