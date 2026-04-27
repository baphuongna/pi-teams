import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TeamRunManifest } from "../state/types.ts";

const require = createRequire(import.meta.url);

function resolveJitiCliPath(): string | undefined {
	const candidates: Array<() => string> = [
		() => path.join(path.dirname(require.resolve("jiti/package.json")), "lib/jiti-cli.mjs"),
		() => path.join(path.dirname(require.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs"),
	];
	for (const candidate of candidates) {
		try {
			const filePath = candidate();
			if (fs.existsSync(filePath)) return filePath;
		} catch {
			// Try the next possible runtime dependency location.
		}
	}
	return undefined;
}

export function getBackgroundRunnerCommand(runnerPath: string, cwd: string, runId: string): { args: string[]; loader: "jiti" | "strip-types" } {
	const jitiCliPath = resolveJitiCliPath();
	const runnerArgs = [runnerPath, "--cwd", cwd, "--run-id", runId];
	return jitiCliPath
		? { args: [jitiCliPath, ...runnerArgs], loader: "jiti" }
		: { args: ["--experimental-strip-types", ...runnerArgs], loader: "strip-types" };
}

export interface SpawnBackgroundTeamRunResult {
	pid?: number;
	logPath: string;
}

export function spawnBackgroundTeamRun(manifest: TeamRunManifest): SpawnBackgroundTeamRunResult {
	const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "background-runner.ts");
	const logPath = path.join(manifest.stateRoot, "background.log");
	fs.mkdirSync(manifest.stateRoot, { recursive: true });
	const logFd = fs.openSync(logPath, "a");
	const command = getBackgroundRunnerCommand(runnerPath, manifest.cwd, manifest.runId);
	fs.appendFileSync(logPath, `[pi-crew] background loader=${command.loader}\n`, "utf-8");
	const child = spawn(process.execPath, command.args, {
		cwd: manifest.cwd,
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...process.env },
	});
	child.unref();
	fs.closeSync(logFd);
	return { pid: child.pid, logPath };
}
