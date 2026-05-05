import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readActiveRunRegistry, registerActiveRun, unregisterActiveRun, activeRunRoots } from "../../src/state/active-run-registry.ts";
import { createRunManifest } from "../../src/state/state-store.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

const team: TeamConfig = { name: "ari", description: "ari", source: "builtin", filePath: "ari.team.md", roles: [{ name: "explorer", agent: "explorer" }] };
const workflow: WorkflowConfig = { name: "ari", description: "ari", source: "builtin", filePath: "ari.workflow.md", steps: [{ id: "explore", role: "explorer", task: "Explore" }] };

function withIsolatedHome<T>(fn: () => T): T {
	const previousHome = process.env.PI_TEAMS_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-active-reg-home-"));
	process.env.PI_TEAMS_HOME = home;
	try {
		return fn();
	} finally {
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
}

test("active-run registry starts empty", () => {
	withIsolatedHome(() => {
		assert.deepEqual(readActiveRunRegistry(), []);
		assert.deepEqual(activeRunRoots(), []);
	});
});

test("register and unregister active run", () => {
	withIsolatedHome(() => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-active-reg-"));
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		try {
			const created = createRunManifest({ cwd, team, workflow, goal: "test active run" });
			registerActiveRun(created.manifest);
			const entries = readActiveRunRegistry();
			assert.equal(entries.length, 1);
			assert.equal(entries[0]!.runId, created.manifest.runId);
			assert.equal(entries[0]!.cwd, cwd);
			assert.equal(activeRunRoots().length, 1);
			unregisterActiveRun(created.manifest.runId);
			assert.equal(readActiveRunRegistry().length, 0);
			assert.equal(activeRunRoots().length, 0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});

test("register deduplicates by runId", () => {
	withIsolatedHome(() => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-active-dedup-"));
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		try {
			const created = createRunManifest({ cwd, team, workflow, goal: "dedup test" });
			registerActiveRun(created.manifest);
			registerActiveRun(created.manifest);
			assert.equal(readActiveRunRegistry().length, 1);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});

test("registry ignores invalid entries", () => {
	withIsolatedHome(() => {
		const registryFile = path.join(
			process.env.PI_TEAMS_HOME!,
			".crew", "state", "runs", "active-run-index.json",
		);
		fs.mkdirSync(path.dirname(registryFile), { recursive: true });
		// Write garbage entries mixed with valid
		fs.writeFileSync(registryFile, JSON.stringify([
			{ runId: "../escape", cwd: "/tmp", stateRoot: "/tmp/x", manifestPath: "/tmp/m", updatedAt: "2026-01-01" },
			"not-an-object",
			{ runId: "no-cwd", stateRoot: "/x" },
		]));
		assert.equal(readActiveRunRegistry().length, 0);
	});
});

test("activeRunRoots skips entries with missing stateRoot", () => {
	withIsolatedHome(() => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-active-missing-"));
		fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
		try {
			const created = createRunManifest({ cwd, team, workflow, goal: "missing roots" });
			registerActiveRun(created.manifest);
			assert.equal(activeRunRoots().length, 1);
			// Remove the state root to simulate cleanup
			fs.rmSync(created.manifest.stateRoot, { recursive: true, force: true });
			assert.equal(activeRunRoots().length, 0);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});

test("unregister with invalid runId is a no-op", () => {
	withIsolatedHome(() => {
		unregisterActiveRun("../escape");
		assert.equal(readActiveRunRegistry().length, 0);
	});
});
