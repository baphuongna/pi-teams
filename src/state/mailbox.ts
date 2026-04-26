import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest } from "./types.ts";

export type MailboxDirection = "inbox" | "outbox";
export type MailboxMessageStatus = "queued" | "delivered" | "acknowledged";

export interface MailboxMessage {
	id: string;
	runId: string;
	direction: MailboxDirection;
	from: string;
	to: string;
	body: string;
	createdAt: string;
	status: MailboxMessageStatus;
	taskId?: string;
	acknowledgedAt?: string;
}

export interface MailboxDeliveryState {
	messages: Record<string, MailboxMessageStatus>;
	updatedAt: string;
}

export interface MailboxValidationIssue {
	level: "error" | "warning";
	path: string;
	message: string;
}

export interface MailboxValidationReport {
	issues: MailboxValidationIssue[];
	repaired: string[];
}

function mailboxDir(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "mailbox");
}

function taskMailboxDir(manifest: TeamRunManifest, taskId: string): string {
	return path.join(mailboxDir(manifest), "tasks", taskId);
}

function mailboxPath(manifest: TeamRunManifest, direction: MailboxDirection, taskId?: string): string {
	return taskId ? path.join(taskMailboxDir(manifest, taskId), `${direction}.jsonl`) : path.join(mailboxDir(manifest), `${direction}.jsonl`);
}

function deliveryPath(manifest: TeamRunManifest): string {
	return path.join(mailboxDir(manifest), "delivery.json");
}

function ensureMailbox(manifest: TeamRunManifest, taskId?: string): void {
	fs.mkdirSync(taskId ? taskMailboxDir(manifest, taskId) : mailboxDir(manifest), { recursive: true });
	for (const direction of ["inbox", "outbox"] as const) {
		const filePath = mailboxPath(manifest, direction, taskId);
		if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf-8");
	}
	fs.mkdirSync(mailboxDir(manifest), { recursive: true });
	const delivery = deliveryPath(manifest);
	if (!fs.existsSync(delivery)) fs.writeFileSync(delivery, `${JSON.stringify({ messages: {}, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
}

function isDirection(value: unknown): value is MailboxDirection {
	return value === "inbox" || value === "outbox";
}

function isStatus(value: unknown): value is MailboxMessageStatus {
	return value === "queued" || value === "delivered" || value === "acknowledged";
}

function parseMailboxMessage(raw: unknown, expectedDirection: MailboxDirection): MailboxMessage | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== "string" || typeof obj.runId !== "string" || !isDirection(obj.direction) || typeof obj.from !== "string" || typeof obj.to !== "string" || typeof obj.body !== "string" || typeof obj.createdAt !== "string" || !isStatus(obj.status)) return undefined;
	if (obj.direction !== expectedDirection) return undefined;
	return { id: obj.id, runId: obj.runId, direction: obj.direction, from: obj.from, to: obj.to, body: obj.body, createdAt: obj.createdAt, status: obj.status, taskId: typeof obj.taskId === "string" ? obj.taskId : undefined, acknowledgedAt: typeof obj.acknowledgedAt === "string" ? obj.acknowledgedAt : undefined };
}

function readMailboxFile(filePath: string, direction: MailboxDirection): MailboxMessage[] {
	if (!fs.existsSync(filePath)) return [];
	const messages: MailboxMessage[] = [];
	const raw = fs.readFileSync(filePath, "utf-8");
	for (const line of raw.split(/\r?\n/).filter(Boolean)) {
		try {
			const message = parseMailboxMessage(JSON.parse(line) as unknown, direction);
			if (message) messages.push(message);
		} catch {
			// Invalid mailbox lines are reported by validateMailbox().
		}
	}
	return messages;
}

export function readMailbox(manifest: TeamRunManifest, direction?: MailboxDirection, taskId?: string): MailboxMessage[] {
	ensureMailbox(manifest, taskId);
	const directions = direction ? [direction] : ["inbox", "outbox"] as const;
	const messages = directions.flatMap((item) => readMailboxFile(mailboxPath(manifest, item, taskId), item));
	return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function readDeliveryState(manifest: TeamRunManifest): MailboxDeliveryState {
	ensureMailbox(manifest);
	try {
		const raw = JSON.parse(fs.readFileSync(deliveryPath(manifest), "utf-8")) as unknown;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid delivery state.");
		const obj = raw as Record<string, unknown>;
		const messages: Record<string, MailboxMessageStatus> = {};
		if (obj.messages && typeof obj.messages === "object" && !Array.isArray(obj.messages)) {
			for (const [id, status] of Object.entries(obj.messages)) if (isStatus(status)) messages[id] = status;
		}
		return { messages, updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString() };
	} catch {
		return { messages: {}, updatedAt: new Date().toISOString() };
	}
}

function writeDeliveryState(manifest: TeamRunManifest, state: MailboxDeliveryState): void {
	ensureMailbox(manifest);
	fs.writeFileSync(deliveryPath(manifest), `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function appendMailboxMessage(manifest: TeamRunManifest, message: Omit<MailboxMessage, "id" | "runId" | "createdAt" | "status"> & { id?: string; status?: MailboxMessageStatus }): MailboxMessage {
	ensureMailbox(manifest, message.taskId);
	const createdAt = new Date().toISOString();
	const complete: MailboxMessage = {
		id: message.id ?? `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
		runId: manifest.runId,
		direction: message.direction,
		from: message.from,
		to: message.to,
		body: message.body,
		createdAt,
		status: message.status ?? "queued",
		taskId: message.taskId,
	};
	fs.appendFileSync(mailboxPath(manifest, complete.direction, complete.taskId), `${JSON.stringify(complete)}\n`, "utf-8");
	const delivery = readDeliveryState(manifest);
	delivery.messages[complete.id] = complete.status;
	delivery.updatedAt = createdAt;
	writeDeliveryState(manifest, delivery);
	return complete;
}

export function acknowledgeMailboxMessage(manifest: TeamRunManifest, messageId: string): MailboxDeliveryState {
	const delivery = readDeliveryState(manifest);
	if (!delivery.messages[messageId]) throw new Error(`Mailbox message '${messageId}' not found.`);
	delivery.messages[messageId] = "acknowledged";
	delivery.updatedAt = new Date().toISOString();
	writeDeliveryState(manifest, delivery);
	return delivery;
}

export function validateMailbox(manifest: TeamRunManifest, options: { repair?: boolean } = {}): MailboxValidationReport {
	ensureMailbox(manifest);
	const issues: MailboxValidationIssue[] = [];
	const repaired: string[] = [];
	for (const direction of ["inbox", "outbox"] as const) {
		const filePath = mailboxPath(manifest, direction);
		const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
		const validLines: string[] = [];
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as unknown;
				const message = parseMailboxMessage(parsed, direction);
				if (!message) throw new Error("invalid message schema");
				validLines.push(JSON.stringify(message));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				issues.push({ level: "error", path: filePath, message });
			}
		}
		if (options.repair && validLines.length !== lines.length) {
			fs.writeFileSync(filePath, `${validLines.join("\n")}${validLines.length ? "\n" : ""}`, "utf-8");
			repaired.push(filePath);
		}
	}
	const delivery = readDeliveryState(manifest);
	const allMessages = readMailbox(manifest);
	for (const message of allMessages) if (!delivery.messages[message.id]) issues.push({ level: "warning", path: deliveryPath(manifest), message: `Missing delivery entry for ${message.id}.` });
	if (options.repair) {
		for (const message of allMessages) delivery.messages[message.id] ??= message.status;
		delivery.updatedAt = new Date().toISOString();
		writeDeliveryState(manifest, delivery);
		repaired.push(deliveryPath(manifest));
	}
	return { issues, repaired };
}
