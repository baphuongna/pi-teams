import test from "node:test";
import assert from "node:assert/strict";
import { registerPiCrewRpc, type EventBusLike } from "../../src/extension/cross-extension-rpc.ts";
import { clearLiveControlRealtimeForTest, liveControlRealtimeMessage, subscribeLiveControlRealtime } from "../../src/runtime/live-control-realtime.ts";

class Bus implements EventBusLike {
	handlers = new Map<string, Array<(data: unknown) => void>>();
	emitted: Array<{ event: string; data: unknown }> = [];
	on(event: string, handler: (data: unknown) => void): () => void {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
		return () => this.handlers.set(event, (this.handlers.get(event) ?? []).filter((item) => item !== handler));
	}
	emit(event: string, data: unknown): void {
		this.emitted.push({ event, data });
		for (const handler of this.handlers.get(event) ?? []) handler(data);
	}
}

test("pi-crew rpc responds to ping with version envelope", () => {
	const bus = new Bus();
	const handle = registerPiCrewRpc(bus, () => undefined as never)!;
	try {
		bus.emit("pi-crew:rpc:ping", { requestId: "abc" });
		const reply = bus.emitted.find((entry) => entry.event === "pi-crew:rpc:ping:reply:abc");
		assert.deepEqual(reply?.data, { success: true, data: { version: 1 } });
	} finally {
		handle.unsubscribe();
	}
});

test("pi-crew event bus forwards realtime live-control messages", () => {
	clearLiveControlRealtimeForTest();
	const bus = new Bus();
	const seen: unknown[] = [];
	const unsubSeen = subscribeLiveControlRealtime((request) => {
		seen.push(request);
	});
	const handle = registerPiCrewRpc(bus, () => undefined as never)!;
	const request = { id: "ctrl_rpc", runId: "run", taskId: "task", operation: "stop" as const, createdAt: "2026-04-27T00:00:00.000Z" };
	try {
		bus.emit("pi-crew:live-control", liveControlRealtimeMessage(request));
		assert.deepEqual(seen, [request]);
	} finally {
		handle.unsubscribe();
		unsubSeen();
		clearLiveControlRealtimeForTest();
	}
});
