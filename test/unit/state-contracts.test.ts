import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionRunStatus, canTransitionTaskStatus, isTerminalRunStatus, isTerminalTaskStatus, isWakeableTeamEventType } from "../../src/state/contracts.ts";

test("state contracts define allowed transitions and terminal states", () => {
	assert.equal(canTransitionRunStatus("queued", "running"), true);
	assert.equal(canTransitionRunStatus("completed", "failed"), false);
	assert.equal(canTransitionRunStatus("failed", "running"), true);
	assert.equal(isTerminalRunStatus("completed"), true);
	assert.equal(isTerminalRunStatus("running"), false);

	assert.equal(canTransitionTaskStatus("queued", "running"), true);
	assert.equal(canTransitionTaskStatus("completed", "running"), false);
	assert.equal(canTransitionTaskStatus("completed", "queued"), true);
	assert.equal(isTerminalTaskStatus("skipped"), true);
	assert.equal(isTerminalTaskStatus("running"), false);

	assert.equal(isWakeableTeamEventType("task.completed"), true);
	assert.equal(isWakeableTeamEventType("run.created"), false);
});
