import type { AgentConfig } from "../agents/agent-config.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import type { TeamConfig } from "../teams/team-config.ts";
import type { WorkflowConfig } from "../workflows/workflow-config.ts";

export function isDirectRun(manifest: Pick<TeamRunManifest, "team" | "workflow">): boolean {
	return manifest.workflow === "direct-agent";
}

export function directTeamAndWorkflowFromRun(manifest: TeamRunManifest, tasks: TeamTaskState[], agents: AgentConfig[]): { team: TeamConfig; workflow: WorkflowConfig } | undefined {
	if (!isDirectRun(manifest)) return undefined;
	const firstTask = tasks[0];
	const agentName = firstTask?.agent ?? (manifest.team.replace(/^direct-/, "") || "executor");
	const agent = agents.find((candidate) => candidate.name === agentName);
	const role = firstTask?.role ?? "agent";
	const stepId = firstTask?.stepId ?? "01_agent";
	return {
		team: {
			name: manifest.team,
			description: `Direct subagent run for ${agentName}`,
			source: "builtin",
			filePath: "<generated>",
			roles: [{ name: role, agent: agentName, description: agent?.description }],
			defaultWorkflow: "direct-agent",
			workspaceMode: manifest.workspaceMode,
		},
		workflow: {
			name: manifest.workflow ?? "direct-agent",
			description: `Direct task for ${agentName}`,
			source: "builtin",
			filePath: "<generated>",
			steps: [{ id: stepId, role, task: "{goal}", model: firstTask?.model }],
		},
	};
}
