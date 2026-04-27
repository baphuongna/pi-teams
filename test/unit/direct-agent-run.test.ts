import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { loadRunManifestById } from "../../src/state/state-store.ts";

test("direct agent run creates a single task for requested agent", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-direct-agent-test-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	const previousExecute = process.env.PI_TEAMS_EXECUTE_WORKERS;
	const previousMock = process.env.PI_TEAMS_MOCK_CHILD_PI;
	process.env.PI_TEAMS_EXECUTE_WORKERS = "1";
	process.env.PI_TEAMS_MOCK_CHILD_PI = "json-success";
	try {
		const run = await handleTeamTool({ action: "run", agent: "explorer", goal: "Explore directly" }, { cwd });
		const runId = run.details.runId;
		assert.ok(runId);
		const loaded = loadRunManifestById(cwd, runId);
		assert.equal(loaded?.manifest.status, "completed");
		assert.equal(loaded?.manifest.team, "direct-explorer");
		assert.equal(loaded?.manifest.workflow, "direct-agent");
		assert.equal(loaded?.tasks.length, 1);
		assert.equal(loaded?.tasks[0]?.agent, "explorer");
		assert.equal(loaded?.tasks[0]?.status, "completed");
	} finally {
		if (previousExecute === undefined) delete process.env.PI_TEAMS_EXECUTE_WORKERS;
		else process.env.PI_TEAMS_EXECUTE_WORKERS = previousExecute;
		if (previousMock === undefined) delete process.env.PI_TEAMS_MOCK_CHILD_PI;
		else process.env.PI_TEAMS_MOCK_CHILD_PI = previousMock;
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
