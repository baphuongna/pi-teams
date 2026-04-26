import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "./types.ts";

export interface RunLockOptions {
	staleMs?: number;
}

const DEFAULT_STALE_MS = 30_000;

function lockPath(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "run.lock");
}

export function withRunLockSync<T>(manifest: TeamRunManifest, fn: () => T, options: RunLockOptions = {}): T {
	const filePath = lockPath(manifest);
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		if (fs.existsSync(filePath)) {
			const stat = fs.statSync(filePath);
			if (Date.now() - stat.mtimeMs <= staleMs) {
				throw new Error(`Run '${manifest.runId}' is locked by another operation.`);
			}
			fs.rmSync(filePath, { force: true });
		}
		fs.writeFileSync(filePath, JSON.stringify({ runId: manifest.runId, pid: process.pid, createdAt: new Date().toISOString() }, null, 2), { flag: "wx" });
		return fn();
	} finally {
		try {
			fs.rmSync(filePath, { force: true });
		} catch {
			// Best-effort lock cleanup.
		}
	}
}

export async function withRunLock<T>(manifest: TeamRunManifest, fn: () => Promise<T>, options: RunLockOptions = {}): Promise<T> {
	return withRunLockSync(manifest, () => fn(), options);
}
