import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { listRuns } from "../../src/extension/run-index.ts";


test("prune removes old finished runs after confirmation", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-prune-test-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	try {
		for (let i = 0; i < 3; i++) {
			const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: `Prune ${i}` }, { cwd });
			assert.equal(run.isError, false);
		}
		assert.equal(listRuns(cwd).length, 3);
		const blocked = await handleTeamTool({ action: "prune", keep: 1 }, { cwd });
		assert.equal(blocked.isError, true);
		assert.equal(listRuns(cwd).length, 3);
		const pruned = await handleTeamTool({ action: "prune", keep: 1, confirm: true }, { cwd });
		assert.equal(pruned.isError, false);
		assert.equal(listRuns(cwd).length, 1);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
