import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AgentMemoryScope = "user" | "project" | "local";
const MAX_MEMORY_LINES = 200;

export function isUnsafeMemoryName(name: string): boolean {
	return !name || name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

export function isSymlink(filePath: string): boolean {
	try {
		return fs.lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

export function safeReadMemoryFile(filePath: string): string | undefined {
	if (!fs.existsSync(filePath) || isSymlink(filePath)) return undefined;
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

export function resolveMemoryDir(agentName: string, scope: AgentMemoryScope, cwd: string): string {
	if (isUnsafeMemoryName(agentName)) throw new Error(`Unsafe agent name for memory directory: ${agentName}`);
	if (scope === "user") return path.join(os.homedir(), ".pi", "agent-memory", agentName);
	if (scope === "project") return path.join(cwd, ".pi", "agent-memory", agentName);
	return path.join(cwd, ".pi", "agent-memory-local", agentName);
}

export function ensureMemoryDir(memoryDir: string): void {
	if (fs.existsSync(memoryDir)) {
		if (isSymlink(memoryDir)) throw new Error(`Refusing to use symlinked memory directory: ${memoryDir}`);
		return;
	}
	fs.mkdirSync(memoryDir, { recursive: true });
}

export function readMemoryIndex(memoryDir: string): string | undefined {
	if (isSymlink(memoryDir)) return undefined;
	const content = safeReadMemoryFile(path.join(memoryDir, "MEMORY.md"));
	if (content === undefined) return undefined;
	const lines = content.split(/\r?\n/);
	return lines.length > MAX_MEMORY_LINES ? `${lines.slice(0, MAX_MEMORY_LINES).join("\n")}\n... (truncated at 200 lines)` : content;
}

export function buildMemoryBlock(agentName: string, scope: AgentMemoryScope, cwd: string, writable: boolean): string {
	const memoryDir = resolveMemoryDir(agentName, scope, cwd);
	if (writable) ensureMemoryDir(memoryDir);
	const existing = readMemoryIndex(memoryDir);
	const mode = writable ? "read-write" : "read-only";
	return [
		`# Agent Memory (${mode})`,
		`Memory scope: ${scope}`,
		`Memory directory: ${memoryDir}`,
		writable ? "Use this persistent directory to maintain useful long-term notes for this agent." : "You may reference existing memory, but do not create or modify memory files.",
		"",
		existing ? `## Current MEMORY.md\n${existing}` : "No MEMORY.md exists yet.",
		writable ? [
			"",
			"## Memory Instructions",
			"- Keep MEMORY.md concise (under 200 lines); store details in separate linked files.",
			"- Reject stale memories; update or remove outdated notes.",
			"- Use safe relative filenames inside the memory directory only.",
		].join("\n") : "",
	].filter(Boolean).join("\n");
}
