import type { RunDashboardOptions } from "../run-dashboard.ts";
import { iconForStatus } from "../status-colors.ts";
import type { RunUiSnapshot } from "../snapshot-types.ts";
import { spinnerFrame } from "../spinner.ts";

function tokens(agent: RunUiSnapshot["agents"][number]): string {
	const total = (agent.usage?.input ?? 0) + (agent.usage?.output ?? agent.progress?.tokens ?? 0) + (agent.usage?.cacheRead ?? 0) + (agent.usage?.cacheWrite ?? 0);
	return total ? `${total} tok` : "tok pending";
}

export function renderAgentsPane(snapshot: RunUiSnapshot | undefined, options: RunDashboardOptions = {}): string[] {
	if (!snapshot) return ["Agents pane: snapshot unavailable"];
	if (!snapshot.agents.length) return ["Agents pane: no agents"];
	return [
		`Agents pane: ${snapshot.agents.length} agents · ${snapshot.progress.completed}/${snapshot.progress.total} tasks done`,
		...snapshot.agents.slice(0, 12).map((agent) => {
			const parts = [
				agent.status,
				options.showTools !== false && agent.progress?.currentTool ? `tool=${agent.progress.currentTool}` : undefined,
				options.showTools !== false ? `${agent.toolUses ?? agent.progress?.toolCount ?? 0} tools` : undefined,
				options.showTokens !== false ? tokens(agent) : undefined,
				options.showModel !== false ? (agent.model ? `model=${agent.model}` : undefined) : undefined,
			].filter((part): part is string => Boolean(part));
			const icon = iconForStatus(agent.status, { runningGlyph: spinnerFrame(agent.taskId) });
			return `${icon} ${agent.taskId} ${agent.role}->${agent.agent} · ${parts.join(" · ")}`;
		}),
	];
}
