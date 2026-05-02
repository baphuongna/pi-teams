import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "../state/types.ts";

import { logInternalError } from "../utils/internal-error.ts";

export type DeadletterReason = "max-retries" | "heartbeat-dead" | "manual";

export interface DeadletterEntry {
	taskId: string;
	runId: string;
	reason: DeadletterReason;
	attempts: number;
	lastError?: string;
	timestamp: string;
}

export function deadletterPath(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "deadletter.jsonl");
}

export function appendDeadletter(manifest: TeamRunManifest, entry: DeadletterEntry): void {
	try {
		fs.mkdirSync(manifest.stateRoot, { recursive: true });
		fs.appendFileSync(deadletterPath(manifest), `${JSON.stringify(entry)}\n`, "utf-8");
	} catch (error) {
		logInternalError("deadletter.append", error, `taskId=${entry.taskId}`);
	}
}

export function readDeadletter(manifest: TeamRunManifest, maxEntries = 1000): DeadletterEntry[] {
	const filePath = deadletterPath(manifest);
	if (!fs.existsSync(filePath)) return [];
	// Read last maxEntries lines only to limit memory.
	const raw = fs.readFileSync(filePath, "utf-8");
	const lines = raw.split(/\r?\n/).filter(Boolean);
	const tail = lines.slice(-maxEntries);
	return tail.flatMap((line) => {
		try {
			const parsed = JSON.parse(line) as DeadletterEntry;
			return parsed && typeof parsed.taskId === "string" && typeof parsed.runId === "string" ? [parsed] : [];
		} catch {
			return [];
		}
	});
}
