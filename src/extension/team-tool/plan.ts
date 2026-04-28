import { allTeams, discoverTeams } from "../../teams/discover-teams.ts";
import { allWorkflows, discoverWorkflows } from "../../workflows/discover-workflows.ts";
import { validateWorkflowForTeam } from "../../workflows/validate-workflow.ts";
import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { result, type TeamContext } from "./context.ts";

export function handlePlan(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	const teamName = params.team ?? "default";
	const team = allTeams(discoverTeams(ctx.cwd)).find((item) => item.name === teamName);
	if (!team) return result(`Team '${teamName}' not found.`, { action: "plan", status: "error" }, true);
	const workflowName = params.workflow ?? team.defaultWorkflow ?? "default";
	const workflow = allWorkflows(discoverWorkflows(ctx.cwd)).find((item) => item.name === workflowName);
	if (!workflow) return result(`Workflow '${workflowName}' not found.`, { action: "plan", status: "error" }, true);
	const errors = validateWorkflowForTeam(workflow, team);
	if (errors.length > 0) return result([`Workflow '${workflow.name}' is not valid for team '${team.name}':`, ...errors.map((error) => `- ${error}`)].join("\n"), { action: "plan", status: "error" }, true);
	const lines = [`Team plan: ${team.name}`, `Workflow: ${workflow.name}`, `Goal: ${params.goal ?? params.task ?? "(not provided)"}`, "", "Steps:", ...workflow.steps.map((step, index) => `${index + 1}. ${step.id} [${step.role}]${step.dependsOn?.length ? ` after ${step.dependsOn.join(", ")}` : ""}`)];
	return result(lines.join("\n"), { action: "plan", status: "ok" });
}
