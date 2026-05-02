import { labelKey, type MetricLabels } from "./metrics-primitives.ts";

interface WindowEvent {
	timestamp: number;
	labels: MetricLabels;
	delta: number;
}

export class TimeWindowedCounter {
	private events: WindowEvent[] = [];
	private readonly windowMs: number;
	private readonly now: () => number;
	private static readonly MAX_EVENTS = 100_000;

	constructor(windowMs = 3_600_000, now: () => number = () => Date.now()) {
		this.windowMs = windowMs;
		this.now = now;
	}

	inc(labels: MetricLabels = {}, delta = 1): void {
		if (!Number.isFinite(delta)) return;
		// Cap the event array to prevent unbounded memory growth.
		if (this.events.length >= TimeWindowedCounter.MAX_EVENTS) this.prune();
		this.events.push({ timestamp: this.now(), labels: { ...labels }, delta });
		this.prune();
	}

	count(labels: MetricLabels = {}, durationMs = this.windowMs): number {
		this.prune();
		const key = labelKey(labels);
		const cutoff = this.now() - durationMs;
		return this.events.filter((event) => event.timestamp >= cutoff && labelKey(event.labels) === key).reduce((sum, event) => sum + event.delta, 0);
	}

	rate(labels: MetricLabels = {}, durationMs = this.windowMs): number {
		if (durationMs <= 0) return 0;
		return this.count(labels, durationMs) / (durationMs / 1000);
	}

	size(): number {
		this.prune();
		return this.events.length;
	}

	private prune(): void {
		const cutoff = this.now() - this.windowMs;
		this.events = this.events.filter((event) => event.timestamp >= cutoff);
	}
}
