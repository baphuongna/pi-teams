import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "../agents/agent-config.ts";
import type { TeamRole } from "../teams/team-config.ts";
import type { WorkflowStep } from "../workflows/workflow-config.ts";
import { isSafePathId, resolveContainedPath, resolveRealContainedPath } from "../utils/safe-paths.ts";

const PACKAGE_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
const MAX_SKILL_CHARS = 1500;
const MAX_TOTAL_CHARS = 6000;
const MAX_SKILL_NAME_CHARS = 80;
const MAX_SELECTED_SKILLS = 32;
const SKILL_CACHE_MAX_ENTRIES = 128;

const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
	explorer: ["read-only-explorer", "context-artifact-hygiene"],
	analyst: ["read-only-explorer", "requirements-to-task-packet"],
	planner: ["delegation-patterns", "requirements-to-task-packet"],
	critic: ["read-only-explorer", "multi-perspective-review"],
	executor: ["state-mutation-locking", "safe-bash", "verification-before-done"],
	reviewer: ["read-only-explorer", "multi-perspective-review"],
	"security-reviewer": ["secure-agent-orchestration-review", "ownership-session-security"],
	"test-engineer": ["verification-before-done", "safe-bash"],
	verifier: ["verification-before-done", "runtime-state-reader"],
	writer: ["context-artifact-hygiene", "verify-evidence"],
};

export interface ResolveTaskSkillsInput {
	role: string;
	agent?: Pick<AgentConfig, "skills">;
	teamRole?: Pick<TeamRole, "skills">;
	step?: Pick<WorkflowStep, "skills">;
	override?: string[] | false;
}

export interface RenderSkillInstructionsInput extends ResolveTaskSkillsInput {
	cwd: string;
}

function isValidSkillName(name: string): boolean {
	return name.length > 0 && name.length <= MAX_SKILL_NAME_CHARS && isSafePathId(name);
}

function sanitizeSkillName(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_SKILL_NAME_CHARS) || "invalid";
}

function unique(items: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of items.map((entry) => entry.trim()).filter(Boolean)) {
		if (!isValidSkillName(item)) continue;
		if (seen.has(item)) continue;
		seen.add(item);
		result.push(item);
	}
	return result;
}

export function normalizeSkillOverride(value: string | string[] | boolean | undefined): string[] | false | undefined {
	if (value === false) return false;
	if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
	if (value === true) return undefined;
	if (Array.isArray(value)) return value.map((entry) => entry.trim()).filter(Boolean);
	return undefined;
}

export function defaultSkillsForRole(role: string): string[] {
	return DEFAULT_ROLE_SKILLS[role] ?? [];
}

function collectTaskSkillNames(input: ResolveTaskSkillsInput): string[] {
	if (input.override === false) return [];
	const roleDefaultsDisabled = input.teamRole?.skills === false || input.step?.skills === false;
	const names = roleDefaultsDisabled ? [] : defaultSkillsForRole(input.role);
	if (input.agent?.skills?.length) names.push(...input.agent.skills);
	if (Array.isArray(input.teamRole?.skills)) names.push(...input.teamRole.skills);
	if (Array.isArray(input.step?.skills)) names.push(...input.step.skills);
	if (Array.isArray(input.override)) names.push(...input.override);
	return unique(names);
}

export function resolveTaskSkillNames(input: ResolveTaskSkillsInput): string[] {
	return collectTaskSkillNames(input).slice(0, MAX_SELECTED_SKILLS);
}

function candidateSkillDirs(cwd: string): Array<{ root: string; source: "project" | "package" }> {
	return [
		{ root: path.resolve(cwd, "skills"), source: "project" },
		{ root: PACKAGE_SKILLS_DIR, source: "package" },
	];
}

interface CachedSkillMarkdown {
	path: string;
	source: "project" | "package";
	content: string;
	mtimeMs: number;
	size: number;
}

const skillReadCache = new Map<string, CachedSkillMarkdown>();

function rememberSkill(key: string, value: CachedSkillMarkdown): CachedSkillMarkdown {
	if (skillReadCache.has(key)) skillReadCache.delete(key);
	skillReadCache.set(key, value);
	while (skillReadCache.size > SKILL_CACHE_MAX_ENTRIES) {
		const oldest = skillReadCache.keys().next().value;
		if (!oldest) break;
		skillReadCache.delete(oldest);
	}
	return value;
}

export function clearSkillInstructionCache(): void {
	skillReadCache.clear();
}

function cachedSkillFresh(value: CachedSkillMarkdown): boolean {
	try {
		const stat = fs.statSync(value.path);
		return stat.mtimeMs === value.mtimeMs && stat.size === value.size;
	} catch {
		return false;
	}
}

function readSkillMarkdown(cwd: string, name: string): { path: string; source: "project" | "package"; content: string } | undefined {
	if (!isValidSkillName(name)) return undefined;
	const cacheKey = `${path.resolve(cwd)}:${name}`;
	const cached = skillReadCache.get(cacheKey);
	if (cached && cachedSkillFresh(cached)) return cached;
	if (cached) skillReadCache.delete(cacheKey);
	for (const entry of candidateSkillDirs(cwd)) {
		try {
			const relative = path.join(name, "SKILL.md");
			const contained = resolveContainedPath(entry.root, relative);
			if (!fs.existsSync(contained)) continue;
			if (fs.lstatSync(contained).isSymbolicLink()) continue;
			const filePath = resolveRealContainedPath(entry.root, relative);
			const stat = fs.statSync(filePath);
			return rememberSkill(cacheKey, { path: filePath, source: entry.source, content: fs.readFileSync(filePath, "utf-8"), mtimeMs: stat.mtimeMs, size: stat.size });
		} catch {
			continue;
		}
	}
	return undefined;
}

function frontmatterDescription(content: string): string | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match) return undefined;
	const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith("description:"));
	return line?.slice("description:".length).trim();
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function compactSkillContent(content: string): string {
	const body = stripFrontmatter(content);
	if (body.length <= MAX_SKILL_CHARS) return body;
	const preferred = body.split(/\r?\n## Verification\r?\n/)[0]?.trim() ?? body;
	const truncated = preferred.length > MAX_SKILL_CHARS ? preferred.slice(0, MAX_SKILL_CHARS - 40).trimEnd() : preferred;
	return `${truncated}\n\n[skill instructions truncated]`;
}

export interface RenderedSkillInstructions {
	names: string[];
	paths: string[];
	block: string;
}

export function renderSkillInstructions(input: RenderSkillInstructionsInput): RenderedSkillInstructions {
	const allNames = collectTaskSkillNames(input);
	const names = allNames.slice(0, MAX_SELECTED_SKILLS);
	const overflowCount = Math.max(0, allNames.length - names.length);
	if (names.length === 0) return { names, paths: [], block: "" };
	const sections: string[] = [];
	const skillPaths: string[] = [];
	let total = 0;
	let omittedCount = overflowCount;
	const pushSection = (section: string): boolean => {
		if (total + section.length > MAX_TOTAL_CHARS) return false;
		sections.push(section);
		total += section.length;
		return true;
	};
	for (const name of names) {
		const safeName = sanitizeSkillName(name);
		const loaded = readSkillMarkdown(input.cwd, name);
		if (!loaded) {
			const missing = `## ${safeName}\n\nSkill '${safeName}' was selected but no SKILL.md file was found. Continue with the task packet and report this missing skill.`;
			if (!pushSection(missing)) omittedCount += 1;
			continue;
		}
		skillPaths.push(path.dirname(loaded.path));
		const description = frontmatterDescription(loaded.content);
		const source = loaded.source === "project" ? `project:skills/${safeName}` : `package:skills/${safeName}`;
		const header = [`## ${safeName}`, description ? `Description: ${description}` : undefined, `Source: ${source}`].filter(Boolean).join("\n");
		const section = `${header}\n\n${compactSkillContent(loaded.content)}`;
		if (!pushSection(section)) omittedCount += 1;
	}
	if (omittedCount > 0) {
		const summary = `## Omitted skills\n\n[omitted ${omittedCount} selected skill(s): skill instruction budget exceeded]`;
		if (!pushSection(summary) && sections.length > 0) {
			sections[sections.length - 1] = summary;
		}
	}
	return {
		names,
		paths: [...new Set(skillPaths)],
		block: [
			"# Applicable Skills",
			"The following skills were selected for this worker. Follow them when they match the current task. If a selected skill conflicts with the explicit task packet, project AGENTS.md, or user request, follow the stricter/higher-priority instruction and report the conflict.",
			"",
			sections.join("\n\n---\n\n"),
		].join("\n"),
	};
}
