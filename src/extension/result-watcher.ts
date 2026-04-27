import * as fs from "node:fs";
import * as path from "node:path";
import { createFileCoalescer } from "../utils/file-coalescer.ts";

export interface ResultWatcherEvents {
	emit(event: string, data: unknown): void;
}

export interface ResultWatcherHandle {
	start(): void;
	prime(): void;
	stop(): void;
}

export interface ResultWatcherOptions {
	eventName?: string;
	completionTtlMs?: number;
}

function readJson(filePath: string): unknown | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
	} catch {
		return undefined;
	}
}

function completionKey(payload: unknown, file: string): string {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return `file:${file}`;
	const obj = payload as Record<string, unknown>;
	const id = [obj.runId, obj.sessionId, obj.id, obj.status].filter((entry): entry is string => typeof entry === "string" && entry.length > 0).join(":");
	return id || `file:${file}`;
}

export function createResultWatcher(events: ResultWatcherEvents, resultsDir: string, eventNameOrOptions: string | ResultWatcherOptions = "pi-crew:run-result"): ResultWatcherHandle {
	const options = typeof eventNameOrOptions === "string" ? { eventName: eventNameOrOptions } : eventNameOrOptions;
	const eventName = options.eventName ?? "pi-crew:run-result";
	const completionTtlMs = options.completionTtlMs ?? 5 * 60_000;
	const seen = new Map<string, number>();
	let watcher: fs.FSWatcher | undefined;
	let restartTimer: ReturnType<typeof setTimeout> | undefined;
	const coalescer = createFileCoalescer((file) => {
		const filePath = path.join(resultsDir, file);
		if (!file.endsWith(".json") || !fs.existsSync(filePath)) return;
		const payload = readJson(filePath);
		if (payload !== undefined) {
			const now = Date.now();
			for (const [key, expiresAt] of seen) if (expiresAt <= now) seen.delete(key);
			const key = completionKey(payload, file);
			if (!seen.has(key)) {
				seen.set(key, now + completionTtlMs);
				events.emit(eventName, payload);
			}
		}
		try { fs.unlinkSync(filePath); } catch {}
	}, 50);
	const scheduleRestart = () => {
		if (restartTimer) clearTimeout(restartTimer);
		restartTimer = setTimeout(() => {
			restartTimer = undefined;
			try { handle.start(); } catch {}
		}, 3000);
		restartTimer.unref?.();
	};
	const handle: ResultWatcherHandle = {
		start() {
			fs.mkdirSync(resultsDir, { recursive: true });
			watcher?.close();
			watcher = fs.watch(resultsDir, (event, file) => {
				if (event !== "rename" || !file) return;
				coalescer.schedule(file.toString());
			});
			watcher.on("error", scheduleRestart);
			watcher.unref?.();
		},
		prime() {
			if (!fs.existsSync(resultsDir)) return;
			for (const file of fs.readdirSync(resultsDir).filter((entry) => entry.endsWith(".json"))) coalescer.schedule(file, 0);
		},
		stop() {
			watcher?.close();
			watcher = undefined;
			if (restartTimer) clearTimeout(restartTimer);
			restartTimer = undefined;
			coalescer.clear();
		},
	};
	return handle;
}
