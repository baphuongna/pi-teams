import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultSkillsForRole, normalizeSkillOverride, renderSkillInstructions, resolveTaskSkillNames } from "../../src/runtime/skill-instructions.ts";
import { renderTaskPrompt } from "../../src/runtime/task-runner/prompt-builder.ts";
import type { AgentConfig } from "../../src/agents/agent-config.ts";
import type { TeamRunManifest, TeamTaskState } from "../../src/state/types.ts";
import type { WorkflowStep } from "../../src/workflows/workflow-config.ts";

const manifest: TeamRunManifest = {
	schemaVersion: 1,
	runId: "run-skills",
	cwd: process.cwd(),
	team: "implementation",
	workflow: "default",
	goal: "fix skills",
	status: "running",
	workspaceMode: "single",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	stateRoot: process.cwd(),
	artifactsRoot: process.cwd(),
	tasksPath: "tasks.json",
	eventsPath: "events.jsonl",
	artifacts: [],
};

const task: TeamTaskState = {
	id: "01_explore",
	runId: manifest.runId,
	role: "explorer",
	agent: "explorer",
	title: "Explore",
	status: "running",
	dependsOn: [],
	cwd: process.cwd(),
};

const step: WorkflowStep = { id: "explore", role: "explorer", task: "Explore {goal}" };
const agent: AgentConfig = { name: "explorer", description: "", source: "builtin", filePath: "builtin", systemPrompt: "", skills: ["safe-bash"] };

test("defaultSkillsForRole maps pi-crew roles to useful skills", () => {
	assert.ok(defaultSkillsForRole("explorer").includes("read-only-explorer"));
	assert.ok(defaultSkillsForRole("security-reviewer").includes("ownership-session-security"));
});

test("resolveTaskSkillNames combines role defaults, agent, team role, step, and override", () => {
	const names = resolveTaskSkillNames({
		role: "explorer",
		agent,
		teamRole: { skills: ["runtime-state-reader"] },
		step: { skills: ["resource-discovery-config"] },
		override: ["git-master"],
	});
	assert.ok(names.includes("read-only-explorer"));
	assert.ok(names.includes("safe-bash"));
	assert.ok(names.includes("runtime-state-reader"));
	assert.ok(names.includes("resource-discovery-config"));
	assert.ok(names.includes("git-master"));
	assert.equal(new Set(names).size, names.length);
});

test("skill false disables defaults while explicit override can add targeted skills", () => {
	assert.deepEqual(resolveTaskSkillNames({ role: "explorer", override: false }), []);
	assert.deepEqual(resolveTaskSkillNames({ role: "explorer", teamRole: { skills: false }, override: ["git-master"] }), ["git-master"]);
});

test("resolveTaskSkillNames drops unsafe skill names", () => {
	const names = resolveTaskSkillNames({ role: "unknown", override: ["git-master", "../secret", "bad/name", "x".repeat(200)] });
	assert.deepEqual(names, ["git-master"]);
});

test("normalizeSkillOverride accepts comma strings, arrays, true, and false", () => {
	assert.deepEqual(normalizeSkillOverride("git-master, safe-bash"), ["git-master", "safe-bash"]);
	assert.deepEqual(normalizeSkillOverride(["verify-evidence"]), ["verify-evidence"]);
	assert.equal(normalizeSkillOverride(true), undefined);
	assert.equal(normalizeSkillOverride(false), false);
});

test("renderSkillInstructions loads selected SKILL.md content for worker prompts", () => {
	const rendered = renderSkillInstructions({ cwd: process.cwd(), role: "verifier", override: ["verify-evidence"] });
	assert.ok(rendered.names.includes("verify-evidence"));
	assert.match(rendered.block, /# Applicable Skills/);
	assert.match(rendered.block, /verify-evidence/);
	assert.match(rendered.block, /Final verification evidence checklist/);
	assert.match(rendered.block, /Source: (project|package):skills\/verify-evidence/);
	assert.doesNotMatch(rendered.block, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});


test("renderSkillInstructions uses project skills before package skills", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-skill-"));
	try {
		const skillDir = path.join(cwd, "skills", "verify-evidence");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), ["---", "name: verify-evidence", "description: Project override", "---", "", "# Project Skill", "", "Project-specific verification."].join("\n"));
		const rendered = renderSkillInstructions({ cwd, role: "unknown", override: ["verify-evidence"] });
		assert.match(rendered.block, /Project-specific verification/);
		assert.match(rendered.block, /Source: project:skills\/verify-evidence/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("renderSkillInstructions reports missing safe skills without echoing unsafe names", () => {
	const rendered = renderSkillInstructions({ cwd: process.cwd(), role: "unknown", override: ["missing-skill", "../secret"] });
	assert.match(rendered.block, /missing-skill/);
	assert.doesNotMatch(rendered.block, /\.\.\/secret/);
});

function writeProjectSkill(cwd: string, name: string, body: string): void {
	const skillDir = path.join(cwd, "skills", name);
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(path.join(skillDir, "SKILL.md"), ["---", `name: ${name}`, `description: ${name} description`, "---", "", body].join("\n"));
}

test("renderSkillInstructions truncates oversized individual skills", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-skill-"));
	try {
		writeProjectSkill(cwd, "giant-skill", `# Giant\n\n${"A".repeat(5000)}\n\n## Verification\nshould be trimmed`);
		const rendered = renderSkillInstructions({ cwd, role: "unknown", override: ["giant-skill"] });
		assert.match(rendered.block, /skill instructions truncated/);
		assert.ok(rendered.block.length < 3500);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("renderSkillInstructions enforces total skill budget", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-skill-"));
	try {
		const names = ["budget-a", "budget-b", "budget-c", "budget-d", "budget-e", "budget-f"];
		for (const name of names) writeProjectSkill(cwd, name, `# ${name}\n\n${"B".repeat(5000)}`);
		const rendered = renderSkillInstructions({ cwd, role: "unknown", override: names });
		assert.match(rendered.block, /omitted: skill instruction budget exceeded/);
		assert.ok(rendered.block.length < 13_000);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("renderTaskPrompt includes the selected skill instruction block", () => {
	const skillBlock = renderSkillInstructions({ cwd: process.cwd(), role: "explorer", override: ["read-only-explorer"] }).block;
	const prompt = renderTaskPrompt(manifest, step, task, agent, skillBlock);
	assert.match(prompt, /# Applicable Skills/);
	assert.match(prompt, /read-only-explorer/);
	assert.match(prompt, /# Task Packet|Task:/);
});
