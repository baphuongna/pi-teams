import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { allAgents, discoverAgents } from "../../src/agents/discover-agents.ts";
import { allTeams, discoverTeams } from "../../src/teams/discover-teams.ts";
import { allWorkflows, discoverWorkflows } from "../../src/workflows/discover-workflows.ts";

test("builtin resources are discoverable", () => {
	const cwd = process.cwd();
	assert.equal(allAgents(discoverAgents(cwd)).length, 10);
	assert.equal(allTeams(discoverTeams(cwd)).length, 5);
	assert.equal(allWorkflows(discoverWorkflows(cwd)).length, 5);
});

test("agent config overrides builtin agents case-insensitively and can disable them", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-agent-override-"));
	try {
		const configDir = path.join(cwd, ".pi", "teams");
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
			agents: {
				overrides: {
					EXECUTOR: { model: "local/executor", tools: ["read"], disabled: false },
					writer: { disabled: true },
				},
			},
		}), "utf-8");
		const discovery = discoverAgents(cwd);
		const executor = allAgents(discovery).find((agent) => agent.name === "executor");
		assert.equal(executor?.model, "local/executor");
		assert.deepEqual(executor?.tools, ["read"]);
		assert.equal(executor?.override?.source, "config");
		assert.equal(allAgents(discovery).some((agent) => agent.name === "writer"), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
