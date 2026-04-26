import test from "node:test";
import assert from "node:assert/strict";
import { appendAutonomousPolicy, buildAutonomousPolicy, detectTeamIntent } from "../../src/extension/autonomous-policy.ts";

test("detectTeamIntent detects default and custom keywords", () => {
	assert.deepEqual(detectTeamIntent("autoteam refactor this"), ["implementation"]);
	assert.deepEqual(detectTeamIntent("please swarm this", { magicKeywords: { custom: ["swarm"] } }), ["custom"]);
});

test("buildAutonomousPolicy contains routing guidance", () => {
	const policy = buildAutonomousPolicy("review-team this diff", { preferAsyncForLongTasks: true });
	assert.match(policy, /Autonomous Delegation Policy/);
	assert.match(policy, /team='review'/);
	assert.match(policy, /review/);
	assert.match(policy, /prefer async/);
});

test("appendAutonomousPolicy appends to system prompt", () => {
	const prompt = appendAutonomousPolicy("base", "quick fix bug");
	assert.match(prompt, /^base/);
	assert.match(prompt, /fastFix/);
});
