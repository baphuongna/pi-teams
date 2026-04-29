import test from "node:test";
import assert from "node:assert/strict";
import { RenderScheduler } from "../../src/ui/render-scheduler.ts";

class FakeEvents {
	private handlers = new Map<string, Set<(payload: unknown) => void>>();
	on(event: string, handler: (payload: unknown) => void): () => void {
		const set = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
		set.add(handler);
		this.handlers.set(event, set);
		return () => set.delete(handler);
	}
	emit(event: string, payload: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}
	listenerCount(event: string): number {
		return this.handlers.get(event)?.size ?? 0;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("RenderScheduler coalesces event bursts and disposes listeners", async () => {
	const events = new FakeEvents();
	let renders = 0;
	let invalidations = 0;
	const scheduler = new RenderScheduler(events, () => { renders += 1; }, { debounceMs: 20, fallbackMs: 10_000, events: ["crew.run.completed"], onInvalidate: () => { invalidations += 1; } });
	assert.equal(events.listenerCount("crew.run.completed"), 1);
	events.emit("crew.run.completed", { runId: "one" });
	events.emit("crew.run.completed", { runId: "one" });
	assert.equal(invalidations, 2);
	await sleep(50);
	assert.equal(renders, 1);
	scheduler.dispose();
	assert.equal(events.listenerCount("crew.run.completed"), 0);
	events.emit("crew.run.completed", { runId: "two" });
	await sleep(30);
	assert.equal(renders, 1);
});

test("RenderScheduler fallback renders when no events arrive", async () => {
	let renders = 0;
	const scheduler = new RenderScheduler(undefined, () => { renders += 1; }, { debounceMs: 5, fallbackMs: 20 });
	await sleep(55);
	scheduler.dispose();
	assert.ok(renders >= 1);
});
