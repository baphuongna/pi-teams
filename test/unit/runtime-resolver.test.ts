import test from "node:test";
import assert from "node:assert/strict";
import { resolveCrewRuntime } from "../../src/runtime/runtime-resolver.ts";
import { probeLiveSessionRuntime } from "../../src/runtime/live-session-runtime.ts";

test("runtime resolver defaults to scaffold without executeWorkers", async () => {
	const runtime = await resolveCrewRuntime({}, {} as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "scaffold");
	assert.equal(runtime.steer, false);
});

test("runtime resolver selects child-process when workers are enabled", async () => {
	const runtime = await resolveCrewRuntime({}, { PI_TEAMS_EXECUTE_WORKERS: "1" } as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "child-process");
	assert.equal(runtime.transcript, true);
});

test("runtime resolver can request live-session with safe fallback", async () => {
	const runtime = await resolveCrewRuntime({ runtime: { mode: "live-session" }, executeWorkers: true }, {} as NodeJS.ProcessEnv);
	assert.ok(["live-session", "child-process", "scaffold"].includes(runtime.kind));
	assert.equal(runtime.requestedMode, "live-session");
});

test("live session probe returns a stable envelope", async () => {
	const probe = await probeLiveSessionRuntime();
	assert.equal(typeof probe.available, "boolean");
	assert.equal(typeof probe.reason, "string");
});
