import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleCleanup } from "../../src/extension/team-tool/lifecycle-actions.ts";
import { readEvents } from "../../src/state/event-log.ts";
import { createRunManifest } from "../../src/state/state-store.ts";

function createRun(): { cwd: string; runId: string; eventsPath: string } {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lifecycle-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	const team = { name: "lifecycle", description: "", roles: [{ name: "worker", agent: "worker" }], source: "test", filePath: "builtin" } as never;
	const workflow = { name: "wf", description: "", steps: [{ id: "one", role: "worker" }], source: "test", filePath: "builtin" } as never;
	const created = createRunManifest({ cwd, team, workflow, goal: "lifecycle" });
	return { cwd, runId: created.manifest.runId, eventsPath: created.manifest.eventsPath };
}

test("handleCleanup records audit intent on worktree cleanup events", () => {
	const run = createRun();
	try {
		const result = handleCleanup({ action: "cleanup", runId: run.runId, config: { _intent: "clean temporary worktrees before release" } }, { cwd: run.cwd });
		assert.equal(result.isError, false);
		assert.equal(result.details.intent, "clean temporary worktrees before release");
		const events = readEvents(run.eventsPath);
		assert.ok(events.some((event) => event.type === "worktree.cleanup" && event.data?.intent === "clean temporary worktrees before release"));
	} finally {
		fs.rmSync(run.cwd, { recursive: true, force: true });
	}
});
