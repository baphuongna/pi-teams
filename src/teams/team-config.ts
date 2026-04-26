import type { ResourceSource, RoutingMetadata } from "../agents/agent-config.ts";

export interface TeamRole {
	name: string;
	agent: string;
	description?: string;
	model?: string;
	skills?: string[] | false;
	maxConcurrency?: number;
}

export interface TeamConfig {
	name: string;
	description: string;
	source: ResourceSource;
	filePath: string;
	roles: TeamRole[];
	defaultWorkflow?: string;
	workspaceMode?: "single" | "worktree";
	maxConcurrency?: number;
	routing?: RoutingMetadata;
}
