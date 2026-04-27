import type { PiTeamsConfig } from "../config/config.ts";
import type { TeamRunManifest } from "../state/types.ts";
import { appendEvent } from "../state/event-log.ts";
import type { CrewAgentRecord } from "./crew-agent-runtime.ts";
import { upsertCrewAgent } from "./crew-agent-records.ts";

export interface CrewControlConfig {
	enabled: boolean;
	needsAttentionAfterMs: number;
}

const DEFAULT_NEEDS_ATTENTION_MS = 60_000;

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function resolveCrewControlConfig(config: PiTeamsConfig | undefined): CrewControlConfig {
	const raw = config as PiTeamsConfig & { control?: { enabled?: unknown; needsAttentionAfterMs?: unknown } } | undefined;
	return {
		enabled: raw?.control?.enabled === false ? false : true,
		needsAttentionAfterMs: positiveInt(raw?.control?.needsAttentionAfterMs) ?? DEFAULT_NEEDS_ATTENTION_MS,
	};
}

export function activityAgeMs(agent: CrewAgentRecord, now = Date.now()): number | undefined {
	const timestamp = agent.progress?.lastActivityAt ?? agent.startedAt;
	if (!timestamp) return undefined;
	const ms = now - new Date(timestamp).getTime();
	return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

export function formatActivityAge(agent: CrewAgentRecord, now = Date.now()): string | undefined {
	const age = activityAgeMs(agent, now);
	if (age === undefined) return undefined;
	if (age < 1000) return "active now";
	const seconds = Math.floor(age / 1000);
	if (seconds < 60) return agent.progress?.activityState === "needs_attention" ? `no activity for ${seconds}s` : `active ${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	return agent.progress?.activityState === "needs_attention" ? `no activity for ${minutes}m` : `active ${minutes}m ago`;
}

export function applyAttentionState(manifest: TeamRunManifest, agent: CrewAgentRecord, config: CrewControlConfig, now = Date.now()): CrewAgentRecord {
	if (!config.enabled || agent.status !== "running") return agent;
	const age = activityAgeMs(agent, now);
	if (age === undefined || age <= config.needsAttentionAfterMs) return agent;
	if (agent.progress?.activityState === "needs_attention") return agent;
	const updated: CrewAgentRecord = {
		...agent,
		progress: {
			...(agent.progress ?? { recentTools: [], recentOutput: [], toolCount: agent.toolUses ?? 0 }),
			activityState: "needs_attention",
		},
	};
	upsertCrewAgent(manifest, updated);
	appendEvent(manifest.eventsPath, {
		type: "agent.needs_attention",
		runId: manifest.runId,
		taskId: agent.taskId,
		message: `${agent.agent} needs attention (no observed activity for ${Math.floor(age / 1000)}s).`,
		data: { agentId: agent.id, ageMs: age, needsAttentionAfterMs: config.needsAttentionAfterMs },
	});
	return updated;
}
