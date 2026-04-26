import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("delete agent is blocked when referenced by a team unless forced", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-ref-test-"));
	fs.mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi", "teams"), { recursive: true });
	try {
		fs.writeFileSync(path.join(cwd, ".pi", "agents", "worker.md"), "---\nname: worker\ndescription: Worker\n---\n\nDo work.\n", "utf-8");
		fs.writeFileSync(path.join(cwd, ".pi", "teams", "ref-team.team.md"), "---\nname: ref-team\ndescription: Ref team\ndefaultWorkflow: default\n---\n\n- worker: agent=worker\n", "utf-8");

		const blocked = await handleTeamTool({ action: "delete", resource: "agent", agent: "worker", scope: "project", confirm: true }, { cwd });
		assert.equal(blocked.isError, true);
		assert.match(blocked.content[0]?.text ?? "", /still referenced/);
		assert.equal(fs.existsSync(path.join(cwd, ".pi", "agents", "worker.md")), true);

		const forced = await handleTeamTool({ action: "delete", resource: "agent", agent: "worker", scope: "project", confirm: true, force: true }, { cwd });
		assert.equal(forced.isError, false);
		assert.equal(fs.existsSync(path.join(cwd, ".pi", "agents", "worker.md")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
