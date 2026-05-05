import type { CrewAgentRecord } from "./crew-agent-runtime.ts";

type LiveSessionHandle = {
	steer?: (text: string) => Promise<void>;
	prompt?: (text: string, options?: Record<string, unknown>) => Promise<void>;
	abort?: () => Promise<void> | void;
};

export interface LiveAgentHandle {
	agentId: string;
	taskId: string;
	runId: string;
	session: LiveSessionHandle;
	createdAt: string;
	updatedAt: string;
	status: CrewAgentRecord["status"];
	pendingSteers: string[];
	pendingFollowUps: string[];
}

const liveAgents = new Map<string, LiveAgentHandle>();

export function registerLiveAgent(input: Omit<LiveAgentHandle, "createdAt" | "updatedAt" | "pendingSteers" | "pendingFollowUps">): LiveAgentHandle {
	const now = new Date().toISOString();
	const existing = liveAgents.get(input.agentId);
	const handle: LiveAgentHandle = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now, pendingSteers: existing?.pendingSteers ?? [], pendingFollowUps: existing?.pendingFollowUps ?? [] };
	liveAgents.set(input.agentId, handle);
	if (handle.pendingSteers.length && typeof handle.session.steer === "function") {
		const pending = [...handle.pendingSteers];
		handle.pendingSteers.length = 0;
		for (const message of pending) void handle.session.steer(message).catch(() => {});
	}
	if (handle.pendingFollowUps.length && typeof handle.session.prompt === "function") {
		const pending = [...handle.pendingFollowUps];
		handle.pendingFollowUps.length = 0;
		for (const message of pending) void handle.session.prompt(message, { source: "api", expandPromptTemplates: false }).catch(() => {});
	}
	return handle;
}

export function updateLiveAgentStatus(agentId: string, status: CrewAgentRecord["status"]): void {
	const handle = liveAgents.get(agentId);
	if (!handle) return;
	handle.status = status;
	handle.updatedAt = new Date().toISOString();
}

export function getLiveAgent(agentIdOrTaskId: string): LiveAgentHandle | undefined {
	return liveAgents.get(agentIdOrTaskId) ?? [...liveAgents.values()].find((entry) => entry.taskId === agentIdOrTaskId);
}

export function listLiveAgents(): LiveAgentHandle[] {
	return [...liveAgents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function steerLiveAgent(agentIdOrTaskId: string, message: string): Promise<LiveAgentHandle> {
	const handle = getLiveAgent(agentIdOrTaskId);
	if (!handle) throw new Error(`Live agent '${agentIdOrTaskId}' is not registered in this process.`);
	if (typeof handle.session.steer !== "function") {
		handle.pendingSteers.push(message);
		return handle;
	}
	await handle.session.steer(message);
	handle.updatedAt = new Date().toISOString();
	return handle;
}

export async function followUpLiveAgent(agentIdOrTaskId: string, prompt: string): Promise<LiveAgentHandle> {
	const handle = getLiveAgent(agentIdOrTaskId);
	if (!handle) throw new Error(`Live agent '${agentIdOrTaskId}' is not registered in this process.`);
	if (typeof handle.session.prompt !== "function") {
		handle.pendingFollowUps.push(prompt);
		return handle;
	}
	await handle.session.prompt(prompt, { source: "api", expandPromptTemplates: false });
	handle.updatedAt = new Date().toISOString();
	return handle;
}

export async function stopLiveAgent(agentIdOrTaskId: string): Promise<LiveAgentHandle> {
	const handle = getLiveAgent(agentIdOrTaskId);
	if (!handle) throw new Error(`Live agent '${agentIdOrTaskId}' is not registered in this process.`);
	if (typeof handle.session.abort !== "function") throw new Error(`Live agent '${agentIdOrTaskId}' does not expose abort().`);
	await handle.session.abort();
	handle.status = "stopped";
	handle.updatedAt = new Date().toISOString();
	return handle;
}

export async function resumeLiveAgent(agentIdOrTaskId: string, prompt: string): Promise<LiveAgentHandle> {
	const handle = getLiveAgent(agentIdOrTaskId);
	if (!handle) throw new Error(`Live agent '${agentIdOrTaskId}' is not registered in this process.`);
	if (typeof handle.session.prompt !== "function") throw new Error(`Live agent '${agentIdOrTaskId}' does not expose prompt().`);
	handle.status = "running";
	await handle.session.prompt(prompt, { source: "api", expandPromptTemplates: false });
	handle.status = "completed";
	handle.updatedAt = new Date().toISOString();
	return handle;
}

export function clearLiveAgentsForTest(): void {
	liveAgents.clear();
}
