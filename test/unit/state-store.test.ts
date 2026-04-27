import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createRunManifest, loadRunManifestById } from "../../src/state/state-store.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

const team: TeamConfig = {
	name: "default",
	description: "default",
	source: "builtin",
	filePath: "default.team.md",
	roles: [{ name: "planner", agent: "planner" }],
};

const workflow: WorkflowConfig = {
	name: "default",
	description: "default",
	source: "builtin",
	filePath: "default.workflow.md",
	steps: [{ id: "plan", role: "planner", task: "Plan {goal}" }],
};

test("createRunManifest writes manifest and tasks", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-state-test-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	try {
		const created = createRunManifest({ cwd, team, workflow, goal: "test" });
		assert.ok(fs.existsSync(created.paths.manifestPath));
		assert.ok(fs.existsSync(created.paths.tasksPath));
		assert.equal(created.tasks.length, 1);
		const loaded = loadRunManifestById(cwd, created.manifest.runId);
		assert.equal(loaded?.manifest.goal, "test");
		assert.equal(loaded?.tasks[0]?.role, "planner");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
