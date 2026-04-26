import test from "node:test";
import assert from "node:assert/strict";
import { getPiSpawnCommand } from "../../src/runtime/pi-spawn.ts";

test("getPiSpawnCommand preserves requested args", () => {
	const spec = getPiSpawnCommand(["--version"]);
	assert.ok(spec.command.length > 0);
	assert.ok(spec.args.includes("--version"));
});
