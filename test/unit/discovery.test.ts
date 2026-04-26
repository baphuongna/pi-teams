import test from "node:test";
import assert from "node:assert/strict";
import { allAgents, discoverAgents } from "../../src/agents/discover-agents.ts";
import { allTeams, discoverTeams } from "../../src/teams/discover-teams.ts";
import { allWorkflows, discoverWorkflows } from "../../src/workflows/discover-workflows.ts";

test("builtin resources are discoverable", () => {
	const cwd = process.cwd();
	assert.equal(allAgents(discoverAgents(cwd)).length, 10);
	assert.equal(allTeams(discoverTeams(cwd)).length, 5);
	assert.equal(allWorkflows(discoverWorkflows(cwd)).length, 5);
});
