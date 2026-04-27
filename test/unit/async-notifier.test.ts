import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startAsyncRunNotifier, stopAsyncRunNotifier, type AsyncNotifierState } from "../../src/extension/async-notifier.ts";
import { createRunManifest, saveRunManifest } from "../../src/state/state-store.ts";
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

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("async notifier suppresses pre-existing active runs that later become failed", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-notifier-existing-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	const notifications: Array<{ text: string; level?: string }> = [];
	const state: AsyncNotifierState = { seenFinishedRunIds: new Set() };
	try {
		const created = createRunManifest({ cwd, team, workflow, goal: "pre-existing" });
		saveRunManifest({ ...created.manifest, status: "running" });
		startAsyncRunNotifier({ cwd, ui: { notify: (text: string, level?: string) => notifications.push({ text, level }) } } as never, state, 10);
		saveRunManifest({ ...created.manifest, status: "failed", summary: "stale" });
		await wait(40);
		assert.equal(notifications.length, 0);
	} finally {
		stopAsyncRunNotifier(state);
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("async notifier still reports runs created after notifier start", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-notifier-new-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	const notifications: Array<{ text: string; level?: string }> = [];
	const state: AsyncNotifierState = { seenFinishedRunIds: new Set() };
	try {
		startAsyncRunNotifier({ cwd, ui: { notify: (text: string, level?: string) => notifications.push({ text, level }) } } as never, state, 10);
		const created = createRunManifest({ cwd, team, workflow, goal: "new run" });
		saveRunManifest({ ...created.manifest, status: "completed" });
		await wait(40);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0]!.text, /completed/);
		assert.equal(notifications[0]!.level, "info");
	} finally {
		stopAsyncRunNotifier(state);
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
