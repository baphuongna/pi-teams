import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { validateResources } from "../../src/extension/validate-resources.ts";

test("validateResources reports broken team references", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-validate-test-"));
	fs.mkdirSync(path.join(cwd, ".pi", "teams"), { recursive: true });
	try {
		fs.writeFileSync(path.join(cwd, ".pi", "teams", "broken.team.md"), "---\nname: broken\ndescription: Broken team\ndefaultWorkflow: missing-flow\n---\n\n- ghost: agent=ghost\n", "utf-8");
		const report = validateResources(cwd);
		assert.ok(report.issues.some((issue) => issue.message.includes("unknown agent 'ghost'")));
		assert.ok(report.issues.some((issue) => issue.message.includes("unknown workflow 'missing-flow'")));
		const tool = await handleTeamTool({ action: "validate" }, { cwd });
		assert.equal(tool.isError, true);
		assert.match(tool.content[0]?.text ?? "", /ERROR team:broken/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
