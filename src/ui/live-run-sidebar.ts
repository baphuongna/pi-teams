import * as fs from "node:fs";
import type { CrewUiConfig } from "../config/config.ts";
import { readCrewAgents } from "../runtime/crew-agent-records.ts";
import { applyAttentionState, resolveCrewControlConfig } from "../runtime/agent-control.ts";
import { formatTaskGraphLines, waitingReason } from "../runtime/task-display.ts";
import { loadRunManifestById } from "../state/state-store.ts";
import { aggregateUsage, formatUsage } from "../state/usage.ts";
import type { TeamTaskState } from "../state/types.ts";
import { readJsonFileCoalesced } from "../utils/file-coalescer.ts";
import { pad, truncate } from "../utils/visual.ts";
import { iconForStatus } from "./status-colors.ts";
import type { CrewTheme } from "./theme-adapter.ts";
import { asCrewTheme, subscribeThemeChange } from "./theme-adapter.ts";
import { Box, Text } from "./layout-primitives.ts";
import type { RunSnapshotCache, RunUiSnapshot } from "./snapshot-types.ts";

const TASK_READ_TTL_MS = 200;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function renderLines(lines: string[], width: number): string[] {
	const box = new Box(0, 0);
	for (const line of lines) {
		box.addChild(new Text(line));
	}
	return box.render(width);
}

type Done = (value: undefined) => void;

function line(text: string, width: number): string {
	return `│ ${pad(truncate(text, width - 4), width - 4)} │`;
}

function border(left: string, fill: string, right: string, width: number): string {
	return `${left}${fill.repeat(Math.max(0, width - 2))}${right}`;
}

function readTasks(path: string): TeamTaskState[] {
	const parse = () => {
		const parsed = JSON.parse(fs.readFileSync(path, "utf-8"));
		return Array.isArray(parsed) ? (parsed as TeamTaskState[]) : [];
	};
	try {
		return readJsonFileCoalesced(path, TASK_READ_TTL_MS, parse);
	} catch {
		return [];
	}
}

function shortUsage(tasks: TeamTaskState[]): string {
	const usage = aggregateUsage(tasks);
	return usage ? formatUsage(usage) : "usage=(none)";
}

export class LiveRunSidebar {
	private readonly cwd: string;
	private readonly runId: string;
	private readonly done: Done;
	private readonly theme: CrewTheme;
	private readonly config: CrewUiConfig;
	private readonly unsubscribeTheme: () => void;
	private readonly snapshotCache?: RunSnapshotCache;
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private cachedSignature = "";

	constructor(input: { cwd: string; runId: string; done: Done; theme?: unknown; config?: CrewUiConfig; snapshotCache?: RunSnapshotCache }) {
		this.cwd = input.cwd;
		this.runId = input.runId;
		this.done = input.done;
		this.theme = asCrewTheme(input.theme);
		this.config = input.config ?? {};
		this.snapshotCache = input.snapshotCache;
		this.unsubscribeTheme = subscribeThemeChange(input.theme, () => this.invalidate());
	}

	private buildSignature(manifestStatus: string, tasks: TeamTaskState[], agents: ReturnType<typeof readCrewAgents>, waitingCount: number, snapshot?: RunUiSnapshot): string {
		if (snapshot) return `${snapshot.signature}:${waitingCount}`;
		const taskSig = tasks.map((task) => `${task.id}:${task.status}:${task.startedAt ?? ""}:${task.finishedAt ?? ""}:${task.agentProgress?.currentTool ?? ""}:${task.agentProgress?.toolCount ?? 0}:${task.agentProgress?.tokens ?? 0}:${task.usage ? JSON.stringify(task.usage) : ""}`).join("|");
		const agentSig = agents.map((agent) => [agent.id, agent.status, agent.startedAt, agent.completedAt ?? "", agent.progress?.currentTool ?? "", agent.progress?.toolCount ?? 0, agent.progress?.tokens ?? 0, agent.progress?.turns ?? 0, agent.progress?.lastActivityAt ?? "", agent.progress?.recentOutput.at(-1) ?? "", agent.toolUses ?? 0].join(":")).join("|");
		return `${manifestStatus}|${agents.length}|${waitingCount}|${taskSig}|${agentSig}`;
	}

	private colorLine(line: string): string {
		const iconColor = (icon: string): Parameters<CrewTheme["fg"]>[0] => {
			if (icon === "✓") return "success";
			if (icon === "✗") return "error";
			if (icon === "■" || icon === "⏸") return "warning";
			return "accent";
		};
		return line.replace(/[✓✗■⏸◦·▶]/g, (icon) => this.theme.fg(iconColor(icon), icon));
	}

	invalidate(): void {
		this.cachedLines = [];
		this.cachedSignature = "";
	}

	dispose(): void {
		this.unsubscribeTheme();
	}

	render(width: number): string[] {
		const w = Math.max(36, width);
		const loaded = loadRunManifestById(this.cwd, this.runId);
		if (!loaded) {
			return renderLines(
				[
					border("╭", "─", "╮", w),
					line(`${this.theme.fg("accent", "▐")} ${this.theme.bold("pi-crew live sidebar")}`, w),
					line("run not found", w),
					border("╰", "─", "╯", w),
				],
				w,
			);
		}

		let snapshot: RunUiSnapshot | undefined;
		try {
			snapshot = this.snapshotCache?.refreshIfStale(this.runId);
		} catch {
			snapshot = undefined;
		}
		const run = snapshot?.manifest ?? loaded.manifest;
		const tasks = snapshot?.tasks ?? readTasks(run.tasksPath);
		const controlConfig = resolveCrewControlConfig({ ui: this.config });
		const rawAgents = snapshot?.agents ?? readCrewAgents(run);
		const agents = rawAgents.map((agent) => applyAttentionState(run, agent, controlConfig));
		const active = agents.filter((agent) => agent.status === "running");
		const completed = agents.filter((agent) => agent.status !== "running").slice(-5);
		const waiting = tasks.filter((task) => task.status === "queued");
		const signature = this.buildSignature(run.updatedAt, tasks, agents, waiting.length, snapshot);
		if (signature !== this.cachedSignature || w !== this.cachedWidth) {
			const lines: string[] = [
				border("╭", "─", "╮", w),
				line(`${this.theme.fg("accent", "▐")} ${this.theme.bold("pi-crew live sidebar")}`, w),
				line(`${run.runId.slice(-12)} · ${run.status} · right default`, w),
				line(`${run.team}/${run.workflow ?? "none"} · ${shortUsage(tasks)}`, w),
				border("├", "─", "┤", w),
				line(`Active agents (${active.length})`, w),
			];
			for (const agent of active.slice(0, 8)) {
				const status = iconForStatus(agent.status, { runningGlyph: SPINNER[0] });
				const usage = agent.usage ? formatUsage(agent.usage) : agent.progress?.tokens ? `tokens=${agent.progress.tokens}` : "usage=pending";
				lines.push(line(`${status} ${agent.taskId} ${agent.role}->${agent.agent}`, w));
				lines.push(line(`  ${agent.routing ? `model ${agent.routing.requested ? `${agent.routing.requested} → ` : ""}${agent.routing.resolved}` : agent.model ? `model ${agent.model}` : "model pending"}`, w));
				lines.push(line(`  ${agent.progress?.currentTool ? `tool ${agent.progress.currentTool} · ` : ""}${agent.toolUses ?? 0} tools · ${usage}`, w));
			}
			if (!active.length) lines.push(line("- none", w));
			lines.push(border("├", "─", "┤", w), line(`Waiting tasks (${waiting.length})`, w));
			for (const task of waiting.slice(0, 8)) {
				const status = iconForStatus("queued");
				lines.push(line(`${status} ${task.id} ${waitingReason(task, tasks) ?? "waiting"}`, w));
			}
			if (waiting.length === 0) lines.push(line("- none", w));
			lines.push(border("├", "─", "┤", w), line(`Completed agents (${completed.length})`, w));
			for (const agent of completed) {
				const status = iconForStatus(agent.status === "running" ? "stopped" : agent.status);
				lines.push(line(`${status} ${agent.taskId} ${agent.model ? `· ${agent.model}` : ""}${agent.usage ? ` · ${formatUsage(agent.usage)}` : ""}`, w));
			}
			if (completed.length === 0) lines.push(line("- none", w));
			lines.push(border("├", "─", "┤", w));
			for (const entry of formatTaskGraphLines(tasks).slice(0, 6)) lines.push(line(entry, w));
			lines.push(line("q close · /team-dashboard details", w), border("╰", "─", "╯", w));
			this.cachedLines = renderLines(lines.map((entry) => this.colorLine(entry)), w);
			this.cachedSignature = signature;
			this.cachedWidth = w;
		}
		return this.cachedLines;
	}

	handleInput(data: string): void {
		if (data === "q" || data === "\u001b") this.done(undefined);
	}
}
