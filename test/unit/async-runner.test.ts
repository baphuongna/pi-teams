import test from "node:test";
import assert from "node:assert/strict";
import { getBackgroundRunnerCommand } from "../../src/runtime/async-runner.ts";

test("background runner uses a TypeScript loader that can run from installed node_modules", () => {
	const command = getBackgroundRunnerCommand("/tmp/node_modules/pi-crew/src/runtime/background-runner.ts", "/tmp/project", "run_123");
	assert.equal(command.loader, "jiti");
	assert.equal(command.args.includes("--experimental-strip-types"), false);
	assert.equal(command.args[0]?.endsWith("jiti-cli.mjs"), true);
	assert.equal(command.args[1], "/tmp/node_modules/pi-crew/src/runtime/background-runner.ts");
	assert.deepEqual(command.args.slice(-4), ["--cwd", "/tmp/project", "--run-id", "run_123"]);
});
