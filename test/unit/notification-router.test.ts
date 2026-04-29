import test from "node:test";
import assert from "node:assert/strict";
import { isInQuietHours, NotificationRouter, parseHHMMRange, type NotificationDescriptor } from "../../src/extension/notification-router.ts";

test("notification router dedupes by id inside window", () => {
	const delivered: NotificationDescriptor[] = [];
	let now = 1000;
	const router = new NotificationRouter({ now: () => now, dedupWindowMs: 30_000 }, (item) => delivered.push(item));
	router.enqueue({ id: "same", severity: "warning", source: "test", title: "one" });
	router.enqueue({ id: "same", severity: "warning", source: "test", title: "two" });
	now += 31_000;
	router.enqueue({ id: "same", severity: "warning", source: "test", title: "three" });
	assert.deepEqual(delivered.map((item) => item.title), ["one", "three"]);
});

test("notification router filters severities and still writes sink", () => {
	const delivered: NotificationDescriptor[] = [];
	const sunk: NotificationDescriptor[] = [];
	const router = new NotificationRouter({ severityFilter: ["error"], sink: (item) => sunk.push(item) }, (item) => delivered.push(item));
	router.enqueue({ severity: "info", source: "test", title: "info" });
	router.enqueue({ severity: "error", source: "test", title: "error" });
	assert.deepEqual(delivered.map((item) => item.title), ["error"]);
	assert.deepEqual(sunk.map((item) => item.title), ["info", "error"]);
});

test("notification router batches messages", () => {
	const delivered: NotificationDescriptor[] = [];
	const router = new NotificationRouter({ batchWindowMs: 1000 }, (item) => delivered.push(item));
	router.enqueue({ severity: "warning", source: "test", title: "a" });
	router.enqueue({ severity: "error", source: "test", title: "b" });
	router.flush();
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0]?.severity, "error");
	assert.match(delivered[0]?.body ?? "", /a/);
	assert.match(delivered[0]?.body ?? "", /b/);
});

test("quiet-hours parser supports ordinary and cross-day ranges", () => {
	assert.deepEqual(parseHHMMRange("22:00-07:30"), { startMin: 1320, endMin: 450 });
	assert.equal(isInQuietHours("09:00-17:00", new Date("2026-01-01T12:00:00")), true);
	assert.equal(isInQuietHours("09:00-17:00", new Date("2026-01-01T22:00:00")), false);
	assert.equal(isInQuietHours("22:00-07:00", new Date("2026-01-01T23:30:00")), true);
	assert.equal(isInQuietHours("22:00-07:00", new Date("2026-01-01T03:00:00")), true);
	assert.equal(isInQuietHours("22:00-07:00", new Date("2026-01-01T12:00:00")), false);
	assert.equal(isInQuietHours("00:00-00:00", new Date("2026-01-01T12:00:00")), false);
});

test("notification router suppresses delivery during quiet hours", () => {
	const delivered: NotificationDescriptor[] = [];
	const router = new NotificationRouter({ quietHours: "00:00-23:59", now: () => Date.parse("2026-01-01T12:00:00") }, (item) => delivered.push(item));
	router.enqueue({ severity: "warning", source: "test", title: "quiet" });
	assert.equal(delivered.length, 0);
});

test("parseHHMMRange rejects invalid ranges", () => {
	assert.throws(() => parseHHMMRange("25:00-07:00"));
	assert.throws(() => parseHHMMRange("bad"));
});

test("notification router flushes a single batched notification unchanged", () => {
	const delivered: NotificationDescriptor[] = [];
	const router = new NotificationRouter({ batchWindowMs: 1000 }, (item) => delivered.push(item));
	router.enqueue({ severity: "warning", source: "test", title: "single" });
	router.flush();
	assert.equal(delivered[0]?.title, "single");
});

test("notification router dispose clears queued batch", () => {
	const delivered: NotificationDescriptor[] = [];
	const router = new NotificationRouter({ batchWindowMs: 1000 }, (item) => delivered.push(item));
	router.enqueue({ severity: "warning", source: "test", title: "queued" });
	router.dispose();
	router.flush();
	assert.equal(delivered.length, 0);
});
