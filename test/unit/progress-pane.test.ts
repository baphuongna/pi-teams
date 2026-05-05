import test from "node:test";
import assert from "node:assert/strict";
import { renderProgressPane } from "../../src/ui/dashboard-panes/progress-pane.ts";
import type { RunUiSnapshot } from "../../src/ui/snapshot-types.ts";

function snapshot(reason?: string): RunUiSnapshot {
	return {
		runId: "run",
		cwd: process.cwd(),
		fetchedAt: 0,
		signature: "s",
		manifest: { schemaVersion: 1, runId: "run", cwd: process.cwd(), team: "t", workflow: "w", goal: "g", status: reason ? "cancelled" : "running", createdAt: "", updatedAt: "", stateRoot: "", artifactsRoot: "", tasksPath: "", eventsPath: "", artifacts: [], workspaceMode: "single" },
		tasks: [],
		agents: [],
		progress: { total: 0, completed: 0, running: 0, failed: 0, queued: 0 },
		usage: { tokensIn: 0, tokensOut: 0, toolUses: 0 },
		mailbox: { inboxUnread: 0, outboxPending: 0, needsAttention: 0 },
		cancellationReason: reason,
		recentEvents: [],
		recentOutputLines: [],
	};
}

test("renderProgressPane shows structured cancellation reason", () => {
	assert.ok(renderProgressPane(snapshot("leader_interrupted")).some((line) => line.includes("cancelled: reason=leader_interrupted")));
});
