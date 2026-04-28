import type { UsageState } from "../state/types.ts";
import { pad, truncate } from "../utils/visual.ts";
import type { RunStatus } from "./status-colors.ts";
import type { CrewTheme } from "./theme-adapter.ts";

export interface CrewFooterData {
	pwd: string;
	branch?: string;
	runId?: string;
	status?: RunStatus;
	usage?: UsageState;
	contextWindow?: number;
	contextPercent?: number;
	badges?: string[];
}

function formatCount(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "?";
	if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(Math.abs(value) >= 10_000 ? 0 : 1)}k`;
	return `${value}`;
}

function formatCost(value: number | undefined): string {
	return value === undefined || !Number.isFinite(value) ? "$0.0000" : `$${value.toFixed(4)}`;
}

function displayPwd(pwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) return `~${pwd.slice(home.length) || "/"}`;
	return pwd || ".";
}

function contextText(data: CrewFooterData): string {
	const windowText = data.contextWindow && Number.isFinite(data.contextWindow) ? formatCount(data.contextWindow) : "window";
	const percent = data.contextPercent;
	if (percent === undefined || !Number.isFinite(percent)) return `?/${windowText}`;
	return `${percent.toFixed(1)}%/${windowText}`;
}

export class CrewFooter {
	private data: CrewFooterData;
	private readonly theme: CrewTheme;
	private cacheKey = "";
	private cacheWidth = 0;
	private cacheLines: string[] = [];

	constructor(data: CrewFooterData, theme: CrewTheme) {
		this.data = data;
		this.theme = theme;
	}

	setData(data: CrewFooterData): void {
		this.data = data;
		this.invalidate();
	}

	invalidate(): void {
		this.cacheKey = "";
		this.cacheLines = [];
	}

	render(width: number): string[] {
		const key = JSON.stringify(this.data);
		if (this.cacheKey === key && this.cacheWidth === width && this.cacheLines.length) return this.cacheLines;
		const lineWidth = Math.max(1, width);
		const firstParts = [
			displayPwd(this.data.pwd),
			this.data.branch ? `(${this.data.branch})` : undefined,
			this.data.runId,
			this.data.status,
		].filter((part): part is string => Boolean(part));
		const usage = this.data.usage;
		const context = contextText(this.data);
		const contextPercent = this.data.contextPercent;
		const contextColor = contextPercent !== undefined && Number.isFinite(contextPercent)
			? contextPercent > 90
				? "error"
				: contextPercent > 70
					? "warning"
					: undefined
			: undefined;
		const contextRendered = contextColor ? this.theme.fg(contextColor, context) : context;
		const usageLine = [
			`↑${formatCount(usage?.input)}`,
			`↓${formatCount(usage?.output)}`,
			`R ${formatCount(usage?.cacheRead)} cache`,
			`W ${formatCount(usage?.cacheWrite)} cache`,
			formatCost(usage?.cost),
			contextRendered,
		].join(" • ");
		const badges = this.data.badges?.length ? this.data.badges.map((badge) => `[${badge}]`).join(" ") : "";
		this.cacheLines = [
			this.theme.fg("dim", pad(truncate(firstParts.join(" • "), lineWidth, "..."), lineWidth)),
			this.theme.fg("dim", pad(truncate(usageLine, lineWidth, "..."), lineWidth)),
			this.theme.fg("dim", pad(truncate(badges, lineWidth, "..."), lineWidth)),
		];
		this.cacheKey = key;
		this.cacheWidth = width;
		return this.cacheLines;
	}
}
