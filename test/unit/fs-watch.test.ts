import test from "node:test";
import assert from "node:assert/strict";
import { closeWatcher, watchWithErrorHandler } from "../../src/utils/fs-watch.ts";


test("closeWatcher handles null input", () => {
	assert.doesNotThrow(() => {
		closeWatcher(null);
	});
});

test("watchWithErrorHandler invokes fallback when fs.watch throws", () => {
	let onErrorCalled = false;
	const nonExistent = `/tmp/pi-crew-watch-missing-${Date.now()}`;
	const watcher = watchWithErrorHandler(nonExistent, () => {}, () => {
		onErrorCalled = true;
	});
	assert.equal(watcher, null);
	assert.equal(onErrorCalled, true);
});
