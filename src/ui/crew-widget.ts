import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CrewUiConfig } from "../config/config.ts";
import { listRuns } from "../extension/run-index.ts";
import { readCrewAgents } from "../runtime/crew-agent-records.ts";
import type { CrewAgentRecord } from "../runtime/crew-agent-runtime.ts";
import { isDisplayActiveRun } from "../runtime/process-status.ts";
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
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

type ThemeLike = { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
type WidgetComponent = { render(width: number): string[]; invalidate(): void };

export interface CrewWidgetState {
	frame: number;
	interval?: ReturnType<typeof setInterval>;
}

interface WidgetRun {
	run: TeamRunManifest;
	agents: CrewAgentRecord[];
}

function visibleWidth(value: string): number {
	return value.replace(ANSI_PATTERN, "").length;
}

function truncate(value: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(value) <= width) return value;
	if (width <= 1) return "…";
	let output = "";
	let visible = 0;
	for (let index = 0; index < value.length;) {
		const slice = value.slice(index);
		const ansi = slice.match(/^\u001b\[[0-?]*[ -/]*[@-~]/);
		if (ansi?.[0]) {
			output += ansi[0];
			index += ansi[0].length;
			continue;
		}
		const char = value[index]!;
		if (visible >= width - 1) break;
		output += char;
		visible += 1;
		index += char.length;
	}
	return `${output}\u001b[0m…`;
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
	if (agent.status === "queued") return "queued";
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

function agentsFor(run: TeamRunManifest): CrewAgentRecord[] {
	try { return readCrewAgents(run); } catch { return []; }
}

function activeWidgetRuns(cwd: string): WidgetRun[] {
	const runs = listRuns(cwd).slice(0, 20);
	return runs.map((run) => ({ run, agents: agentsFor(run) })).filter((item) => isDisplayActiveRun(item.run, item.agents));
}

function statusSummary(runs: WidgetRun[]): string {
	const runningAgents = runs.flatMap((item) => item.agents).filter((agent) => agent.status === "running").length;
	const queuedAgents = runs.flatMap((item) => item.agents).filter((agent) => agent.status === "queued").length;
	return `● pi-crew · runs=${runs.length} agents=${runningAgents} running${queuedAgents ? ` · ${queuedAgents} queued` : ""} · /team-dashboard`;
}

export function buildCrewWidgetLines(cwd: string, frame = 0, maxLines = 8): string[] {
	const runs = activeWidgetRuns(cwd);
	if (!runs.length) return [];
	const runningGlyph = SPINNER[frame % SPINNER.length] ?? "⠋";
	const lines: string[] = [statusSummary(runs)];
	for (const { run, agents } of runs) {
		const running = agents.find((agent) => agent.status === "running");
		const queued = agents.find((agent) => agent.status === "queued");
		const step = running?.taskId ?? queued?.taskId ?? run.status;
		const completed = agents.filter((agent) => agent.status === "completed").length;
		lines.push(`${glyph(run.status, runningGlyph)} ${run.runId.slice(-8)} ${run.team}/${run.workflow ?? "none"} · ${step} · ${completed}/${agents.length} done`);
		const activeAgents = agents.filter((item) => item.status === "running" || item.status === "queued");
		for (const agent of activeAgents.slice(0, 3)) {
			const stats = agentStats(agent);
			lines.push(`  ${glyph(agent.status, runningGlyph)} ${agent.taskId} ${agent.role}→${agent.agent} · ${agentActivity(agent)}${stats ? ` · ${stats}` : ""}`);
		}
		if (activeAgents.length > 3) lines.push(`  … +${activeAgents.length - 3} more agents`);
		if (lines.length >= maxLines) break;
	}
	return lines.slice(0, maxLines);
}

class CrewWidgetComponent implements WidgetComponent {
	private cwd: string;
	private frame: number;
	private maxLines: number;
	private theme: ThemeLike;

	constructor(cwd: string, frame: number, maxLines: number, theme: ThemeLike) {
		this.cwd = cwd;
		this.frame = frame;
		this.maxLines = maxLines;
		this.theme = theme;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const fg = this.theme.fg?.bind(this.theme) ?? ((_color: string, text: string) => text);
		const bold = this.theme.bold?.bind(this.theme) ?? ((text: string) => text);
		return buildCrewWidgetLines(this.cwd, this.frame, this.maxLines).map((line, index) => {
			const colored = index === 0
				? line.replace("● pi-crew", `${fg("accent", "●")} ${bold("pi-crew")}`)
				: line.replace(/^\s*([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏▶◦✓✗■·])/, (match, icon: string) => match.replace(icon, fg(icon === "✓" ? "success" : icon === "✗" ? "error" : icon === "◦" ? "dim" : "accent", icon)));
			return truncate(colored, width);
		});
	}
}

export function updateCrewWidget(ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">, state: CrewWidgetState, config?: CrewUiConfig): void {
	if (!ctx.hasUI) return;
	state.frame += 1;
	const maxLines = config?.widgetMaxLines ?? 8;
	const lines = buildCrewWidgetLines(ctx.cwd, state.frame, maxLines);
	ctx.ui.setStatus("pi-crew", lines.length ? lines[0] : undefined);
	if (!lines.length) {
		ctx.ui.setWidget("pi-crew", undefined, { placement: config?.widgetPlacement ?? "aboveEditor" });
		return;
	}
	ctx.ui.setWidget("pi-crew", ((_tui: unknown, theme: unknown) => new CrewWidgetComponent(ctx.cwd, state.frame, maxLines, theme as ThemeLike)) as never, { placement: config?.widgetPlacement ?? "aboveEditor" });
}

export function stopCrewWidget(ctx: Pick<ExtensionContext, "hasUI" | "ui"> | undefined, state: CrewWidgetState, config?: CrewUiConfig): void {
	if (state.interval) clearInterval(state.interval);
	state.interval = undefined;
	if (ctx?.hasUI) {
		ctx.ui.setStatus("pi-crew", undefined);
		ctx.ui.setWidget("pi-crew", undefined, { placement: config?.widgetPlacement ?? "aboveEditor" });
	}
}
