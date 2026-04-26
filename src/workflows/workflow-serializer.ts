import type { WorkflowConfig, WorkflowStep } from "./workflow-config.ts";

function serializeStep(step: WorkflowStep): string[] {
	const lines = [`## ${step.id}`, `role: ${step.role}`];
	if (step.dependsOn?.length) lines.push(`dependsOn: ${step.dependsOn.join(", ")}`);
	if (step.parallelGroup) lines.push(`parallelGroup: ${step.parallelGroup}`);
	if (step.output === false) lines.push("output: false");
	else if (step.output) lines.push(`output: ${step.output}`);
	if (step.reads === false) lines.push("reads: false");
	else if (Array.isArray(step.reads) && step.reads.length > 0) lines.push(`reads: ${step.reads.join(", ")}`);
	if (step.model) lines.push(`model: ${step.model}`);
	if (step.skills === false) lines.push("skills: false");
	else if (Array.isArray(step.skills) && step.skills.length > 0) lines.push(`skills: ${step.skills.join(", ")}`);
	if (step.progress !== undefined) lines.push(`progress: ${step.progress ? "true" : "false"}`);
	if (step.worktree !== undefined) lines.push(`worktree: ${step.worktree ? "true" : "false"}`);
	if (step.verify !== undefined) lines.push(`verify: ${step.verify ? "true" : "false"}`);
	lines.push("", step.task.trim(), "");
	return lines;
}

export function serializeWorkflow(workflow: WorkflowConfig): string {
	const lines = [
		"---",
		`name: ${workflow.name}`,
		`description: ${workflow.description}`,
		"---",
		"",
		...workflow.steps.flatMap(serializeStep),
	];
	return lines.join("\n");
}
