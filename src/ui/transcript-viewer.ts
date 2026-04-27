import * as fs from "node:fs";
type Component = { invalidate(): void; render(width: number): string[]; handleInput(data: string): void };
type TranscriptTheme = { fg?: (color: string, text: string) => string; bold?: (text: string) => string };
import type { TeamRunManifest } from "../state/types.ts";
import { agentOutputPath, readCrewAgents } from "../runtime/crew-agent-records.ts";

function visibleWidth(text: string): number {
	return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").length;
}

function truncate(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	return width <= 1 ? "…" : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function wrap(text: string, width: number): string[] {
	const source = text.split(/\r?\n/);
	const lines: string[] = [];
	for (const raw of source) {
		const line = raw || " ";
		if (line.length <= width) {
			lines.push(line);
			continue;
		}
		for (let index = 0; index < line.length; index += width) lines.push(line.slice(index, index + width));
	}
	return lines;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		const obj = asRecord(part);
		if (!obj) return "";
		if (typeof obj.text === "string") return obj.text;
		if (typeof obj.content === "string") return obj.content;
		if (typeof obj.name === "string") return `[tool:${obj.name}]`;
		return "";
	}).filter(Boolean).join("\n");
}

export function formatTranscriptEvent(event: unknown): string[] {
	const obj = asRecord(event);
	if (!obj) return [String(event)];
	const type = typeof obj.type === "string" ? obj.type : undefined;
	const toolName = typeof obj.toolName === "string" ? obj.toolName : typeof obj.name === "string" ? obj.name : undefined;
	if (type && /tool/i.test(type)) {
		const text = textFromContent(obj.content) || (typeof obj.text === "string" ? obj.text : typeof obj.result === "string" ? obj.result : "");
		return [`[tool${toolName ? `:${toolName}` : ""} ${type}]: ${text.trim() || "(no output)"}`];
	}
	const message = asRecord(obj.message);
	if (message) {
		const role = typeof message.role === "string" ? message.role : "message";
		const text = textFromContent(message.content);
		if (text.trim()) return [`[${role}]: ${text.trim()}`];
	}
	if (type) {
		const text = textFromContent(obj.content) || (typeof obj.text === "string" ? obj.text : "");
		return text.trim() ? [`[${type}]: ${text.trim()}`] : [`[${type}]`];
	}
	return [JSON.stringify(event)];
}

export function formatTranscriptText(text: string): string[] {
	const lines: string[] = [];
	for (const raw of text.split(/\r?\n/).filter(Boolean)) {
		try {
			lines.push(...formatTranscriptEvent(JSON.parse(raw)));
		} catch {
			lines.push(raw);
		}
	}
	return lines.length ? lines : ["(no transcript content)"];
}

export function readRunTranscript(manifest: TeamRunManifest, taskId?: string): { title: string; path: string; lines: string[] } {
	const agents = readCrewAgents(manifest);
	const agent = taskId ? agents.find((item) => item.taskId === taskId || item.id === taskId) : agents.find((item) => item.transcriptPath) ?? agents[0];
	const selectedTaskId = agent?.taskId ?? taskId ?? "unknown";
	const transcriptPath = agent?.transcriptPath && fs.existsSync(agent.transcriptPath) ? agent.transcriptPath : agentOutputPath(manifest, selectedTaskId);
	const text = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf-8") : "";
	return { title: `${manifest.runId}:${selectedTaskId}`, path: transcriptPath, lines: formatTranscriptText(text) };
}

export class DurableTextViewer implements Component {
	private scroll = 0;
	private lastHeight = 10;
	private title: string;
	private subtitle: string;
	private lines: string[];
	private theme: unknown;
	private done: (result: undefined) => void;

	constructor(title: string, subtitle: string, lines: string[], theme: unknown, done: (result: undefined) => void) {
		this.title = title;
		this.subtitle = subtitle;
		this.lines = lines.length ? lines : ["(empty)"];
		this.theme = theme;
		this.done = done;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (data === "q" || data === "\u001b") {
			this.done(undefined);
			return;
		}
		const maxScroll = Math.max(0, this.lines.length - this.lastHeight);
		if (data === "k" || data === "\u001b[A") this.scroll = Math.max(0, this.scroll - 1);
		else if (data === "j" || data === "\u001b[B") this.scroll = Math.min(maxScroll, this.scroll + 1);
		else if (data === "g") this.scroll = 0;
		else if (data === "G") this.scroll = maxScroll;
	}

	render(width: number): string[] {
		const th = this.theme as TranscriptTheme;
		const fg = th.fg?.bind(th) ?? ((_color: string, text: string) => text);
		const bold = th.bold?.bind(th) ?? ((text: string) => text);
		const inner = Math.max(20, width - 4);
		this.lastHeight = 16;
		const body = this.lines.flatMap((line) => wrap(line, inner));
		const maxScroll = Math.max(0, body.length - this.lastHeight);
		this.scroll = Math.min(this.scroll, maxScroll);
		const visible = body.slice(this.scroll, this.scroll + this.lastHeight);
		const pad = (text: string) => `${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))}`;
		const row = (text: string) => `${fg("border", "│")} ${truncate(pad(text), inner)} ${fg("border", "│")}`;
		return [
			fg("border", `╭${"─".repeat(inner + 2)}╮`),
			row(`${bold(this.title)} ${fg("dim", this.subtitle)}`),
			row(fg("dim", "j/k scroll · g/G top/bottom · q close")),
			fg("border", `├${"─".repeat(inner + 2)}┤`),
			...visible.map(row),
			fg("border", `├${"─".repeat(inner + 2)}┤`),
			row(fg("dim", `${body.length} lines · ${body.length ? Math.round(((this.scroll + visible.length) / body.length) * 100) : 100}%`)),
			fg("border", `╰${"─".repeat(inner + 2)}╯`),
		];
	}
}

export class DurableTranscriptViewer implements Component {
	private scroll = 0;
	private lastHeight = 10;
	private manifest: TeamRunManifest;
	private theme: unknown;
	private done: (result: undefined) => void;
	private taskId?: string;

	constructor(manifest: TeamRunManifest, theme: unknown, done: (result: undefined) => void, taskId?: string) {
		this.manifest = manifest;
		this.theme = theme;
		this.done = done;
		this.taskId = taskId;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (data === "q" || data === "\u001b") {
			this.done(undefined);
			return;
		}
		const content = readRunTranscript(this.manifest, this.taskId).lines;
		const maxScroll = Math.max(0, content.length - this.lastHeight);
		if (data === "k" || data === "\u001b[A") this.scroll = Math.max(0, this.scroll - 1);
		else if (data === "j" || data === "\u001b[B") this.scroll = Math.min(maxScroll, this.scroll + 1);
		else if (data === "g") this.scroll = 0;
		else if (data === "G") this.scroll = maxScroll;
	}

	render(width: number): string[] {
		const th = this.theme as TranscriptTheme;
		const fg = th.fg?.bind(th) ?? ((_color: string, text: string) => text);
		const bold = th.bold?.bind(th) ?? ((text: string) => text);
		const inner = Math.max(20, width - 4);
		const data = readRunTranscript(this.manifest, this.taskId);
		const body = data.lines.flatMap((line) => wrap(line, inner));
		this.lastHeight = 16;
		const maxScroll = Math.max(0, body.length - this.lastHeight);
		this.scroll = Math.min(this.scroll, maxScroll);
		const visible = body.slice(this.scroll, this.scroll + this.lastHeight);
		const pad = (text: string) => `${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))}`;
		const row = (text: string) => `${fg("border", "│")} ${truncate(pad(text), inner)} ${fg("border", "│")}`;
		const lines = [
			fg("border", `╭${"─".repeat(inner + 2)}╮`),
			row(`${bold("pi-crew transcript")} ${fg("dim", data.title)}`),
			row(fg("dim", data.path)),
			row(fg("dim", "j/k scroll · g/G top/bottom · q close")),
			fg("border", `├${"─".repeat(inner + 2)}┤`),
			...visible.map(row),
			fg("border", `├${"─".repeat(inner + 2)}┤`),
			row(fg("dim", `${body.length} lines · ${body.length ? Math.round(((this.scroll + visible.length) / body.length) * 100) : 100}%`)),
			fg("border", `╰${"─".repeat(inner + 2)}╯`),
		];
		return lines;
	}
}

