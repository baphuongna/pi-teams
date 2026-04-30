import * as fs from "node:fs";

export interface CompletionMutationGuardInput {
	role: string;
	taskText?: string;
	transcriptPath?: string;
	stdout?: string;
}

export interface CompletionMutationGuardResult {
	expectedMutation: boolean;
	observedMutation: boolean;
	reason?: "no_mutation_observed";
	observedTools: string[];
}

const MUTATING_ROLES = new Set(["executor", "test-engineer"]);
const MUTATING_TOOLS = new Set(["edit", "write", "multi_edit", "apply_patch"]);
const READ_ONLY_COMMANDS = /^(pwd|ls|dir|cat|type|sed|grep|rg|find|git\s+(status|diff|log|show|branch|remote|rev-parse|ls-files)|npm\s+(test|run\s+(typecheck|check|lint|test|ci))|node\s+--test)\b/i;
const MUTATING_COMMANDS = /\b(rm\s+-|del\s+|erase\s+|mv\s+|move\s+|cp\s+|copy\s+|mkdir\b|touch\b|git\s+(add|commit|push|reset|clean|checkout|switch|merge|rebase|stash)|npm\s+(install|i|uninstall|publish|version)|pnpm\s+(add|install|remove)|yarn\s+(add|install|remove)|python\b.*>|node\b.*>|echo\b.*>|Set-Content|Out-File)\b/i;
const READ_ONLY_HINTS = /\b(read-only|no edits?|do not edit|không sửa|khong sua|chỉ đọc|chi doc|plan only|chỉ lập plan|review only|audit only)\b/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function commandText(value: unknown): string {
	const record = asRecord(value);
	if (!record) return typeof value === "string" ? value : "";
	for (const key of ["command", "cmd", "script", "input"]) {
		const raw = record[key];
		if (typeof raw === "string") return raw;
	}
	return JSON.stringify(record);
}

function isMutatingTool(tool: string, args: unknown): boolean {
	const normalized = tool.toLowerCase();
	if (MUTATING_TOOLS.has(normalized)) return true;
	if (normalized === "bash" || normalized === "shell" || normalized === "powershell") {
		const command = commandText(args).trim();
		if (!command || READ_ONLY_COMMANDS.test(command)) return false;
		return MUTATING_COMMANDS.test(command);
	}
	return false;
}

function collectToolCallsFromEvent(event: unknown): Array<{ tool: string; args?: unknown }> {
	const record = asRecord(event);
	if (!record) return [];
	const calls: Array<{ tool: string; args?: unknown }> = [];
	const directTool = record.toolName ?? record.name ?? record.tool;
	if (typeof directTool === "string" && (record.type === "tool_execution_start" || record.type === "toolCall" || record.type === "tool_call")) {
		calls.push({ tool: directTool, args: record.args ?? record.input });
	}
	const content = Array.isArray(record.content) ? record.content : asRecord(record.message)?.content;
	if (Array.isArray(content)) {
		for (const part of content) {
			const item = asRecord(part);
			if (!item) continue;
			const tool = item.name ?? item.toolName ?? item.tool;
			if (typeof tool === "string" && (item.type === "toolCall" || item.type === "tool_call" || item.type === "tool_execution_start")) calls.push({ tool, args: item.input ?? item.args });
		}
	}
	return calls;
}

function transcriptText(input: CompletionMutationGuardInput): string {
	if (input.transcriptPath && fs.existsSync(input.transcriptPath)) return fs.readFileSync(input.transcriptPath, "utf-8");
	return input.stdout ?? "";
}

export function expectsImplementationMutation(input: Pick<CompletionMutationGuardInput, "role" | "taskText">): boolean {
	if (!MUTATING_ROLES.has(input.role)) return false;
	return !READ_ONLY_HINTS.test(input.taskText ?? "");
}

export function evaluateCompletionMutationGuard(input: CompletionMutationGuardInput): CompletionMutationGuardResult {
	const expectedMutation = expectsImplementationMutation(input);
	const observedTools: string[] = [];
	let observedMutation = false;
	const text = transcriptText(input);
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let event: unknown;
		try { event = JSON.parse(trimmed); } catch { continue; }
		for (const call of collectToolCallsFromEvent(event)) {
			observedTools.push(call.tool);
			if (isMutatingTool(call.tool, call.args)) observedMutation = true;
		}
	}
	return {
		expectedMutation,
		observedMutation,
		observedTools,
		...(expectedMutation && !observedMutation ? { reason: "no_mutation_observed" as const } : {}),
	};
}
