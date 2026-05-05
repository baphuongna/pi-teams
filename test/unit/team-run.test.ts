import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { firstText } from "../fixtures/tool-result-helpers.ts";

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

test("team run creates durable artifacts and status", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-run-test-"));
	fs.mkdirSync(path.join(cwd, ".crew"));
	try {
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "default", goal: "Test durable run" }, { cwd });
		assert.equal(run.isError, false);
		const runId = run.details.runId;
		assert.ok(runId);
		const stateRoot = path.join(cwd, ".crew", "state", "runs", runId!);
		const artifactsRoot = path.join(cwd, ".crew", "artifacts", runId!);
		assert.ok(fs.existsSync(path.join(stateRoot, "manifest.json")));
		assert.ok(fs.existsSync(path.join(stateRoot, "tasks.json")));
		assert.ok(fs.existsSync(path.join(stateRoot, "events.jsonl")));
		assert.ok(fs.existsSync(path.join(artifactsRoot, "goal.md")));
		assert.ok(fs.existsSync(path.join(artifactsRoot, "prompts", "01_explore.md")));

		const status = await handleTeamTool({ action: "status", runId }, { cwd });
		assert.equal(status.isError, false);
		assert.match(firstText(status), /Status: completed/);
		assert.match(firstText(status), /Recent events:/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("team run blocks implicit scaffold when worker execution is disabled", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-run-disabled-workers-"));
	const previous = process.env.PI_CREW_EXECUTE_WORKERS;
	process.env.PI_CREW_EXECUTE_WORKERS = "0";
	fs.mkdirSync(path.join(cwd, ".crew"));
	try {
		const run = await handleTeamTool({ action: "run", team: "default", goal: "should not no-op" }, { cwd });
		assert.equal(run.isError, true);
		assert.match(firstText(run), /real subagent workers are disabled/i);
		assert.match(firstText(run), /runtime\.mode=scaffold only for explicit dry-run/i);
	} finally {
		restoreEnv("PI_CREW_EXECUTE_WORKERS", previous);
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

