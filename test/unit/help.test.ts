import test from "node:test";
import assert from "node:assert/strict";
import { piTeamsHelp } from "../../src/extension/help.ts";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("help includes major commands", async () => {
	const help = piTeamsHelp();
	assert.match(help, /\/team-run/);
	assert.match(help, /\/team-dashboard/);
	assert.match(help, /\/team-export/);
	const result = await handleTeamTool({ action: "help" }, { cwd: process.cwd() });
	assert.equal(result.isError, false);
	assert.match(result.content[0]?.text ?? "", /pi-crew commands/);
});
