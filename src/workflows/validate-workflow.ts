import type { TeamConfig } from "../teams/team-config.ts";
import type { WorkflowConfig } from "./workflow-config.ts";

export function validateWorkflowForTeam(workflow: WorkflowConfig, team: TeamConfig): string[] {
	const errors: string[] = [];
	const roles = new Set(team.roles.map((role) => role.name));
	const stepIds = new Set<string>();

	for (const step of workflow.steps) {
		if (stepIds.has(step.id)) errors.push(`Duplicate workflow step id '${step.id}'.`);
		stepIds.add(step.id);
		if (!roles.has(step.role)) errors.push(`Step '${step.id}' references unknown team role '${step.role}'.`);
	}

	for (const step of workflow.steps) {
		for (const dep of step.dependsOn ?? []) {
			if (!stepIds.has(dep)) errors.push(`Step '${step.id}' depends on unknown step '${dep}'.`);
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byId = new Map(workflow.steps.map((step) => [step.id, step]));

	function visit(id: string, trail: string[]): void {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			errors.push(`Workflow dependency cycle detected: ${[...trail, id].join(" -> ")}.`);
			return;
		}
		visiting.add(id);
		const step = byId.get(id);
		for (const dep of step?.dependsOn ?? []) visit(dep, [...trail, id]);
		visiting.delete(id);
		visited.add(id);
	}

	for (const step of workflow.steps) visit(step.id, []);
	return [...new Set(errors)];
}
