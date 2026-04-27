import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("events and artifacts actions inspect a durable run", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-inspect-test-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	try {
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "Inspect run" }, { cwd });
		const runId = run.details.runId;
		assert.ok(runId);
		const events = await handleTeamTool({ action: "events", runId }, { cwd });
		assert.equal(events.isError, false);
		assert.match(events.content[0]?.text ?? "", /run.created/);
		assert.match(events.content[0]?.text ?? "", /task.completed/);
		const artifacts = await handleTeamTool({ action: "artifacts", runId }, { cwd });
		assert.equal(artifacts.isError, false);
		assert.match(artifacts.content[0]?.text ?? "", /goal.md/);
		assert.match(artifacts.content[0]?.text ?? "", /sha256=/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
