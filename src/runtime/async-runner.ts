import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TeamRunManifest } from "../state/types.ts";

export interface SpawnBackgroundTeamRunResult {
	pid?: number;
	logPath: string;
}

export function spawnBackgroundTeamRun(manifest: TeamRunManifest): SpawnBackgroundTeamRunResult {
	const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "background-runner.ts");
	const logPath = path.join(manifest.stateRoot, "background.log");
	fs.mkdirSync(manifest.stateRoot, { recursive: true });
	const logFd = fs.openSync(logPath, "a");
	const child = spawn(process.execPath, ["--experimental-strip-types", runnerPath, "--cwd", manifest.cwd, "--run-id", manifest.runId], {
		cwd: manifest.cwd,
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...process.env },
	});
	child.unref();
	fs.closeSync(logFd);
	return { pid: child.pid, logPath };
}
