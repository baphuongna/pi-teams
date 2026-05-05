import test from "node:test";
import assert from "node:assert/strict";
import { clearLiveAgentsForTest, followUpLiveAgent, registerLiveAgent } from "../../src/runtime/live-agent-manager.ts";

test("followUpLiveAgent queues and flushes pending follow-ups through prompt", async () => {
	const prompts: string[] = [];
	try {
		registerLiveAgent({ agentId: "agent", taskId: "task", runId: "run", status: "running", session: {} });
		const pending = await followUpLiveAgent("agent", "review this next");
		assert.deepEqual(pending.pendingFollowUps, ["review this next"]);
		registerLiveAgent({ agentId: "agent", taskId: "task", runId: "run", status: "running", session: { prompt: async (text: string) => { prompts.push(text); } } });
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(prompts, ["review this next"]);
		assert.deepEqual(registerLiveAgent({ agentId: "agent", taskId: "task", runId: "run", status: "running", session: {} }).pendingFollowUps, []);
	} finally {
		clearLiveAgentsForTest();
	}
});
