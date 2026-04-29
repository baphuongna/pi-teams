import test from "node:test";
import assert from "node:assert/strict";
import { renderHealthPane } from "../../src/ui/dashboard-panes/health-pane.ts";
import type { RunUiSnapshot } from "../../src/ui/snapshot-types.ts";
import type { TeamTaskState } from "../../src/state/types.ts";

function snapshot(tasks: TeamTaskState[]): RunUiSnapshot {
	return { runId: "run", cwd: process.cwd(), fetchedAt: 0, signature: "s", manifest: { schemaVersion: 1, runId: "run", cwd: process.cwd(), team: "t", workflow: "w", goal: "g", status: "running", createdAt: "", updatedAt: "", stateRoot: "", artifactsRoot: "", tasksPath: "", eventsPath: "", artifacts: [], workspaceMode: "single" }, tasks, agents: [], progress: { total: tasks.length, completed: 0, running: 0, failed: 0, queued: 0 }, usage: { tokensIn: 0, tokensOut: 0, toolUses: 0 }, mailbox: { inboxUnread: 0, outboxPending: 0, needsAttention: 0 }, recentEvents: [], recentOutputLines: [] };
}

function task(id: string, lastSeenAt?: string): TeamTaskState {
	return { id, runId: "run", role: "r", agent: "a", title: id, status: "running", dependsOn: [], cwd: process.cwd(), heartbeat: lastSeenAt ? { workerId: id, lastSeenAt, alive: true } : undefined };
}

test("health pane renders unavailable without snapshot", () => {
	assert.deepEqual(renderHealthPane(undefined), ["Health pane: snapshot unavailable"]);
});

test("health pane shows only diagnostic for healthy foreground run", () => {
	const lines = renderHealthPane(snapshot([task("a", "2026-01-01T00:00:00.000Z")]), { now: Date.parse("2026-01-01T00:00:01.000Z") });
	assert.ok(lines.some((line) => line.includes("1/1 healthy")));
	assert.ok(lines.some((line) => line.includes("D diagnostic export")));
	assert.equal(lines.some((line) => line.includes("R recovery")), false);
});

test("health pane disables recovery hints for async runs", () => {
	const lines = renderHealthPane(snapshot([task("a", "2026-01-01T00:00:00.000Z")]), { now: Date.parse("2026-01-01T00:10:00.000Z"), isForeground: false });
	assert.ok(lines.some((line) => line.includes("Async run")));
	assert.equal(lines.some((line) => line.includes("R recovery")), false);
});

test("health pane shows recovery and kill hints for dead foreground workers", () => {
	const lines = renderHealthPane(snapshot([task("a", "2026-01-01T00:00:00.000Z")]), { now: Date.parse("2026-01-01T00:10:00.000Z") });
	assert.ok(lines.some((line) => line.includes("R recovery")));
	assert.ok(lines.some((line) => line.includes("K kill stale")));
});

test("health pane shows kill hint for stale foreground workers", () => {
	const lines = renderHealthPane(snapshot([task("a", "2026-01-01T00:00:00.000Z")]), { now: Date.parse("2026-01-01T00:02:00.000Z") });
	assert.equal(lines.some((line) => line.includes("R recovery")), false);
	assert.ok(lines.some((line) => line.includes("K kill stale")));
});

test("health pane shows recovery hint for missing foreground heartbeat", () => {
	const lines = renderHealthPane(snapshot([task("missing")]), { now: Date.parse("2026-01-01T00:00:00.000Z") });
	assert.ok(lines.some((line) => line.includes("R recovery")));
});
