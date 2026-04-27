import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createResultWatcher } from "../../src/extension/result-watcher.ts";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("result watcher primes existing JSON results and emits completion payloads", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-result-watcher-"));
	const emitted: unknown[] = [];
	try {
		fs.writeFileSync(path.join(dir, "one.json"), JSON.stringify({ runId: "one", status: "completed" }), "utf-8");
		const watcher = createResultWatcher({ emit: (_event, data) => emitted.push(data) }, dir);
		watcher.prime();
		await wait(20);
		watcher.stop();
		assert.deepEqual(emitted, [{ runId: "one", status: "completed" }]);
		assert.equal(fs.existsSync(path.join(dir, "one.json")), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("result watcher dedupes duplicate completion payloads within ttl", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-result-watcher-dedupe-"));
	const emitted: unknown[] = [];
	try {
		fs.writeFileSync(path.join(dir, "one.json"), JSON.stringify({ runId: "same", status: "completed" }), "utf-8");
		fs.writeFileSync(path.join(dir, "two.json"), JSON.stringify({ runId: "same", status: "completed" }), "utf-8");
		const watcher = createResultWatcher({ emit: (_event, data) => emitted.push(data) }, dir, { completionTtlMs: 60_000 });
		watcher.prime();
		await wait(30);
		watcher.stop();
		assert.equal(emitted.length, 1);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
