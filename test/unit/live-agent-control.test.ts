import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { loadRunManifestById } from "../../src/state/state-store.ts";
import { liveAgentControlPath, readLiveAgentControlRequests } from "../../src/runtime/live-agent-control.ts";
import { agentsPath } from "../../src/runtime/crew-agent-records.ts";
import { clearLiveAgentsForTest, registerLiveAgent } from "../../src/runtime/live-agent-manager.ts";
import { firstText } from "../fixtures/tool-result-helpers.ts";

test("api rejects direct live-agent control for a different run", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-live-control-run-boundary-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "run boundary" }, { cwd });
		const runId = run.details.runId!;
		registerLiveAgent({ agentId: "agent_other", runId: "other-run", taskId: "task", status: "running", session: { steer: async () => {} } });
		const rejected = await handleTeamTool({ action: "api", runId, config: { operation: "steer-agent", agentId: "agent_other", message: "no" } }, { cwd });
		assert.equal(rejected.isError, true);
		assert.match(firstText(rejected), /does not belong to run/);
	} finally {
		clearLiveAgentsForTest();
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("api rejects durable live-agent control for tampered agent task ids", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-live-control-tampered-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "control tamper" }, { cwd });
		const runId = run.details.runId!;
		const loaded = loadRunManifestById(cwd, runId)!;
		fs.writeFileSync(agentsPath(loaded.manifest), `${JSON.stringify([{ id: "evil", runId, taskId: "../../../outside", agent: "executor", role: "executor", runtime: "live-session", status: "running", startedAt: new Date().toISOString() }], null, 2)}\n`, "utf-8");
		const rejected = await handleTeamTool({ action: "api", runId, config: { operation: "steer-agent", agentId: "evil", message: "no" } }, { cwd });
		assert.equal(rejected.isError, true);
		assert.match(firstText(rejected), /does not match a run task/);
		assert.equal(fs.existsSync(path.join(loaded.manifest.stateRoot, "..", "outside")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("agent control rejects symlinked durable live-agent queue files", async (t) => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-live-control-symlink-file-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "control symlink file" }, { cwd });
		const runId = run.details.runId!;
		const loaded = loadRunManifestById(cwd, runId)!;
		const agentsResult = await handleTeamTool({ action: "api", runId, config: { operation: "list-agents" } }, { cwd });
		const first = JSON.parse(firstText(agentsResult))[0];
		const queuePath = liveAgentControlPath(loaded.manifest, first.taskId);
		fs.rmSync(queuePath, { force: true });
		const outside = path.join(cwd, "outside-live-control.jsonl");
		fs.writeFileSync(outside, "", "utf-8");
		try {
			fs.symlinkSync(outside, queuePath, "file");
		} catch {
			t.skip("file symlinks unavailable on this platform");
			return;
		}
		const rejected = await handleTeamTool({ action: "api", runId, config: { operation: "steer-agent", agentId: first.taskId, message: "durable steer" } }, { cwd });
		assert.equal(rejected.isError, true);
		assert.equal(fs.readFileSync(outside, "utf-8"), "");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("agent control queues durable follow-up request when agent is in another process", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-live-control-followup-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "follow-up bridge smoke" }, { cwd });
		assert.equal(run.isError, false);
		const runId = run.details.runId!;
		const agentsResult = await handleTeamTool({ action: "api", runId, config: { operation: "list-agents" } }, { cwd });
		const first = JSON.parse(firstText(agentsResult))[0];
		const queued = await handleTeamTool({ action: "api", runId, config: { operation: "follow-up-agent", agentId: first.taskId, prompt: "durable follow up" } }, { cwd });
		assert.equal(queued.isError, false);
		assert.match(firstText(queued), /"queued": true/);
		const loaded = loadRunManifestById(cwd, runId)!;
		const batch = readLiveAgentControlRequests(loaded.manifest, first.taskId);
		assert.equal(batch.requests[0]?.operation, "follow-up");
		assert.equal(batch.requests[0]?.message, "durable follow up");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("agent control queues durable live-agent request when agent is in another process", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-live-control-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "control bridge smoke" }, { cwd });
		assert.equal(run.isError, false);
		const runId = run.details.runId!;
		const agentsResult = await handleTeamTool({ action: "api", runId, config: { operation: "list-agents" } }, { cwd });
		const first = JSON.parse(firstText(agentsResult))[0];
		const queued = await handleTeamTool({ action: "api", runId, config: { operation: "steer-agent", agentId: first.taskId, message: "durable steer" } }, { cwd });
		assert.equal(queued.isError, false);
		assert.match(firstText(queued), /"queued": true/);
		const loaded = loadRunManifestById(cwd, runId)!;
		assert.equal(fs.existsSync(liveAgentControlPath(loaded.manifest, first.taskId)), true);
		const batch = readLiveAgentControlRequests(loaded.manifest, first.taskId);
		assert.equal(batch.requests[0]?.operation, "steer");
		assert.equal(batch.requests[0]?.message, "durable steer");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

