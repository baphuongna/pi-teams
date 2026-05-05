import type { ResourceSource } from "../agents/agent-config.ts";

export interface WorkflowStep {
	id: string;
	role: string;
	task: string;
	dependsOn?: string[];
	parallelGroup?: string;
	output?: string | false;
	reads?: string[] | false;
	model?: string;
	/** Additional skills for this step; false disables role-default injected skills for this step. */
	skills?: string[] | false;
	progress?: boolean;
	worktree?: boolean;
	verify?: boolean;
}

export interface WorkflowConfig {
	name: string;
	description: string;
	source: ResourceSource;
	filePath: string;
	steps: WorkflowStep[];
	maxConcurrency?: number;
}
