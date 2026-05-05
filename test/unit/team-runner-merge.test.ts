import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __test__mergeTaskUpdates, executeTeamRun } from "../../src/runtime/team-runner.ts";
import { createRunManifest, saveRunTasks } from "../../src/state/state-store.ts";
import type { TeamTaskState } from "../../src/state/types.ts";

function task(id: string, status: TeamTaskState["status"]): TeamTaskState {
	return {
		id,
		runId: "run_merge",
		stepId: id,
		role: "explorer",
		agent: "explorer",
		title: id,
		status,
		dependsOn: [],
		cwd: "/tmp/project",
		graph: { taskId: id, children: [], dependencies: [], queue: status === "queued" ? "ready" : status === "running" ? "running" : "done" },
	};
}

test("parallel task merge does not regress completed tasks from stale worker snapshots", () => {
	const base = [task("a", "queued"), task("b", "queued")];
	const resultA = { tasks: [{ ...task("a", "completed"), finishedAt: "2026-01-01T00:00:00.000Z" }, task("b", "running")] };
	const resultB = { tasks: [task("a", "running"), { ...task("b", "completed"), finishedAt: "2026-01-01T00:00:01.000Z" }] };
	const merged = __test__mergeTaskUpdates(base, [resultA, resultB]);
	assert.equal(merged.find((item) => item.id === "a")?.status, "completed");
	assert.equal(merged.find((item) => item.id === "b")?.status, "completed");
});

test("executeTeamRun blocks instead of completing when tasks are waiting", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-waiting-run-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const team = { name: "waiting", description: "", roles: [{ name: "worker", agent: "worker" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "waiting", description: "", steps: [{ id: "wait", role: "worker" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "wait" });
		const tasks: TeamTaskState[] = [{ id: "wait", runId: created.manifest.runId, stepId: "wait", role: "worker", agent: "worker", title: "wait", status: "waiting", dependsOn: [], cwd }];
		saveRunTasks(created.manifest, tasks);
		const result = await executeTeamRun({ manifest: { ...created.manifest, status: "running" }, tasks, team, workflow, agents: [], executeWorkers: false });
		assert.equal(result.manifest.status, "blocked");
		assert.match(result.manifest.summary ?? "", /Waiting for response/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
