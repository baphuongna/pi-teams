import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { __test__renameWithRetry, __test__renameWithRetryAsync, atomicWriteFile, atomicWriteFileAsync } from "../../src/state/atomic-write.ts";

function eperm(): NodeJS.ErrnoException {
	const error = new Error("locked") as NodeJS.ErrnoException;
	error.code = "EPERM";
	return error;
}

test("atomicWriteFile writes through a temp file", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-atomic-write-"));
	const filePath = path.join(cwd, "state.json");
	try {
		atomicWriteFile(filePath, "ok\n");
		assert.equal(fs.readFileSync(filePath, "utf-8"), "ok\n");
		assert.deepEqual(fs.readdirSync(cwd), ["state.json"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("atomicWriteFileAsync writes through a temp file", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-atomic-write-async-"));
	const filePath = path.join(cwd, "state.json");
	try {
		await atomicWriteFileAsync(filePath, "ok\n");
		assert.equal(fs.readFileSync(filePath, "utf-8"), "ok\n");
		assert.deepEqual(fs.readdirSync(cwd), ["state.json"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("renameWithRetry retries transient Windows rename failures", () => {
	let calls = 0;
	__test__renameWithRetry("from.tmp", "to.json", 2, () => {
		calls++;
		if (calls < 3) throw eperm();
	});
	assert.equal(calls, 3);
});

test("renameWithRetryAsync retries transient Windows rename failures", async () => {
	let calls = 0;
	await __test__renameWithRetryAsync("from.tmp", "to.json", 2, async () => {
		calls++;
		if (calls < 3) throw eperm();
	});
	assert.equal(calls, 3);
});

test("renameWithRetry rethrows permanent Windows rename failures", () => {
	let calls = 0;
	assert.throws(() => __test__renameWithRetry("from.tmp", "to.json", 2, () => {
		calls++;
		throw eperm();
	}), /locked/);
	assert.equal(calls, 3);
});

test("renameWithRetryAsync rethrows permanent Windows rename failures", async () => {
	let calls = 0;
	try {
		await __test__renameWithRetryAsync("from.tmp", "to.json", 2, async () => {
			calls++;
			throw eperm();
		});
		assert.fail("Expected rejection");
	} catch (error) {
		assert.match((error as Error).message, /locked/);
	}
	assert.equal(calls, 3);
});

test("atomicWriteFileAsync treats same-content concurrent writes as success", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-atomic-write-async-"));
	const filePath = path.join(cwd, "state.json");
	const content = "same content\n";
	try {
		await Promise.all(Array.from({ length: 20 }, () => atomicWriteFileAsync(filePath, content)));
		assert.equal(fs.readFileSync(filePath, "utf-8"), content);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
