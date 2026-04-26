import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig, ResourceSource } from "./agent-config.ts";
import { parseCsv, parseFrontmatter } from "../utils/frontmatter.ts";
import { packageRoot, projectPiRoot, userPiRoot } from "../utils/paths.ts";

export interface AgentDiscoveryResult {
	builtin: AgentConfig[];
	user: AgentConfig[];
	project: AgentConfig[];
}

function parseCost(value: string | undefined): "free" | "cheap" | "expensive" | undefined {
	return value === "free" || value === "cheap" || value === "expensive" ? value : undefined;
}

function parseAgentFile(filePath: string, source: ResourceSource): AgentConfig | undefined {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter(content);
		const name = frontmatter.name?.trim() || path.basename(filePath, path.extname(filePath));
		const description = frontmatter.description?.trim() || "No description provided.";
		const triggers = parseCsv(frontmatter.triggers ?? frontmatter.trigger);
		const useWhen = parseCsv(frontmatter.useWhen);
		const avoidWhen = parseCsv(frontmatter.avoidWhen);
		const cost = parseCost(frontmatter.cost);
		const category = frontmatter.category?.trim() || undefined;
		return {
			name,
			description,
			source,
			filePath,
			systemPrompt: body.trim(),
			model: frontmatter.model || undefined,
			fallbackModels: parseCsv(frontmatter.fallbackModels),
			thinking: frontmatter.thinking || undefined,
			tools: parseCsv(frontmatter.tools),
			extensions: frontmatter.extensions === "" ? [] : parseCsv(frontmatter.extensions),
			skills: parseCsv(frontmatter.skills ?? frontmatter.skill),
			systemPromptMode: frontmatter.systemPromptMode === "append" ? "append" : "replace",
			inheritProjectContext: frontmatter.inheritProjectContext === "true",
			inheritSkills: frontmatter.inheritSkills === "true",
			routing: triggers || useWhen || avoidWhen || cost || category ? { triggers, useWhen, avoidWhen, cost, category } : undefined,
		};
	} catch {
		return undefined;
	}
}

function readAgentDir(dir: string, source: ResourceSource): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter((entry) => entry.endsWith(".md") && !entry.endsWith(".team.md") && !entry.endsWith(".workflow.md"))
		.map((entry) => parseAgentFile(path.join(dir, entry), source))
		.filter((agent): agent is AgentConfig => agent !== undefined)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverAgents(cwd: string): AgentDiscoveryResult {
	return {
		builtin: readAgentDir(path.join(packageRoot(), "agents"), "builtin"),
		user: readAgentDir(path.join(userPiRoot(), "agents"), "user"),
		project: readAgentDir(path.join(projectPiRoot(cwd), "agents"), "project"),
	};
}

export function allAgents(discovery: AgentDiscoveryResult): AgentConfig[] {
	const byName = new Map<string, AgentConfig>();
	for (const agent of [...discovery.builtin, ...discovery.user, ...discovery.project]) {
		byName.set(agent.name, agent);
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
