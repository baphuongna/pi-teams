import type { AgentConfig } from "../../agents/agent-config.ts";
import type { CrewRuntimeKind } from "../crew-agent-runtime.ts";

export interface WorkerCapabilityInventory {
	schemaVersion: 1;
	taskId: string;
	role: string;
	agent: string;
	runtime: CrewRuntimeKind;
	permissionMode: string;
	tools: string[];
	extensions: string[];
	skills: {
		names: string[];
		paths: string[];
		disabled: boolean;
	};
	model: {
		requested?: string;
		agentDefault?: string;
		fallbacks: string[];
		teamRole?: string;
		step?: string;
	};
	inheritance: {
		projectContext: boolean;
		skills: boolean;
		systemPromptMode: "replace" | "append";
	};
}

export interface BuildWorkerCapabilityInventoryInput {
	taskId: string;
	role: string;
	agent: AgentConfig;
	runtime: CrewRuntimeKind;
	permissionMode: string;
	skillNames?: string[];
	skillPaths?: string[];
	skillsDisabled: boolean;
	modelOverride?: string;
	teamRoleModel?: string;
	stepModel?: string;
}

function uniqueSorted(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildWorkerCapabilityInventory(input: BuildWorkerCapabilityInventoryInput): WorkerCapabilityInventory {
	return {
		schemaVersion: 1,
		taskId: input.taskId,
		role: input.role,
		agent: input.agent.name,
		runtime: input.runtime,
		permissionMode: input.permissionMode,
		tools: uniqueSorted(input.agent.tools),
		extensions: uniqueSorted(input.agent.extensions),
		skills: {
			names: uniqueSorted(input.skillNames),
			paths: uniqueSorted(input.skillPaths),
			disabled: input.skillsDisabled,
		},
		model: {
			requested: input.modelOverride,
			agentDefault: input.agent.model,
			fallbacks: uniqueSorted(input.agent.fallbackModels),
			teamRole: input.teamRoleModel,
			step: input.stepModel,
		},
		inheritance: {
			projectContext: input.agent.inheritProjectContext === true,
			skills: input.agent.inheritSkills === true,
			systemPromptMode: input.agent.systemPromptMode ?? "replace",
		},
	};
}
