import test from "node:test";
import assert from "node:assert/strict";
import { buildModelCandidates, resolveModelCandidate, splitThinkingSuffix } from "../../src/runtime/model-fallback.ts";

test("splitThinkingSuffix preserves model suffix", () => {
	assert.deepEqual(splitThinkingSuffix("claude-sonnet:high"), { baseModel: "claude-sonnet", thinkingSuffix: ":high" });
	assert.deepEqual(splitThinkingSuffix("openai/gpt-5"), { baseModel: "openai/gpt-5", thinkingSuffix: "" });
});

test("resolveModelCandidate expands unique bare model", () => {
	const available = [{ provider: "anthropic", id: "sonnet", fullId: "anthropic/sonnet" }];
	assert.equal(resolveModelCandidate("sonnet:high", available), "anthropic/sonnet:high");
});

test("buildModelCandidates de-duplicates candidates", () => {
	const available = [{ provider: "anthropic", id: "sonnet", fullId: "anthropic/sonnet" }];
	assert.deepEqual(buildModelCandidates("sonnet", ["anthropic/sonnet", "other"], available), ["anthropic/sonnet", "other"]);
});
