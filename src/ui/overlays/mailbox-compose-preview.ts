import type { CrewTheme } from "../theme-adapter.ts";
import { asCrewTheme } from "../theme-adapter.ts";
import { truncate } from "../../utils/visual.ts";

export type MarkdownToken = { type: "heading" | "code-block" | "list-item" | "paragraph"; level?: number; text: string };

function stripInlineMarkdown(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1");
}

export function tokenizeMarkdown(body: string): MarkdownToken[] {
	const tokens: MarkdownToken[] = [];
	const lines = body.split(/\r?\n/);
	let inCode = false;
	let codeLines: string[] = [];
	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			if (inCode) {
				tokens.push({ type: "code-block", text: codeLines.join("\n") });
				codeLines = [];
				inCode = false;
			} else inCode = true;
			continue;
		}
		if (inCode) {
			codeLines.push(line);
			continue;
		}
		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			tokens.push({ type: "heading", level: heading[1]!.length, text: stripInlineMarkdown(heading[2]!) });
			continue;
		}
		const list = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
		if (list) {
			tokens.push({ type: "list-item", text: stripInlineMarkdown(list[1]!) });
			continue;
		}
		if (line.trim()) tokens.push({ type: "paragraph", text: stripInlineMarkdown(line.trim()) });
	}
	if (inCode && codeLines.length) tokens.push({ type: "code-block", text: codeLines.join("\n") });
	return tokens;
}

function renderToken(token: MarkdownToken, width: number, theme: CrewTheme): string[] {
	const safeWidth = Math.max(10, width);
	if (token.type === "heading") return [truncate(theme.bold(`${"#".repeat(token.level ?? 1)} ${token.text}`), safeWidth)];
	if (token.type === "list-item") return [truncate(`• ${token.text}`, safeWidth)];
	if (token.type === "code-block") return ["```", ...token.text.split(/\r?\n/).map((line) => truncate(`  ${line}`, safeWidth)), "```"];
	return [truncate(token.text, safeWidth)];
}

export function renderComposePreview(body: string, width: number, themeLike: unknown = {}): string[] {
	const theme = asCrewTheme(themeLike);
	const tokens = tokenizeMarkdown(body);
	if (!tokens.length) return [theme.fg("dim", "Preview: (empty)")];
	return [theme.bold("Preview"), ...tokens.flatMap((token) => renderToken(token, width, theme))];
}
