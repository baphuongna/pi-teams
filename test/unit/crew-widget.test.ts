import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { buildCrewWidgetLines, updateCrewWidget, type CrewWidgetState } from "../../src/ui/crew-widget.ts";
import { saveCrewAgents } from "../../src/runtime/crew-agent-records.ts";
import { loadRunManifestById } from "../../src/state/state-store.ts";

test("crew widget renders installed-style run and agent summary lines", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-widget-"));
	try {
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: "widget smoke" }, { cwd });
		assert.equal(run.isError, false);
		const lines = buildCrewWidgetLines(cwd, 0);
		assert.match(lines[0]!, /pi-crew/);
		assert.match(lines.join("\n"), /fast-fix\/fast-fix/);
		const calls: Array<{ key: string; content: string[] | undefined }> = [];
		const state: CrewWidgetState = { frame: 0 };
		updateCrewWidget({ cwd, hasUI: true, ui: { setStatus: () => {}, setWidget: (key: string, content: string[] | undefined) => calls.push({ key, content }) } as never }, state);
		assert.equal(calls.at(-1)?.key, "pi-crew");
		assert.ok(calls.at(-1)?.content?.length);
		const loaded = loadRunManifestById(cwd, run.details.runId!)!;
		saveCrewAgents(loaded.manifest, [{ id: `${loaded.manifest.runId}:01`, runId: loaded.manifest.runId, taskId: "01", agent: "executor", role: "executor", runtime: "child-process", status: "running", startedAt: loaded.manifest.createdAt, progress: { recentTools: [], recentOutput: [], toolCount: 1, currentTool: "bash" } }]);
		assert.match(buildCrewWidgetLines(cwd, 1).join("\n"), /running command/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
