import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityInventory } from "../../src/runtime/capability-inventory.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("capability inventory includes builtin teams, workflows, and agents", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-cap-inv-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	try {
		const inventory = buildCapabilityInventory(cwd);
		assert.ok(inventory.length > 0);
		const teams = inventory.filter((item) => item.kind === "team");
		const workflows = inventory.filter((item) => item.kind === "workflow");
		const agents = inventory.filter((item) => item.kind === "agent");
		assert.ok(teams.length > 0, "expected at least one team");
		assert.ok(workflows.length > 0, "expected at least one workflow");
		assert.ok(agents.length > 0, "expected at least one agent");
		for (const item of inventory) {
			assert.ok(item.id);
			assert.ok(item.name);
			assert.ok(item.source);
			assert.ok(["active", "disabled"].includes(item.state));
		}
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
