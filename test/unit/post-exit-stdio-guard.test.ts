import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { trySignalChild, attachPostExitStdioGuard } from "../../src/runtime/post-exit-stdio-guard.ts";

class MockPipedChild extends EventEmitter {
	readonly stdout: PassThrough;
	readonly stderr: PassThrough;

	constructor() {
		super();
		this.stdout = new PassThrough();
		this.stderr = new PassThrough();
	}

	kill(): boolean {
		return true;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

test("trySignalChild reports whether a termination signal was actually delivered", () => {
	assert.equal(trySignalChild({ kill: () => true }, "SIGTERM"), true);
	assert.equal(trySignalChild({ kill: () => false }, "SIGTERM"), false);
	assert.equal(trySignalChild({ kill: () => { throw new Error("gone"); } }, "SIGTERM"), false);
});

test("idle timer closes post-exit silent streams", async () => {
	const child = new MockPipedChild();
	attachPostExitStdioGuard(child as unknown as Parameters<typeof attachPostExitStdioGuard>[0], {
		idleMs: 1500,
		hardMs: 8000,
	});
	child.emit("exit", 0, null);
	await sleep(2200);
	assert.ok(child.stdout.destroyed);
	assert.ok(child.stderr.destroyed);
});

test("hard timer closes chatty streams", async () => {
	const child = new MockPipedChild();
	const start = Date.now();
	attachPostExitStdioGuard(child as unknown as Parameters<typeof attachPostExitStdioGuard>[0], {
		idleMs: 1000,
		hardMs: 2000,
	});
	child.emit("exit", 0, null);

	const spamInterval = setInterval(() => {
		child.stdout.write("tick\n");
		child.stderr.write("tick\n");
	}, 200);
	await sleep(5000);
	clearInterval(spamInterval);

	assert.ok(Date.now() - start >= 2000 - 500);
	assert.ok(child.stdout.destroyed);
	assert.ok(child.stderr.destroyed);
});
