import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";
import { decomposeGoal, recommendTeam } from "../../src/extension/team-recommendation.ts";
import { firstText } from "../fixtures/tool-result-helpers.ts";

test("recommendTeam maps goals to teams", () => {
	assert.equal(recommendTeam("security review this diff").team, "review");
	assert.equal(recommendTeam("quick fix a small typo").team, "fast-fix");
	assert.equal(recommendTeam("research and compare auth approaches").team, "research");
	assert.equal(recommendTeam("Đọc sâu các source pi-* trong Source/").team, "parallel-research");
	assert.equal(recommendTeam("implement feature with tests").team, "implementation");
});

test("decomposeGoal parses bullet lists", () => {
	const decomposition = decomposeGoal("- update docs\n- add tests");
	assert.equal(decomposition.strategy, "bulleted");
	assert.equal(decomposition.subtasks.length, 2);
	assert.equal(decomposition.fanout, 2);
});

test("recommendTeam can suggest async and worktree", () => {
	const recommendation = recommendTeam("large risky refactor migration across multiple packages with tests", { preferAsyncForLongTasks: true });
	assert.equal(recommendation.team, "implementation");
	assert.equal(recommendation.async, true);
	assert.equal(recommendation.workspaceMode, "worktree");
});

test("team tool recommend returns suggested call", async () => {
	const result = await handleTeamTool({ action: "recommend", goal: "review this pull request for security" }, { cwd: process.cwd() });
	assert.equal(result.isError, false);
	const text = firstText(result);
	assert.match(text, /Team: review/);
	assert.match(text, /Suggested tool call/);
});

