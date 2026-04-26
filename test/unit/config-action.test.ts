import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("config action shows config path and effective config", async () => {
	const result = await handleTeamTool({ action: "config" }, { cwd: process.cwd() });
	assert.equal(result.isError, false);
	const text = result.content[0]?.text ?? "";
	assert.match(text, /pi-teams config:/);
	assert.match(text, /Effective config:/);
	assert.match(text, /schema\.json/);
});
