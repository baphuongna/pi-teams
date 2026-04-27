import * as fs from "node:fs";
import type { CrewUiConfig } from "../config/config.ts";
import { readCrewAgents } from "../runtime/crew-agent-records.ts";
import { applyAttentionState, resolveCrewControlConfig } from "../runtime/agent-control.ts";
import { formatTaskGraphLines, waitingReason } from "../runtime/task-display.ts";
import { loadRunManifestById } from "../state/state-store.ts";
import { aggregateUsage, formatUsage } from "../state/usage.ts";
import type { TeamTaskState } from "../state/types.ts";

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
type ThemeLike = { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
type Done = (value: undefined) => void;

function visibleLength(value: string): number { return value.replace(ANSI_PATTERN, "").length; }
function truncate(value: string, width: number): string {
	if (width <= 0) return "";
	if (visibleLength(value) <= width) return value;
	return `${value.slice(0, Math.max(0, width - 1))}…`;
}
function pad(value: string, width: number): string { return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`; }
function line(text: string, width: number): string { return `│ ${pad(truncate(text, width - 4), width - 4)} │`; }
function border(left: string, fill: string, right: string, width: number): string { return `${left}${fill.repeat(Math.max(0, width - 2))}${right}`; }
function readTasks(path: string): TeamTaskState[] {
	try { const parsed = JSON.parse(fs.readFileSync(path, "utf-8")); return Array.isArray(parsed) ? parsed as TeamTaskState[] : []; } catch { return []; }
}
function shortUsage(tasks: TeamTaskState[]): string {
	const usage = aggregateUsage(tasks);
	return usage ? formatUsage(usage) : "usage=(none)";
}
function glyph(status: string): string {
	if (status === "running") return "⠋";
	if (status === "completed") return "✓";
	if (status === "failed") return "✗";
	if (status === "cancelled" || status === "stopped") return "■";
	return "◦";
}

export class LiveRunSidebar {
	private readonly cwd: string;
	private readonly runId: string;
	private readonly done: Done;
	private readonly theme: ThemeLike;
	private readonly config: CrewUiConfig;

	constructor(input: { cwd: string; runId: string; done: Done; theme?: unknown; config?: CrewUiConfig }) {
		this.cwd = input.cwd;
		this.runId = input.runId;
		this.done = input.done;
		this.theme = (input.theme ?? {}) as ThemeLike;
		this.config = input.config ?? {};
	}

	invalidate(): void {}

	render(width: number): string[] {
		const fg = this.theme.fg?.bind(this.theme) ?? ((_color: string, text: string) => text);
		const bold = this.theme.bold?.bind(this.theme) ?? ((text: string) => text);
		const w = Math.max(36, width);
		const loaded = loadRunManifestById(this.cwd, this.runId);
		if (!loaded) return [border("╭", "─", "╮", w), line(`${bold("pi-crew live sidebar")} · run not found`, w), border("╰", "─", "╯", w)];
		const tasks = readTasks(loaded.manifest.tasksPath);
		const controlConfig = resolveCrewControlConfig({ ui: this.config });
		const agents = readCrewAgents(loaded.manifest).map((agent) => applyAttentionState(loaded.manifest, agent, controlConfig));
		const active = agents.filter((agent) => agent.status === "running");
		const completed = agents.filter((agent) => agent.status !== "running").slice(-5);
		const waiting = tasks.filter((task) => task.status === "queued");
		const lines: string[] = [
			border("╭", "─", "╮", w),
			line(`${fg("accent", "▐")} ${bold("pi-crew live sidebar")} · right default`, w),
			line(`run ${loaded.manifest.runId.slice(-12)} · ${loaded.manifest.status}`, w),
			line(`${loaded.manifest.team}/${loaded.manifest.workflow ?? "none"} · ${shortUsage(tasks)}`, w),
			border("├", "─", "┤", w),
			line(`Active agents (${active.length})`, w),
		];
		for (const agent of active.slice(0, 8)) {
			const usage = agent.usage ? formatUsage(agent.usage) : agent.progress?.tokens ? `tokens=${agent.progress.tokens}` : "usage=pending";
			lines.push(line(`${glyph(agent.status)} ${agent.taskId} ${agent.role}->${agent.agent}`, w));
			lines.push(line(`  ${agent.model ? `model ${agent.model}` : "model pending"}`, w));
			lines.push(line(`  ${agent.progress?.currentTool ? `tool ${agent.progress.currentTool} · ` : ""}${agent.toolUses ?? 0} tools · ${usage}`, w));
		}
		if (active.length === 0) lines.push(line("- none", w));
		lines.push(border("├", "─", "┤", w), line(`Waiting tasks (${waiting.length})`, w));
		for (const task of waiting.slice(0, 8)) lines.push(line(`◦ ${task.id} ${waitingReason(task, tasks) ?? "waiting"}`, w));
		if (waiting.length === 0) lines.push(line("- none", w));
		lines.push(border("├", "─", "┤", w), line(`Completed agents (${completed.length})`, w));
		for (const agent of completed) lines.push(line(`${glyph(agent.status)} ${agent.taskId} ${agent.model ? `· ${agent.model}` : ""}${agent.usage ? ` · ${formatUsage(agent.usage)}` : ""}`, w));
		if (completed.length === 0) lines.push(line("- none", w));
		lines.push(border("├", "─", "┤", w), ...formatTaskGraphLines(tasks).slice(0, 6).map((entry) => line(entry, w)), line("q close · /team-dashboard details", w), border("╰", "─", "╯", w));
		return lines.map((entry) => truncate(entry, w));
	}

	handleInput(data: string): void {
		if (data === "q" || data === "\u001b") this.done(undefined);
	}
}
