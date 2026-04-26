import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("doctor child smoke is opt-in and reports failure cleanly without throwing", async () => {
	const result = await handleTeamTool({ action: "doctor", config: { smokeChildPi: true } }, { cwd: process.cwd() });
	const text = result.content[0]?.text ?? "";
	assert.match(text, /child Pi smoke/);
});
