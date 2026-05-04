import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colorForStatus, iconForStatus } from "../../src/ui/status-colors.ts";

describe("Status colors for waiting state", () => {
	it("waiting has muted color", () => {
		assert.equal(colorForStatus("waiting"), "muted");
	});

	it("waiting has hourglass icon", () => {
		assert.equal(iconForStatus("waiting"), "⏳");
	});

	it("running has accent color", () => {
		assert.equal(colorForStatus("running"), "accent");
	});

	it("completed has success color", () => {
		assert.equal(colorForStatus("completed"), "success");
	});

	it("unknown status returns dim color", () => {
		assert.equal(colorForStatus("something_else"), "dim");
	});
});
