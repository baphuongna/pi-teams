import test from "node:test";
import assert from "node:assert/strict";
import { SubagentManager, type SubagentSpawnOptions } from "../../src/runtime/subagent-manager.ts";
import { toolResult } from "../../src/extension/tool-result.ts";

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
		return toolResult(`done ${started}`, { action: "run", status: "ok" });
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
	const runner = async () => toolResult("done", { action: "run", status: "ok" });
	const foreground = manager.spawn({ cwd: process.cwd(), type: "writer", description: "fg", prompt: "do", background: false }, runner);
	await foreground.promise;
	const background = manager.spawn({ cwd: process.cwd(), type: "writer", description: "bg", prompt: "do", background: true }, runner);
	await background.promise;
	assert.deepEqual(completed, [false, true]);
});
