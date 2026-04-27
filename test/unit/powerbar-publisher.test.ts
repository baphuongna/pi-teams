import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRunManifest, saveRunManifest } from "../../src/state/state-store.ts";
import { saveCrewAgents } from "../../src/runtime/crew-agent-records.ts";
import { registerPiCrewPowerbarSegments, updatePiCrewPowerbar } from "../../src/ui/powerbar-publisher.ts";

test("powerbar publisher registers and updates active crew segments", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-powerbar-"));
	try {
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		const events: Array<{ event: string; data: unknown }> = [];
		const bus = { emit: (event: string, data: unknown) => events.push({ event, data }) };
		registerPiCrewPowerbarSegments(bus);
		assert.ok(events.some((item) => item.event === "powerbar:register-segment"));
		const team = { name: "fast-fix", description: "", roles: [{ name: "explorer", agent: "explorer" }], source: "test", filePath: "builtin" } as never;
		const workflow = { name: "fast-fix", description: "", steps: [{ id: "explore", role: "explorer" }], source: "test", filePath: "builtin" } as never;
		const created = createRunManifest({ cwd, team, workflow, goal: "powerbar" });
		saveRunManifest({ ...created.manifest, status: "running" });
		saveCrewAgents(created.manifest, [{ id: `${created.manifest.runId}:01`, runId: created.manifest.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "child-process", status: "running", startedAt: created.manifest.createdAt }]);
		updatePiCrewPowerbar(bus, cwd);
		assert.ok(events.some((item) => item.event === "powerbar:update" && JSON.stringify(item.data).includes("pi-crew-active")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
