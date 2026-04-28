import test from "node:test";
import assert from "node:assert/strict";
import { CrewFooter } from "../../src/ui/crew-footer.ts";
import type { CrewTheme } from "../../src/ui/theme-adapter.ts";

const theme: CrewTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => text,
	inverse: (text) => text,
};

test("CrewFooter renders run usage tokens and cost", () => {
	const footer = new CrewFooter({ pwd: "/repo", branch: "main", runId: "run-1", status: "running", usage: { input: 1200, output: 34, cacheRead: 500, cacheWrite: 6, cost: 0.0123 }, badges: ["one"] }, theme);
	const lines = footer.render(120);
	assert.equal(lines.length, 3);
	assert.match(lines.join("\n"), /↑1.2k/);
	assert.match(lines.join("\n"), /↓34/);
	assert.match(lines.join("\n"), /\$0.0123/);
});

test("CrewFooter colors context percentage thresholds", () => {
	const warning = new CrewFooter({ pwd: "/repo", contextPercent: 75, contextWindow: 200_000 }, theme).render(120).join("\n");
	const error = new CrewFooter({ pwd: "/repo", contextPercent: 95, contextWindow: 200_000 }, theme).render(120).join("\n");
	assert.match(warning, /<warning>75.0%\/200k<\/warning>/);
	assert.match(error, /<error>95.0%\/200k<\/error>/);
});

test("CrewFooter truncates with ascii ellipsis at narrow width", () => {
	const lines = new CrewFooter({ pwd: "/very/long/project/path", runId: "run-long" }, theme).render(12);
	assert.ok(lines.some((line) => line.includes("...")));
});

test("CrewFooter renders missing context as unknown over window", () => {
	const lines = new CrewFooter({ pwd: "/repo" }, theme).render(120);
	assert.match(lines.join("\n"), /\?\/window/);
});
