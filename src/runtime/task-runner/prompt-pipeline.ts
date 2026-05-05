import * as path from "node:path";
import type { ArtifactDescriptor } from "../../state/types.ts";

export type WorkerPromptPipelineStageName =
	| "task-packet-built"
	| "dependency-context-collected"
	| "skills-rendered-or-disabled"
	| "capability-inventory-recorded"
	| "coordination-bridge-attached"
	| "prompt-rendered"
	| "prompt-artifact-written";

export interface WorkerPromptPipelineStage {
	name: WorkerPromptPipelineStageName;
	references: string[];
	details?: Record<string, string | number | boolean>;
}

export interface WorkerPromptPipelineArtifact {
	schemaVersion: 1;
	taskId: string;
	stages: WorkerPromptPipelineStage[];
}

function artifactReference(artifactsRoot: string, artifact?: ArtifactDescriptor): string | undefined {
	if (!artifact) return undefined;
	const root = path.resolve(artifactsRoot);
	const target = path.resolve(artifact.path);
	const relative = path.relative(root, target);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return relative.replaceAll("\\", "/");
}

export interface BuildWorkerPromptPipelineInput {
	artifactsRoot: string;
	taskId: string;
	promptArtifact: ArtifactDescriptor;
	inputsArtifact: ArtifactDescriptor;
	skillArtifact?: ArtifactDescriptor;
	capabilityArtifact: ArtifactDescriptor;
	coordinationArtifact: ArtifactDescriptor;
	skillInstructionCount: number;
	skillsDisabled: boolean;
}

export function buildWorkerPromptPipeline(input: BuildWorkerPromptPipelineInput): WorkerPromptPipelineArtifact {
	return {
		schemaVersion: 1,
		taskId: input.taskId,
		stages: [
			{ name: "task-packet-built", references: [`metadata/${input.taskId}.task-packet.json`] },
			{ name: "dependency-context-collected", references: [artifactReference(input.artifactsRoot, input.inputsArtifact) ?? `metadata/${input.taskId}.inputs.json`] },
			{
				name: "skills-rendered-or-disabled",
				references: input.skillArtifact ? [artifactReference(input.artifactsRoot, input.skillArtifact) ?? `metadata/${input.taskId}.skills.md`] : [],
				details: { disabled: input.skillsDisabled, skillInstructionCount: input.skillInstructionCount },
			},
			{ name: "capability-inventory-recorded", references: [artifactReference(input.artifactsRoot, input.capabilityArtifact) ?? `metadata/${input.taskId}.capabilities.json`] },
			{ name: "coordination-bridge-attached", references: [artifactReference(input.artifactsRoot, input.coordinationArtifact) ?? `metadata/${input.taskId}.coordination-bridge.md`] },
			{ name: "prompt-rendered", references: [] },
			{ name: "prompt-artifact-written", references: [artifactReference(input.artifactsRoot, input.promptArtifact) ?? `prompts/${input.taskId}.md`] },
		],
	};
}
