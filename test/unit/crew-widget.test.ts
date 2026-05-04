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
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const run = await handleTeamTool({ action: "run", config: { runtime: { mode: "scaffold" } }, team: "fast-fix", goal: "widget smoke" }, { cwd });
		assert.equal(run.isError, false);
		const loaded = loadRunManifestById(cwd, run.details.runId!)!;
		saveRunManifest({ ...loaded.manifest, status: "running" });
		saveCrewAgents(loaded.manifest, [{ id: `${loaded.manifest.runId}:01`, runId: loaded.manifest.runId, taskId: "01", agent: "executor", role: "executor", runtime: "child-process", status: "running", startedAt: loaded.manifest.createdAt, progress: { recentTools: [], recentOutput: [], toolCount: 1, currentTool: "bash" } }]);
		const lines = buildCrewWidgetLines(cwd, 1);
		assert.match(lines[0]!, /Crew agents/);
		assert.match(lines.join("\n"), /fast-fix\/fast-fix/);
		assert.match(lines.join("\n"), /running command/);
		const calls: Array<{ key: string; content: string[] | undefined }> = [];
		const state: CrewWidgetState = { frame: 0 };
		updateCrewWidget({ cwd, hasUI: true, ui: { setStatus: () => {}, setWidget: (key: string, content: string[] | undefined) => calls.push({ key, content }) } as never }, state);
		assert.equal(calls.at(-1)?.key, "pi-crew-active");
		assert.ok(calls.at(-1)?.content?.length);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("crew widget hides when only orphaned or fixture-only active runs exist", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-stale-"));
	const previousHome = process.env.PI_TEAMS_HOME;
	const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-home-"));
	process.env.PI_TEAMS_HOME = tempHome;
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const team = { name: "fast-fix", description: "", roles: [{ name: "explorer", agent: "explorer" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "fast-fix", description: "", steps: [{ id: "explore", role: "explorer" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "orphan" });
		const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		saveRunManifest({ ...created.manifest, status: "running", updatedAt: old, summary: "Creating workflow prompts and placeholder results." });
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "scaffold", status: "queued", startedAt: old }]);
		let lines = buildCrewWidgetLines(cwd, 0);
		assert.ok(!lines.join("\n").includes(created.manifest.runId.slice(-8)));
		saveRunManifest({ ...created.manifest, status: "running", updatedAt: new Date().toISOString(), summary: undefined });
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "child-process", status: "running", startedAt: old }]);
		lines = buildCrewWidgetLines(cwd, 0);
		assert.ok(!lines.join("\n").includes(created.manifest.runId.slice(-8)));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
		fs.rmSync(tempHome, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
	}
});

test("crew widget keeps persistent component until placement changes and refreshes progress", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-persist-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const team = { name: "fast-fix", description: "", roles: [{ name: "explorer", agent: "explorer" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "fast-fix", description: "", steps: [{ id: "explore", role: "explorer" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "persistent widget" });
		saveRunManifest({ ...created.manifest, status: "running" });
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "child-process", status: "running", startedAt: created.manifest.createdAt, progress: { recentTools: [], recentOutput: ["first output"], toolCount: 1, currentTool: "read", tokens: 10 } }]);
		const setWidgetCalls: Array<{ key: string; content: unknown; placement?: string }> = [];
		const ctx = {
			cwd,
			hasUI: true,
			ui: {
				setStatus: () => {},
				setWidget: (key: string, content: unknown, options?: { placement?: string }) => setWidgetCalls.push({ key, content, placement: options?.placement }),
				requestRender: () => {},
			},
		} as never;
		const state: CrewWidgetState = { frame: 0 };
		updateCrewWidget(ctx, state, { widgetPlacement: "aboveEditor" });
		updateCrewWidget(ctx, state, { widgetPlacement: "aboveEditor" });
		assert.equal(setWidgetCalls.filter((call) => call.key === "pi-crew-active" && call.content).length, 1);
		const factory = setWidgetCalls.find((call) => call.key === "pi-crew-active" && call.content)?.content as ((tui: unknown, theme: unknown) => { render(width: number): string[] });
		const component = factory(undefined, { fg: (_color: string, value: string) => value, bold: (value: string) => value });
		assert.match(component.render(100).join("\n"), /reading/);
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "child-process", status: "running", startedAt: created.manifest.createdAt, progress: { recentTools: [], recentOutput: ["second output"], toolCount: 2, currentTool: "bash", tokens: 20 } }]);
		assert.match(component.render(100).join("\n"), /running command/);
		updateCrewWidget(ctx, state, { widgetPlacement: "belowEditor" });
		assert.equal(setWidgetCalls.filter((call) => call.key === "pi-crew-active" && call.content).length, 2);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("crew widget hides active async runs whose background process is stale", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-stale-async-home-"));
	const previousHome = process.env.PI_TEAMS_HOME;
	process.env.PI_TEAMS_HOME = home;
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-stale-async-"));
	try {
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		const team = { name: "parallel-research", description: "", roles: [{ name: "explorer", agent: "explorer" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "parallel-research", description: "", steps: [{ id: "discover", role: "explorer" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "stale async" });
		const stalePid = 0;
		saveRunManifest({
			...created.manifest,
			status: "queued",
			async: { pid: stalePid, logPath: path.join(created.manifest.stateRoot, "background.log"), spawnedAt: new Date().toISOString() },
		});
		const lines = buildCrewWidgetLines(cwd, 0);
		assert.equal(lines.join("\n"), "");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
	}
});
