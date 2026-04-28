import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SUBAGENT } from "../../src/config/defaults.ts";
import { SubagentManager, type SubagentSpawnOptions } from "../../src/runtime/subagent-manager.ts";
import { toolResult } from "../../src/extension/tool-result.ts";
import { createRunManifest, updateRunStatus } from "../../src/state/state-store.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

test("subagent manager queues background work and waitForRecord waits for queued records", async () => {
	const first = deferred();
	const second = deferred();
	const completed: string[] = [];
	const manager = new SubagentManager(1, (record) => completed.push(`${record.id}:${record.status}:${record.background}`), 5);
	const base: SubagentSpawnOptions = { cwd: process.cwd(), type: "explorer", description: "test", prompt: "do work", background: true };
	let started = 0;
	const runner = async () => {
		started++;
		await (started === 1 ? first.promise : second.promise);
		return toolResult(`done ${started}`, { action: "run", status: "ok" as const });
	};
	const a = manager.spawn(base, runner);
	const b = manager.spawn(base, runner);
	assert.equal(a.status, "running");
	assert.equal(b.status, "queued");
	const waitSecond = manager.waitForRecord(b.id);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(started, 1);
	first.resolve();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(started, 2);
	second.resolve();
	const waited = await waitSecond;
	assert.equal(waited?.status, "completed");
	assert.deepEqual(completed.map((entry) => entry.split(":").slice(1).join(":")), ["completed:true", "completed:true"]);
});

test("subagent manager preserves foreground/background flag for notification policy", async () => {
	const completed: boolean[] = [];
	const manager = new SubagentManager(1, (record) => completed.push(record.background), 5);
	const runner = async () => toolResult("done", { action: "run", status: "ok" as const });
	const foreground = manager.spawn({ cwd: process.cwd(), type: "writer", description: "fg", prompt: "do", background: false }, runner);
	await foreground.promise;
	const background = manager.spawn({ cwd: process.cwd(), type: "writer", description: "bg", prompt: "do", background: true }, runner);
	await background.promise;
	assert.deepEqual(completed, [false, true]);
});

test("subagent manager treats blocked run status as blocked callback", async () => {
	const completed: string[] = [];
	const team: TeamConfig = {
		name: "blocked",
		description: "blocked",
		source: "builtin",
		filePath: "blocked.team.md",
		roles: [{ name: "executor", agent: "executor" }],
	};
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-subagent-blocked-"));
	const teamDir = path.join(cwd, ".pi", "teams");
	try {
		fs.mkdirSync(teamDir, { recursive: true });
		const { manifest } = createRunManifest({ cwd, team, goal: "subagent blocked" });
		const running = updateRunStatus(manifest, "running", "running subagent run");
		const manager = new SubagentManager(1, (record) => {
			completed.push(`${record.id}:${record.status}`);
		}, 1);
		const runner = async () => {
			updateRunStatus(running, "blocked", "blocked by test");
			return toolResult("blocked", { action: "run", status: "ok" as const, runId: running.runId });
		};
		const record = manager.spawn({ cwd, type: "executor", description: "blocker", prompt: "do", background: true }, runner);
		await record.promise;
		assert.equal(record.status, "blocked");
		assert.equal(completed.length, 1);
		assert.ok(completed[0]?.endsWith(":blocked"));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("subagent manager emits stuck-blocked event when blocked persists", async () => {
	const team: TeamConfig = {
		name: "blocked",
		description: "blocked",
		source: "builtin",
		filePath: "blocked.team.md",
		roles: [{ name: "executor", agent: "executor" }],
	};
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-subagent-stuck-"));
	const teamDir = path.join(cwd, ".pi", "teams");
	const previousThreshold = DEFAULT_SUBAGENT.stuckBlockedNotifyMs;
	const events: string[] = [];
	try {
		DEFAULT_SUBAGENT.stuckBlockedNotifyMs = 1;
		fs.mkdirSync(teamDir, { recursive: true });
		const { manifest } = createRunManifest({ cwd, team, goal: "stuck subagent" });
		const running = updateRunStatus(manifest, "running", "running subagent run");
		let blocked = false;
		const manager = new SubagentManager(1, undefined, 1, (_type, payload) => {
			events.push(payload.event as string);
			if (_type === "subagent.stuck-blocked") {
				blocked = true;
			}
		});
		const runner = async () => {
			updateRunStatus(running, "blocked", "blocked by test");
			return toolResult("running", { action: "run", status: "ok" as const, runId: running.runId });
		};
		const record = manager.spawn({ cwd, type: "executor", description: "blocker", prompt: "do", background: true }, runner);
		await record.promise;
		assert.equal(record.status, "blocked");
		const deadline = Date.now() + 1000;
		while (!blocked && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.equal(blocked, true);
		assert.equal(events.includes("subagent.stuck-blocked"), true);
	} finally {
		DEFAULT_SUBAGENT.stuckBlockedNotifyMs = previousThreshold;
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
