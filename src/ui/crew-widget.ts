import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { listRuns } from "../extension/run-index.ts";
import { isActiveRunStatus } from "../runtime/process-status.ts";
import { readCrewAgents } from "../runtime/crew-agent-records.ts";
import type { CrewAgentRecord } from "../runtime/crew-agent-runtime.ts";
import type { TeamRunManifest } from "../state/types.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TOOL_LABELS: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

export interface CrewWidgetState {
	frame: number;
	interval?: ReturnType<typeof setInterval>;
}

function elapsed(iso: string | undefined, now = Date.now()): string | undefined {
	if (!iso) return undefined;
	const ms = Math.max(0, now - new Date(iso).getTime());
	if (!Number.isFinite(ms)) return undefined;
	if (ms < 1000) return "now";
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	return `${Math.floor(ms / 3_600_000)}h`;
}

function glyph(status: string, runningGlyph: string): string {
	if (status === "running") return runningGlyph;
	if (status === "queued") return "◦";
	if (status === "completed") return "✓";
	if (status === "failed") return "✗";
	if (status === "cancelled" || status === "stopped") return "■";
	return "·";
}

function agentActivity(agent: CrewAgentRecord): string {
	if (agent.progress?.currentTool) return `${TOOL_LABELS[agent.progress.currentTool] ?? agent.progress.currentTool}…`;
	const recent = agent.progress?.recentOutput?.at(-1);
	if (recent) return recent.replace(/\s+/g, " ").trim();
	if (agent.progress?.activityState === "needs_attention") return "needs attention";
	if (agent.status === "queued") return "queued…";
	if (agent.status === "running") return "thinking…";
	if (agent.status === "failed") return agent.error ?? "failed";
	return "done";
}

function agentStats(agent: CrewAgentRecord): string {
	const parts: string[] = [];
	if (agent.toolUses) parts.push(`${agent.toolUses} tools`);
	if (agent.progress?.tokens) parts.push(`${agent.progress.tokens} tok`);
	if (agent.progress?.turns) parts.push(`⟳${agent.progress.turns}`);
	const age = elapsed(agent.completedAt ?? agent.startedAt);
	if (age) parts.push(agent.completedAt ? age : `${age} ago`);
	return parts.join(" · ");
}

function runStep(run: TeamRunManifest, agents: CrewAgentRecord[]): string {
	const running = agents.find((agent) => agent.status === "running");
	if (running) return running.taskId;
	const queued = agents.find((agent) => agent.status === "queued");
	if (queued) return queued.taskId;
	return run.status;
}

export function buildCrewWidgetLines(cwd: string, frame = 0, maxLines = 8): string[] {
	const runs = listRuns(cwd).slice(0, 20);
	const activeRuns = runs.filter((run) => isActiveRunStatus(run.status));
	const recentRuns = runs.filter((run) => !isActiveRunStatus(run.status)).slice(0, 3);
	const shownRuns = [...activeRuns, ...recentRuns];
	if (!shownRuns.length) return [];
	const runningGlyph = SPINNER[frame % SPINNER.length] ?? "⠋";
	const lines: string[] = [];
	const activeCount = activeRuns.length;
	lines.push(`${activeCount ? "●" : "○"} pi-crew · active=${activeCount} recent=${recentRuns.length} · /team-dashboard`);
	for (const run of shownRuns) {
		let agents: CrewAgentRecord[] = [];
		try { agents = readCrewAgents(run); } catch { agents = []; }
		const counts = new Map<string, number>();
		for (const agent of agents) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
		const countText = [...counts.entries()].map(([status, count]) => `${status}:${count}`).join(" ") || run.status;
		lines.push(`${glyph(run.status, runningGlyph)} ${run.runId.slice(-8)} ${run.team}/${run.workflow ?? "none"} · ${runStep(run, agents)} · ${countText}`);
		for (const agent of agents.filter((item) => item.status === "running" || item.status === "queued").slice(0, 2)) {
			const stats = agentStats(agent);
			lines.push(`  ${glyph(agent.status, runningGlyph)} ${agent.taskId} ${agent.role}→${agent.agent} · ${agentActivity(agent)}${stats ? ` · ${stats}` : ""}`);
		}
		if (lines.length >= maxLines) break;
	}
	return lines.slice(0, maxLines);
}

export function updateCrewWidget(ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">, state: CrewWidgetState): void {
	if (!ctx.hasUI) return;
	state.frame += 1;
	const lines = buildCrewWidgetLines(ctx.cwd, state.frame);
	ctx.ui.setStatus("pi-crew", lines.length ? lines[0] : undefined);
	ctx.ui.setWidget("pi-crew", lines.length ? lines : undefined, { placement: "aboveEditor" });
}

export function stopCrewWidget(ctx: Pick<ExtensionContext, "hasUI" | "ui"> | undefined, state: CrewWidgetState): void {
	if (state.interval) clearInterval(state.interval);
	state.interval = undefined;
	if (ctx?.hasUI) {
		ctx.ui.setStatus("pi-crew", undefined);
		ctx.ui.setWidget("pi-crew", undefined, { placement: "aboveEditor" });
	}
}
