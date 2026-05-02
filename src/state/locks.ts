import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "./types.ts";
import { DEFAULT_LOCKS } from "../config/defaults.ts";

export interface RunLockOptions {
	staleMs?: number;
}

const DEFAULT_STALE_MS = DEFAULT_LOCKS.staleMs;

function lockPath(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "run.lock");
}

function sleepSync(ms: number): void {
	try {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	} catch {
		// Fallback for environments without SharedArrayBuffer / Atomics.wait support.
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			// Busy-wait — only used as last-resort, retry counts are capped.
		}
	}
}

function parseCreatedAtFromLock(raw: string): number | undefined {
	try {
		const payload = JSON.parse(raw) as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
		const candidate = payload as { createdAt?: unknown };
		if (typeof candidate.createdAt !== "string") return undefined;
		const parsed = Date.parse(candidate.createdAt);
		return Number.isNaN(parsed) ? undefined : parsed;
	} catch {
		return undefined;
	}
}

function isLockStale(filePath: string, staleMs: number): boolean {
	try {
		const stat = fs.statSync(filePath);
		let createdAt = parseCreatedAtFromLock(fs.readFileSync(filePath, "utf-8"));
		if (createdAt === undefined) createdAt = stat.mtimeMs;
		return Date.now() - createdAt > staleMs;
	} catch {
		return false;
	}
}

function readLockState(filePath: string, staleMs: number): boolean {
	if (!isLockStale(filePath, staleMs)) return false;
	try {
		fs.rmSync(filePath, { force: true });
		return true;
	} catch {
		return false;
	}
}

function writeLockFile(filePath: string): void {
	const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
	try {
		fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
	} finally {
		fs.closeSync(fd);
	}
}

function acquireLockWithRetry(filePath: string, staleMs: number): void {
	let attempt = 0;
	const deadline = Date.now() + staleMs * 2;
	while (true) {
		try {
			writeLockFile(filePath);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw error;
			if (!readLockState(filePath, staleMs)) {
				throw new Error(`Run '${path.basename(filePath)}' is locked by another operation.`);
			}
			if (Date.now() > deadline) {
				throw new Error(`Run '${path.basename(filePath)}' is locked by another operation.`);
			}
			const delay = Math.min(250, 25 * 2 ** attempt);
			sleepSync(delay);
			attempt++;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLockStateAsync(filePath: string, staleMs: number): void {
	try {
		if (isLockStale(filePath, staleMs)) fs.rmSync(filePath, { force: true });
	} catch {
		// Ignore stale-check races.
	}
}

async function acquireLockWithRetryAsync(filePath: string, staleMs: number): Promise<void> {
	let attempt = 0;
	const deadline = Date.now() + staleMs * 2;
	while (true) {
		try {
			writeLockFile(filePath);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw error;
			if (Date.now() > deadline) {
				throw new Error(`Run '${path.basename(filePath)}' is locked by another operation.`);
			}
			readLockStateAsync(filePath, staleMs);
			const delay = Math.min(250, 25 * 2 ** attempt);
			await sleep(delay);
			attempt++;
		}
	}
}

export function withRunLockSync<T>(manifest: TeamRunManifest, fn: () => T, options: RunLockOptions = {}): T {
	const filePath = lockPath(manifest);
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	acquireLockWithRetry(filePath, staleMs);
	try {
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
	const filePath = lockPath(manifest);
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	await acquireLockWithRetryAsync(filePath, staleMs);
	try {
		return await fn();
	} finally {
		try {
			fs.rmSync(filePath, { force: true });
		} catch {
			// Best-effort lock cleanup.
		}
	}
}
