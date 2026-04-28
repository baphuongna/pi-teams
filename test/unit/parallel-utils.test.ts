import test from "node:test";
import assert from "node:assert/strict";
import {
	aggregateParallelOutputs,
	flattenSteps,	isParallelGroup,	mapConcurrent,
	MAX_PARALLEL_CONCURRENCY,
	type ParallelStepGroup,	type RunnerStep,	type RunnerSubagentStep,
} from "../../src/runtime/parallel-utils.ts";


test("isParallelGroup identifies parallel step groups", () => {
	const parallel: ParallelStepGroup = { parallel: [{ agent: "a", task: "x", inheritProjectContext: false, inheritSkills: false, cwd: ".", model: "m" }] };
	const sequential: RunnerSubagentStep = { agent: "a", task: "x", inheritProjectContext: false, inheritSkills: false };
	assert.equal(isParallelGroup(parallel), true);
	assert.equal(isParallelGroup(sequential), false);
});

test("flattenSteps expands parallel groups", () => {
	const steps: RunnerStep[] = [
		{ agent: "a", task: "x", inheritProjectContext: false, inheritSkills: false },
		{ parallel: [{ agent: "b", task: "y", inheritProjectContext: false, inheritSkills: false }, { agent: "c", task: "z", inheritProjectContext: false, inheritSkills: false }] },
		{ agent: "d", task: "w", inheritProjectContext: false, inheritSkills: false },
	];
	const flat = flattenSteps(steps);
	assert.deepEqual(flat.map((item) => item.agent), ["a", "b", "c", "d"]);
});

test("mapConcurrent respects limit and preserves order", async () => {
	const source = [1, 2, 3, 4, 5];
	const results = await mapConcurrent(source, 2, async (value) => value * 2);
	assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("mapConcurrent propagates errors", async () => {
	await assert.rejects(async () => {
		await mapConcurrent([1, 2, 3], 2, async (value) => {
			if (value === 2) throw new Error("boom");
			return value;
		});
	}, /boom/);
});

test("aggregateParallelOutputs marks failures and skips", () => {
	const text = aggregateParallelOutputs([
		{ agent: "a", output: "ok", exitCode: 0 },
		{ agent: "b", output: "", exitCode: 1, error: "bad" },
		{ agent: "c", output: "", exitCode: -1 },
	]);
	assert.ok(text.includes("FAILED (exit code 1): bad"));
	assert.ok(text.includes("SKIPPED"));
});

test("MAX_PARALLEL_CONCURRENCY is 4", () => {
	assert.equal(MAX_PARALLEL_CONCURRENCY, 4);
});
