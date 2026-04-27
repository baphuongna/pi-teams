import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { buildCrewWidgetLines, updateCrewWidget, type CrewWidgetState } from "../../src/ui/crew-widget.ts";
import { saveCrewAgents } from "../../src/runtime/crew-agent-records.ts";
import { createRunManifest, loadRunManifestById, saveRunManifest } from "../../src/state/state-store.ts";

test("crew widget renders installed-style run and agent summary lines", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-"));
	try {
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "widget smoke" }, { cwd });
		assert.equal(run.isError, false);
		const loaded = loadRunManifestById(cwd, run.details.runId!)!;
		saveRunManifest({ ...loaded.manifest, status: "running" });
		saveCrewAgents(loaded.manifest, [{ id: `${loaded.manifest.runId}:01`, runId: loaded.manifest.runId, taskId: "01", agent: "executor", role: "executor", runtime: "child-process", status: "running", startedAt: loaded.manifest.createdAt, progress: { recentTools: [], recentOutput: [], toolCount: 1, currentTool: "bash" } }]);
		const lines = buildCrewWidgetLines(cwd, 1);
		assert.match(lines[0]!, /pi-crew/);
		assert.match(lines.join("\n"), /fast-fix\/fast-fix/);
		assert.match(lines.join("\n"), /running command/);
		const calls: Array<{ key: string; content: string[] | undefined }> = [];
		const state: CrewWidgetState = { frame: 0 };
		updateCrewWidget({ cwd, hasUI: true, ui: { setStatus: () => {}, setWidget: (key: string, content: string[] | undefined) => calls.push({ key, content }) } as never }, state);
		assert.equal(calls.at(-1)?.key, "pi-crew");
		assert.ok(calls.at(-1)?.content?.length);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("crew widget hides when only orphaned queued runs exist", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-stale-"));
	const previousHome = process.env.PI_TEAMS_HOME;
	const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-home-"));
	process.env.PI_TEAMS_HOME = tempHome;
	try {
		const team = { name: "fast-fix", description: "", roles: [{ name: "explorer", agent: "explorer" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "fast-fix", description: "", steps: [{ id: "explore", role: "explorer" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "orphan" });
		const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		saveRunManifest({ ...created.manifest, status: "running", updatedAt: old, summary: "Creating workflow prompts and placeholder results." });
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "scaffold", status: "queued", startedAt: old }]);
		const lines = buildCrewWidgetLines(cwd, 0);
		assert.ok(!lines.join("\n").includes(created.manifest.runId.slice(-8)));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
		fs.rmSync(tempHome, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
	}
});
