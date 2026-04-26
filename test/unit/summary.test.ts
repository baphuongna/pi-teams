import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";


test("summary action and summary artifact are created for runs", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-summary-test-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	try {
		const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: "Summarize me" }, { cwd });
		const runId = run.details.runId;
		assert.ok(runId);
		const summaryPath = path.join(cwd, ".pi", "teams", "artifacts", runId!, "summary.md");
		assert.ok(fs.existsSync(summaryPath));
		assert.match(fs.readFileSync(summaryPath, "utf-8"), /# pi-teams run/);
		const summary = await handleTeamTool({ action: "summary", runId }, { cwd });
		assert.equal(summary.isError, false);
		assert.match(summary.content[0]?.text ?? "", /Summary for/);
		assert.match(summary.content[0]?.text ?? "", /Usage:/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
