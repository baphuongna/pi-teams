import test from "node:test";
import assert from "node:assert/strict";
import { __test__clearVisibleWidthCache, __test__visibleWidthCacheSize, truncateToVisualLines, visibleWidth } from "../../src/utils/visual.ts";

test("truncateToVisualLines keeps the tail after merging wrapped source lines", () => {
	const result = truncateToVisualLines("abcdefghij", 2, 2);
	assert.deepEqual(result, { visualLines: ["gh", "ij"], skippedCount: 3 });
});

test("truncateToVisualLines counts skipped lines across multiple source lines", () => {
	const result = truncateToVisualLines("abcd\nefgh\nijkl", 4, 2);
	assert.deepEqual(result, { visualLines: ["ef", "gh", "ij", "kl"], skippedCount: 2 });
});

test("truncateToVisualLines returns no visual lines for empty input", () => {
	assert.deepEqual(truncateToVisualLines("", 3, 10), { visualLines: [], skippedCount: 0 });
});

test("visibleWidth memoizes repeated strings without changing output", () => {
	__test__clearVisibleWidthCache();
	for (let i = 0; i < 1000; i++) assert.equal(visibleWidth("\u001b[31mfoo\u001b[0m"), 3);
	assert.equal(__test__visibleWidthCacheSize(), 1);
});

test("visibleWidth evicts old cache entries at the cache limit", () => {
	__test__clearVisibleWidthCache();
	for (let i = 0; i < 1000; i++) visibleWidth(`value-${i}`);
	assert.equal(__test__visibleWidthCacheSize(), 256);
	assert.equal(visibleWidth("value-999"), 9);
});
