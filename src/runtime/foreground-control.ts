import * as fs from "node:fs";
import * as path from "node:path";
import { appendEvent } from "../state/event-log.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { checkProcessLiveness, isActiveRunStatus } from "./process-status.ts";
import { readCrewAgents } from "./crew-agent-records.ts";

export type ForegroundControlRequestType = "interrupt" | "status";

export interface ForegroundControlStatus {
	runId: string;
	status: TeamRunManifest["status"];
	active: boolean;
	asyncPid?: number;
	asyncAlive?: boolean;
	runningTasks: string[];
	runningAgents: string[];
	controlPath: string;
	lastRequest?: ForegroundControlRequest;
}

export interface ForegroundControlRequest {
	id: string;
	type: ForegroundControlRequestType;
	createdAt: string;
	reason: string;
	acknowledged: boolean;
}

export function foregroundControlPath(manifest: TeamRunManifest): string {
	return path.join(manifest.stateRoot, "foreground-control.json");
}

function readLastRequest(controlPath: string): ForegroundControlRequest | undefined {
	if (!fs.existsSync(controlPath)) return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(controlPath, "utf-8")) as { requests?: ForegroundControlRequest[] };
		return parsed.requests?.at(-1);
	} catch {
		return undefined;
	}
}

export function readForegroundControlStatus(manifest: TeamRunManifest, tasks: TeamTaskState[]): ForegroundControlStatus {
	const controlPath = foregroundControlPath(manifest);
	const asyncAlive = manifest.async?.pid !== undefined ? checkProcessLiveness(manifest.async.pid).alive : undefined;
	return {
		runId: manifest.runId,
		status: manifest.status,
		active: isActiveRunStatus(manifest.status),
		asyncPid: manifest.async?.pid,
		asyncAlive,
		runningTasks: tasks.filter((task) => task.status === "running").map((task) => task.id),
		runningAgents: readCrewAgents(manifest).filter((agent) => agent.status === "running").map((agent) => agent.id),
		controlPath,
		lastRequest: readLastRequest(controlPath),
	};
}

export function writeForegroundInterruptRequest(manifest: TeamRunManifest, reason = "User requested foreground interrupt."): ForegroundControlRequest {
	const controlPath = foregroundControlPath(manifest);
	let requests: ForegroundControlRequest[] = [];
	if (fs.existsSync(controlPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(controlPath, "utf-8")) as { requests?: ForegroundControlRequest[] };
			requests = Array.isArray(parsed.requests) ? parsed.requests : [];
		} catch {
			requests = [];
		}
	}
	const request: ForegroundControlRequest = {
		id: `fg_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`,
		type: "interrupt",
		createdAt: new Date().toISOString(),
		reason,
		acknowledged: false,
	};
	fs.mkdirSync(path.dirname(controlPath), { recursive: true });
	fs.writeFileSync(controlPath, `${JSON.stringify({ requests: [...requests, request] }, null, 2)}\n`, "utf-8");
	appendEvent(manifest.eventsPath, { type: "foreground.interrupt_requested", runId: manifest.runId, message: reason, data: { requestId: request.id, controlPath } });
	return request;
}
