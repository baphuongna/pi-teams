import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readCrewAgents, agentsPath, agentOutputPath } from "../runtime/crew-agent-records.ts";
import type { CrewAgentRecord } from "../runtime/crew-agent-runtime.ts";
import { isActiveRunStatus } from "../runtime/process-status.ts";
import { readEvents, type TeamEvent } from "../state/event-log.ts";
import type { MailboxMessageStatus } from "../state/mailbox.ts";
import { loadRunManifestById } from "../state/state-store.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import type { RunSnapshotCache, RunUiGroupJoin, RunUiMailbox, RunUiProgress, RunUiSnapshot, RunUiUsage } from "./snapshot-types.ts";

const DEFAULT_TTL_MS = 250;
const DEFAULT_MAX_ENTRIES = 24;
const DEFAULT_RECENT_EVENTS = 20;
const DEFAULT_RECENT_OUTPUT_LINES = 20;
const MAX_TAIL_BYTES = 32 * 1024;

interface FileStamp {
	mtimeMs: number;
	size: number;
}

interface SnapshotStamps {
	manifest: FileStamp;
	tasks: FileStamp;
	agents: FileStamp;
	events: FileStamp;
	mailbox: FileStamp;
	output: FileStamp;
}

interface CacheEntry {
	snapshot: RunUiSnapshot;
	stamps: SnapshotStamps;
	loadedAtMs: number;
	lastAccessMs: number;
}

export interface RunSnapshotCacheOptions {
	ttlMs?: number;
	maxEntries?: number;
	recentEvents?: number;
	recentOutputLines?: number;
}

function zeroStamp(): FileStamp {
	return { mtimeMs: 0, size: 0 };
}

function stampFile(filePath: string | undefined): FileStamp {
	if (!filePath) return zeroStamp();
	try {
		const stat = fs.statSync(filePath);
		return { mtimeMs: stat.mtimeMs, size: stat.size };
	} catch {
		return zeroStamp();
	}
}

function combineStamps(stamps: FileStamp[]): FileStamp {
	return stamps.reduce((acc, stamp) => ({ mtimeMs: Math.max(acc.mtimeMs, stamp.mtimeMs), size: acc.size + stamp.size }), zeroStamp());
}

function mailboxStamp(manifest: TeamRunManifest): FileStamp {
	const root = path.join(manifest.stateRoot, "mailbox");
	const stamps: FileStamp[] = [
		stampFile(path.join(root, "inbox.jsonl")),
		stampFile(path.join(root, "outbox.jsonl")),
		stampFile(path.join(root, "delivery.json")),
	];
	const tasksRoot = path.join(root, "tasks");
	try {
		for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			stamps.push(stampFile(path.join(tasksRoot, entry.name, "inbox.jsonl")));
			stamps.push(stampFile(path.join(tasksRoot, entry.name, "outbox.jsonl")));
		}
	} catch {
		// No task mailbox yet.
	}
	return combineStamps(stamps);
}

function safeAgentOutputPath(manifest: TeamRunManifest, agent: CrewAgentRecord): string | undefined {
	try {
		return agentOutputPath(manifest, agent.taskId);
	} catch {
		return undefined;
	}
}

function outputStamp(manifest: TeamRunManifest, agents: CrewAgentRecord[]): FileStamp {
	return combineStamps(agents.map((agent) => stampFile(safeAgentOutputPath(manifest, agent))));
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
	return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function sameStamps(a: SnapshotStamps, b: SnapshotStamps): boolean {
	return sameStamp(a.manifest, b.manifest)
		&& sameStamp(a.tasks, b.tasks)
		&& sameStamp(a.agents, b.agents)
		&& sameStamp(a.events, b.events)
		&& sameStamp(a.mailbox, b.mailbox)
		&& sameStamp(a.output, b.output);
}

function readTasks(tasksPath: string): TeamTaskState[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(tasksPath, "utf-8")) as unknown;
		return Array.isArray(parsed) ? (parsed as TeamTaskState[]) : [];
	} catch {
		throw new Error(`Failed to parse tasks at ${tasksPath}`);
	}
}

function safeRecentEvents(eventsPath: string, limit: number): TeamEvent[] {
	try {
		return readEvents(eventsPath).slice(-limit);
	} catch {
		return [];
	}
}

function tailLines(filePath: string, limit: number): string[] {
	if (limit <= 0) return [];
	try {
		const stat = fs.statSync(filePath);
		const bytesToRead = Math.min(stat.size, MAX_TAIL_BYTES);
		const fd = fs.openSync(filePath, "r");
		try {
			const buffer = Buffer.alloc(bytesToRead);
			fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
			return buffer.toString("utf-8").split(/\r?\n/).filter(Boolean).slice(-limit);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return [];
	}
}

function recentOutputLines(manifest: TeamRunManifest, agents: CrewAgentRecord[], limit: number): string[] {
	const fromProgress = agents.flatMap((agent) => agent.progress?.recentOutput ?? []);
	const fromFiles = agents.flatMap((agent) => {
		const outputPath = safeAgentOutputPath(manifest, agent);
		return outputPath ? tailLines(outputPath, limit) : [];
	});
	return [...fromProgress, ...fromFiles].map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).slice(-limit);
}

function progressFromTasks(tasks: TeamTaskState[]): RunUiProgress {
	return {
		total: tasks.length,
		completed: tasks.filter((task) => task.status === "completed").length,
		running: tasks.filter((task) => task.status === "running").length,
		failed: tasks.filter((task) => task.status === "failed").length,
		queued: tasks.filter((task) => task.status === "queued").length,
	};
}

function usageFrom(tasks: TeamTaskState[], agents: CrewAgentRecord[]): RunUiUsage {
	const taskUsage = tasks.reduce((acc, task) => {
		acc.tokensIn += task.usage?.input ?? 0;
		acc.tokensOut += task.usage?.output ?? 0;
		acc.toolUses += task.agentProgress?.toolCount ?? 0;
		return acc;
	}, { tokensIn: 0, tokensOut: 0, toolUses: 0 });
	if (taskUsage.tokensIn || taskUsage.tokensOut || taskUsage.toolUses) return taskUsage;
	return agents.reduce((acc, agent) => {
		acc.tokensIn += agent.usage?.input ?? 0;
		acc.tokensOut += agent.usage?.output ?? agent.progress?.tokens ?? 0;
		acc.toolUses += agent.toolUses ?? agent.progress?.toolCount ?? 0;
		return acc;
	}, { tokensIn: 0, tokensOut: 0, toolUses: 0 });
}

function isMailboxStatus(value: unknown): value is MailboxMessageStatus {
	return value === "queued" || value === "delivered" || value === "acknowledged";
}

function readDeliveryMessages(filePath: string): Record<string, MailboxMessageStatus> {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const messages = (parsed as { messages?: unknown }).messages;
		if (!messages || typeof messages !== "object" || Array.isArray(messages)) return {};
		const output: Record<string, MailboxMessageStatus> = {};
		for (const [id, status] of Object.entries(messages)) if (isMailboxStatus(status)) output[id] = status;
		return output;
	} catch {
		return {};
	}
}

function readGroupJoinMailbox(filePath: string, delivery: Record<string, MailboxMessageStatus>): RunUiGroupJoin[] {
	try {
		return fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
			try {
				const parsed = JSON.parse(line) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
				const message = parsed as { id?: unknown; data?: unknown };
				const data = message.data && typeof message.data === "object" && !Array.isArray(message.data) ? message.data as Record<string, unknown> : undefined;
				if (typeof message.id !== "string" || data?.kind !== "group_join" || typeof data.requestId !== "string") return [];
				return [{ requestId: data.requestId, messageId: message.id, partial: data.partial === true, ack: delivery[message.id] === "acknowledged" ? "acknowledged" as const : "pending" as const }];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

function readMailboxCounts(filePath: string, delivery: Record<string, MailboxMessageStatus>): number {
	try {
		return fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean).reduce((count, line) => {
			try {
				const parsed = JSON.parse(line) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return count;
				const message = parsed as { id?: unknown; status?: unknown };
				if (typeof message.id !== "string" || !isMailboxStatus(message.status)) return count;
				return message.status !== "acknowledged" && delivery[message.id] !== "acknowledged" ? count + 1 : count;
			} catch {
				return count;
			}
		}, 0);
	} catch {
		return 0;
	}
}

function groupJoinsFrom(manifest: TeamRunManifest): RunUiGroupJoin[] {
	const root = path.join(manifest.stateRoot, "mailbox");
	const delivery = readDeliveryMessages(path.join(root, "delivery.json"));
	return readGroupJoinMailbox(path.join(root, "outbox.jsonl"), delivery).slice(-5);
}

function mailboxFrom(manifest: TeamRunManifest, agents: CrewAgentRecord[]): RunUiMailbox {
	const root = path.join(manifest.stateRoot, "mailbox");
	const delivery = readDeliveryMessages(path.join(root, "delivery.json"));
	let inboxUnread = readMailboxCounts(path.join(root, "inbox.jsonl"), delivery);
	let outboxPending = readMailboxCounts(path.join(root, "outbox.jsonl"), delivery);
	const tasksRoot = path.join(root, "tasks");
	try {
		for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			inboxUnread += readMailboxCounts(path.join(tasksRoot, entry.name, "inbox.jsonl"), delivery);
			outboxPending += readMailboxCounts(path.join(tasksRoot, entry.name, "outbox.jsonl"), delivery);
		}
	} catch {
		// No task mailboxes yet.
	}
	const attentionAgents = agents.filter((agent) => agent.progress?.activityState === "needs_attention").length;
	return { inboxUnread, outboxPending, needsAttention: inboxUnread + attentionAgents };
}

function signatureFor(input: Omit<RunUiSnapshot, "signature" | "fetchedAt">, stamps: SnapshotStamps): string {
	const digest = createHash("sha256");
	digest.update(JSON.stringify({
		run: [input.manifest.runId, input.manifest.status, input.manifest.updatedAt, input.manifest.artifacts.length],
		tasks: input.tasks.map((task) => [task.id, task.status, task.startedAt, task.finishedAt, task.agentProgress, task.usage]),
		agents: input.agents.map((agent) => [agent.id, agent.status, agent.startedAt, agent.completedAt, agent.toolUses, agent.progress, agent.usage, agent.model]),
		progress: input.progress,
		usage: input.usage,
		mailbox: input.mailbox,
		groupJoins: input.groupJoins,
		events: input.recentEvents.map((event) => [event.metadata?.seq, event.time, event.type, event.taskId, event.message]),
		output: input.recentOutputLines,
		stamps,
	}));
	return digest.digest("hex").slice(0, 16);
}

function stampsFor(manifest: TeamRunManifest, agents: CrewAgentRecord[]): SnapshotStamps {
	return {
		manifest: stampFile(path.join(manifest.stateRoot, "manifest.json")),
		tasks: stampFile(manifest.tasksPath),
		agents: stampFile(agentsPath(manifest)),
		events: stampFile(manifest.eventsPath),
		mailbox: mailboxStamp(manifest),
		output: outputStamp(manifest, agents),
	};
}

export function createRunSnapshotCache(cwd: string, options: RunSnapshotCacheOptions = {}): RunSnapshotCache {
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const recentEventsLimit = options.recentEvents ?? DEFAULT_RECENT_EVENTS;
	const recentOutputLimit = options.recentOutputLines ?? DEFAULT_RECENT_OUTPUT_LINES;
	const entries = new Map<string, CacheEntry>();

	function touch(runId: string, entry: CacheEntry): RunUiSnapshot {
		entry.lastAccessMs = Date.now();
		if (entries.has(runId)) {
			entries.delete(runId);
			entries.set(runId, entry);
		}
		return entry.snapshot;
	}

	function evictIfNeeded(): void {
		while (entries.size > maxEntries) {
			const oldestInactive = [...entries.entries()].find(([, entry]) => !isActiveRunStatus(entry.snapshot.manifest.status));
			const key = oldestInactive?.[0] ?? entries.keys().next().value;
			if (!key) break;
			entries.delete(key);
		}
	}

	function build(runId: string, previous?: CacheEntry): CacheEntry {
		let loaded: ReturnType<typeof loadRunManifestById>;
		try {
			loaded = loadRunManifestById(cwd, runId);
		} catch {
			if (previous) return previous;
			throw new Error(`Run '${runId}' could not be parsed.`);
		}
		if (!loaded) {
			if (previous) return previous;
			throw new Error(`Run '${runId}' not found.`);
		}
		let tasks: TeamTaskState[];
		let agents: CrewAgentRecord[];
		try {
			tasks = readTasks(loaded.manifest.tasksPath);
			agents = readCrewAgents(loaded.manifest);
		} catch {
			if (previous) return previous;
			throw new Error(`Run '${runId}' could not be parsed.`);
		}
		const mailbox = mailboxFrom(loaded.manifest, agents);
		const groupJoins = groupJoinsFrom(loaded.manifest);
		const base = {
			runId: loaded.manifest.runId,
			cwd: loaded.manifest.cwd,
			manifest: loaded.manifest,
			tasks,
			agents,
			progress: progressFromTasks(tasks),
			usage: usageFrom(tasks, agents),
			mailbox,
			groupJoins,
			recentEvents: safeRecentEvents(loaded.manifest.eventsPath, recentEventsLimit),
			recentOutputLines: recentOutputLines(loaded.manifest, agents, recentOutputLimit),
		};
		const stamps = stampsFor(loaded.manifest, agents);
		const snapshot: RunUiSnapshot = { ...base, fetchedAt: Date.now(), signature: signatureFor(base, stamps) };
		return { snapshot, stamps, loadedAtMs: snapshot.fetchedAt, lastAccessMs: snapshot.fetchedAt };
	}

	function currentStamps(previous: CacheEntry): SnapshotStamps {
		const manifest = previous.snapshot.manifest;
		return {
			manifest: stampFile(path.join(manifest.stateRoot, "manifest.json")),
			tasks: stampFile(manifest.tasksPath),
			agents: stampFile(agentsPath(manifest)),
			events: stampFile(manifest.eventsPath),
			mailbox: mailboxStamp(manifest),
			output: outputStamp(previous.snapshot.manifest, previous.snapshot.agents),
		};
	}

	return {
		get(runId: string): RunUiSnapshot | undefined {
			const entry = entries.get(runId);
			return entry ? touch(runId, entry) : undefined;
		},
		refresh(runId: string): RunUiSnapshot {
			const previous = entries.get(runId);
			const entry = build(runId, previous);
			entries.set(runId, entry);
			evictIfNeeded();
			return entry.snapshot;
		},
		refreshIfStale(runId: string): RunUiSnapshot {
			const previous = entries.get(runId);
			if (!previous) return this.refresh(runId);
			const now = Date.now();
			if (now - previous.loadedAtMs < ttlMs) return touch(runId, previous);
			const stamps = currentStamps(previous);
			if (sameStamps(stamps, previous.stamps)) return touch(runId, previous);
			return this.refresh(runId);
		},
		invalidate(runId?: string): void {
			if (runId) entries.delete(runId);
			else entries.clear();
		},
		snapshotsByKey(): Map<string, RunUiSnapshot> {
			return new Map([...entries.entries()].map(([key, entry]) => [key, entry.snapshot]));
		},
		dispose(): void {
			entries.clear();
		},
	};
}
