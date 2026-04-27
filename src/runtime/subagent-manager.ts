import * as fs from "node:fs";
import * as path from "node:path";
import { loadRunManifestById } from "../state/state-store.ts";
import type { PiTeamsToolResult } from "../extension/tool-result.ts";
import { projectPiRoot } from "../utils/paths.ts";

export type SubagentStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "error" | "stopped";

export interface SubagentSpawnOptions {
	cwd: string;
	type: string;
	description: string;
	prompt: string;
	background: boolean;
	model?: string;
	maxTurns?: number;
}

export interface SubagentRecord {
	id: string;
	runId?: string;
	type: string;
	description: string;
	prompt: string;
	status: SubagentStatus;
	startedAt: number;
	completedAt?: number;
	result?: string;
	error?: string;
	resultConsumed?: boolean;
	model?: string;
	background: boolean;
	promise?: Promise<void>;
}

type SpawnRunner = (options: SubagentSpawnOptions, signal?: AbortSignal) => Promise<PiTeamsToolResult>;
type Notify = (record: SubagentRecord) => void;

interface QueuedSpawn {
	record: SubagentRecord;
	options: SubagentSpawnOptions;
	runner: SpawnRunner;
	signal?: AbortSignal;
}

const TERMINAL_RUN_STATUS = new Set(["completed", "failed", "cancelled", "blocked"]);

function persistedSubagentPath(cwd: string, id: string): string {
	return path.join(projectPiRoot(cwd), "teams", "state", "subagents", `${id}.json`);
}

function serializableRecord(record: SubagentRecord): SubagentRecord {
	const { promise: _promise, ...rest } = record;
	return rest;
}

export function savePersistedSubagentRecord(cwd: string, record: SubagentRecord): void {
	try {
		const filePath = persistedSubagentPath(cwd, record.id);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, `${JSON.stringify(serializableRecord(record), null, 2)}\n`, "utf-8");
	} catch {}
}

export function readPersistedSubagentRecord(cwd: string, id: string): SubagentRecord | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(persistedSubagentPath(cwd, id), "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SubagentRecord : undefined;
	} catch {
		return undefined;
	}
}

function resultText(result: PiTeamsToolResult): string {
	return result.content?.map((item) => item.type === "text" ? item.text : "").filter(Boolean).join("\n") ?? "";
}

function detailsRunId(result: PiTeamsToolResult): string | undefined {
	const details = result.details as { runId?: unknown } | undefined;
	return typeof details?.runId === "string" ? details.runId : undefined;
}

export class SubagentManager {
	private readonly records = new Map<string, SubagentRecord>();
	private queue: QueuedSpawn[] = [];
	private runningBackground = 0;
	private counter = 0;
	private maxConcurrent: number;
	private readonly onComplete?: Notify;
	private readonly pollIntervalMs: number;

	constructor(maxConcurrent = 4, onComplete?: Notify, pollIntervalMs = 1000) {
		this.maxConcurrent = maxConcurrent;
		this.onComplete = onComplete;
		this.pollIntervalMs = pollIntervalMs;
	}

	spawn(options: SubagentSpawnOptions, runner: SpawnRunner, signal?: AbortSignal): SubagentRecord {
		const record: SubagentRecord = {
			id: `agent_${Date.now().toString(36)}_${(++this.counter).toString(36)}`,
			type: options.type,
			description: options.description,
			prompt: options.prompt,
			status: options.background && this.runningBackground >= this.maxConcurrent ? "queued" : "running",
			startedAt: Date.now(),
			model: options.model,
			background: options.background,
		};
		this.records.set(record.id, record);
		savePersistedSubagentRecord(options.cwd, record);
		if (record.status === "queued") {
			this.queue.push({ record, options, runner, signal });
			return record;
		}
		this.start(record, options, runner, signal);
		return record;
	}

	getRecord(id: string): SubagentRecord | undefined {
		return this.records.get(id);
	}

	listAgents(): SubagentRecord[] {
		return [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt);
	}

	abort(id: string): boolean {
		const record = this.records.get(id);
		if (!record) return false;
		if (record.status === "queued") {
			this.queue = this.queue.filter((entry) => entry.record.id !== id);
			record.status = "stopped";
			record.completedAt = Date.now();
			return true;
		}
		if (record.status !== "running") return false;
		record.status = "stopped";
		record.completedAt = Date.now();
		return true;
	}

	abortAll(): number {
		let count = 0;
		for (const entry of this.queue) {
			entry.record.status = "stopped";
			entry.record.completedAt = Date.now();
			count++;
		}
		this.queue = [];
		for (const record of this.records.values()) {
			if (record.status === "running") {
				record.status = "stopped";
				record.completedAt = Date.now();
				count++;
			}
		}
		return count;
	}

	async waitForAll(): Promise<void> {
		while (true) {
			this.drainQueue();
			const pending = this.listAgents().filter((record) => record.status === "running" || record.status === "queued").map((record) => record.promise).filter((promise): promise is Promise<void> => Boolean(promise));
			if (!pending.length) break;
			await Promise.allSettled(pending);
		}
	}

	async waitForRecord(id: string): Promise<SubagentRecord | undefined> {
		while (true) {
			const record = this.records.get(id);
			if (!record) return undefined;
			if (record.status !== "running" && record.status !== "queued") return record;
			if (record.promise) await record.promise;
			else await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	setMaxConcurrent(value: number): void {
		this.maxConcurrent = Math.max(1, Math.floor(value));
		this.drainQueue();
	}

	private start(record: SubagentRecord, options: SubagentSpawnOptions, runner: SpawnRunner, signal?: AbortSignal): void {
		if (options.background) this.runningBackground++;
		record.status = "running";
		record.startedAt = Date.now();
		savePersistedSubagentRecord(options.cwd, record);
		record.promise = (async () => {
			try {
				const result = await runner(options, signal);
				record.runId = detailsRunId(result);
				record.result = resultText(result);
				savePersistedSubagentRecord(options.cwd, record);
				if (result.isError) {
					record.status = "error";
					record.error = record.result;
					return;
				}
				if (record.runId) await this.pollRunToTerminal(options.cwd, record);
				else record.status = "completed";
			} catch (error) {
				record.status = "error";
				record.error = error instanceof Error ? error.message : String(error);
			} finally {
				if (options.background) this.runningBackground = Math.max(0, this.runningBackground - 1);
				record.completedAt = record.completedAt ?? Date.now();
				savePersistedSubagentRecord(options.cwd, record);
				this.onComplete?.(record);
				this.drainQueue();
			}
		})();
	}

	private drainQueue(): void {
		while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
			const next = this.queue.shift();
			if (!next || next.record.status !== "queued") continue;
			this.start(next.record, next.options, next.runner, next.signal);
		}
	}

	private async pollRunToTerminal(cwd: string, record: SubagentRecord): Promise<void> {
		while (record.runId && record.status === "running") {
			const loaded = loadRunManifestById(cwd, record.runId);
			if (loaded && TERMINAL_RUN_STATUS.has(loaded.manifest.status)) {
				record.status = loaded.manifest.status === "completed" ? "completed" : loaded.manifest.status === "cancelled" ? "cancelled" : "failed";
				record.error = record.status === "completed" ? undefined : loaded.manifest.summary;
				record.completedAt = Date.now();
				savePersistedSubagentRecord(cwd, record);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
		}
	}
}
