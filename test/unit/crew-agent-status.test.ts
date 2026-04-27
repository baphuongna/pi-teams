import test from "node:test";
import assert from "node:assert/strict";
import { taskStatusToAgentStatus } from "../../src/runtime/crew-agent-runtime.ts";

test("skipped tasks are terminal non-queued agent records", () => {
	assert.equal(taskStatusToAgentStatus("skipped"), "cancelled");
});
