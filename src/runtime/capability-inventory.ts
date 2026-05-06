import type { AgentConfig, ResourceSource } from "../agents/agent-config.ts";
import { discoverAgents } from "../agents/discover-agents.ts";
import { discoverTeams } from "../teams/discover-teams.ts";
import { discoverWorkflows } from "../workflows/discover-workflows.ts";

export type CapabilityKind = "team" | "workflow" | "agent" | "skill" | "tool" | "runtime";
export type CapabilitySource = "builtin" | "project" | "user";
export type CapabilityState = "active" | "disabled" | "shadowed" | "missing";

export interface CapabilityItem {
	id: string;
	kind: CapabilityKind;
	name: string;
	description: string;
	source: CapabilitySource;
	path?: string;
	state: CapabilityState;
	disabledReason?: string;
	shadowedBy?: string;
}

function normalizeAgents(agents: AgentConfig[], source: CapabilitySource): CapabilityItem[] {
	return agents.map((agent) => ({
		id: `agent:${agent.name}`,
		kind: "agent" as const,
		name: agent.name,
		description: agent.description,
		source,
		path: agent.filePath,
		state: agent.disabled ? "disabled" : "active",
		disabledReason: agent.disabled ? "disabled in config" : undefined,
	}));
}

function normalizeTeams(cwd: string): CapabilityItem[] {
	const result = discoverTeams(cwd);
	return [...result.builtin, ...result.user, ...result.project].map((team) => ({
		id: `team:${team.name}`,
		kind: "team" as const,
		name: team.name,
		description: team.description,
		source: team.source as CapabilitySource,
		path: team.filePath,
		state: "active" as const,
	}));
}

function normalizeWorkflows(cwd: string): CapabilityItem[] {
	const result = discoverWorkflows(cwd);
	return [...result.builtin, ...result.user, ...result.project].map((workflow) => ({
		id: `workflow:${workflow.name}`,
		kind: "workflow" as const,
		name: workflow.name,
		description: workflow.description,
		source: workflow.source as CapabilitySource,
		path: workflow.filePath,
		state: "active" as const,
	}));
}

export function buildCapabilityInventory(cwd: string): CapabilityItem[] {
	const agents = discoverAgents(cwd);
	return [
		...normalizeTeams(cwd),
		...normalizeWorkflows(cwd),
		...normalizeAgents([...agents.builtin, ...agents.user, ...agents.project], "builtin"),
	].sort((a, b) => a.id.localeCompare(b.id));
}
