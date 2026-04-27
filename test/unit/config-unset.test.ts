import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { loadConfig } from "../../src/config/config.ts";

test("config action can unset nested config keys", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-config-unset-"));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-config-unset-home-"));
	const previousHome = process.env.PI_TEAMS_HOME;
	process.env.PI_TEAMS_HOME = home;
	try {
		await handleTeamTool({ action: "config", config: { scope: "project", autonomous: { profile: "assisted", preferAsyncForLongTasks: true } } }, { cwd });
		let loaded = loadConfig(cwd);
		assert.equal(loaded.config.autonomous?.preferAsyncForLongTasks, true);
		await handleTeamTool({ action: "config", config: { scope: "project", unset: ["autonomous.preferAsyncForLongTasks"] } }, { cwd });
		loaded = loadConfig(cwd);
		assert.equal(loaded.config.autonomous?.profile, "assisted");
		assert.equal(loaded.config.autonomous?.preferAsyncForLongTasks, undefined);
	} finally {
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
		fs.rmSync(cwd, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	}
});
