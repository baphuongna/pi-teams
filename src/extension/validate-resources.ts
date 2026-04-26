import { allAgents, discoverAgents } from "../agents/discover-agents.ts";
import { allTeams, discoverTeams } from "../teams/discover-teams.ts";
import { allWorkflows, discoverWorkflows } from "../workflows/discover-workflows.ts";
import { validateWorkflowForTeam } from "../workflows/validate-workflow.ts";

export interface ValidationIssue {
	level: "error" | "warning";
	resource: string;
	message: string;
}

export interface ValidationReport {
	issues: ValidationIssue[];
	agents: number;
	teams: number;
	workflows: number;
}

export function validateResources(cwd: string): ValidationReport {
	const agents = allAgents(discoverAgents(cwd));
	const teams = allTeams(discoverTeams(cwd));
	const workflows = allWorkflows(discoverWorkflows(cwd));
	const agentNames = new Set(agents.map((agent) => agent.name));
	const workflowNames = new Set(workflows.map((workflow) => workflow.name));
	const issues: ValidationIssue[] = [];

	for (const agent of agents) {
		const modelValues = [agent.model, ...(agent.fallbackModels ?? [])].filter((value): value is string => typeof value === "string" && value.length > 0);
		for (const model of modelValues) {
			if (/\s/.test(model)) {
				issues.push({ level: "warning", resource: `agent:${agent.name}`, message: `Model reference '${model}' contains whitespace.` });
			}
			if (model.includes("/") && model.split("/").some((part) => part.trim() === "")) {
				issues.push({ level: "warning", resource: `agent:${agent.name}`, message: `Model reference '${model}' has an empty provider/model segment.` });
			}
		}
	}

	for (const team of teams) {
		for (const role of team.roles) {
			if (!agentNames.has(role.agent)) {
				issues.push({ level: "error", resource: `team:${team.name}`, message: `Role '${role.name}' references unknown agent '${role.agent}'.` });
			}
		}
		if (team.defaultWorkflow && !workflowNames.has(team.defaultWorkflow)) {
			issues.push({ level: "error", resource: `team:${team.name}`, message: `defaultWorkflow references unknown workflow '${team.defaultWorkflow}'.` });
		}
		const workflow = workflows.find((candidate) => candidate.name === team.defaultWorkflow);
		if (workflow) {
			for (const error of validateWorkflowForTeam(workflow, team)) {
				issues.push({ level: "error", resource: `workflow:${workflow.name}`, message: `Team '${team.name}': ${error}` });
			}
		}
	}

	for (const workflow of workflows) {
		if (workflow.steps.length === 0) {
			issues.push({ level: "warning", resource: `workflow:${workflow.name}`, message: "Workflow has no steps." });
		}
	}

	return { issues, agents: agents.length, teams: teams.length, workflows: workflows.length };
}

export function formatValidationReport(report: ValidationReport): string {
	const lines = [
		"pi-teams resource validation:",
		`Agents: ${report.agents}`,
		`Teams: ${report.teams}`,
		`Workflows: ${report.workflows}`,
		`Issues: ${report.issues.length}`,
	];
	if (report.issues.length > 0) {
		lines.push("", ...report.issues.map((issue) => `- ${issue.level.toUpperCase()} ${issue.resource}: ${issue.message}`));
	}
	return lines.join("\n");
}
