import test from "node:test";
import assert from "node:assert/strict";
import { resolveCrewRuntime } from "../../src/runtime/runtime-resolver.ts";
import { probeLiveSessionRuntime } from "../../src/runtime/live-session-runtime.ts";

test("runtime resolver defaults to child-process workers", async () => {
	const runtime = await resolveCrewRuntime({}, {} as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "child-process");
	assert.equal(runtime.transcript, true);
});

test("runtime resolver supports explicit scaffold dry-run", async () => {
	const runtime = await resolveCrewRuntime({ runtime: { mode: "scaffold" } }, {} as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "scaffold");
	assert.equal(runtime.safety, "explicit_dry_run");
	assert.equal(runtime.steer, false);
});

test("runtime resolver lets config disable workers", async () => {
	const runtime = await resolveCrewRuntime({ executeWorkers: false }, {} as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "scaffold");
	assert.equal(runtime.available, false);
	assert.equal(runtime.safety, "blocked");
	assert.match(runtime.reason ?? "", /disabled/);
});

test("runtime resolver accepts canonical PI_CREW_EXECUTE_WORKERS", async () => {
	const runtime = await resolveCrewRuntime({}, { PI_CREW_EXECUTE_WORKERS: "1" } as NodeJS.ProcessEnv);
	assert.equal(runtime.kind, "child-process");
	assert.equal(runtime.transcript, true);
});

test("runtime resolver can request live-session with safe fallback", async () => {
	const runtime = await resolveCrewRuntime({ runtime: { mode: "live-session" }, executeWorkers: true }, {} as NodeJS.ProcessEnv);
	assert.ok(["live-session", "child-process", "scaffold"].includes(runtime.kind));
	assert.equal(runtime.requestedMode, "live-session");
});

test("runtime resolver uses mock live-session when enabled", async () => {
	const runtime = await resolveCrewRuntime(
		{ runtime: { mode: "live-session" }, executeWorkers: true },
		{ PI_CREW_ENABLE_EXPERIMENTAL_LIVE_SESSION: "1", PI_CREW_MOCK_LIVE_SESSION: "success" } as NodeJS.ProcessEnv,
	);
	assert.equal(runtime.kind, "live-session");
	assert.equal(runtime.requestedMode, "live-session");
});

test("live session probe returns a stable envelope", async () => {
	const probe = await probeLiveSessionRuntime();
	assert.equal(typeof probe.available, "boolean");
	assert.equal(typeof probe.reason, "string");
});
