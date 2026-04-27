import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { __test__renameWithRetry, atomicWriteFile } from "../../src/state/atomic-write.ts";

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

test("renameWithRetry retries transient Windows rename failures", () => {
	let calls = 0;
	__test__renameWithRetry("from.tmp", "to.json", 3, () => {
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
