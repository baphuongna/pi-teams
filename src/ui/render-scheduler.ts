import { logInternalError } from "../utils/internal-error.ts";

export interface RenderSchedulerEventBus {
	on?: (event: string, handler: (payload: unknown) => void) => (() => void) | void;
}

export interface RenderSchedulerOptions {
	debounceMs?: number;
	fallbackMs?: number;
	events?: string[];
	onInvalidate?: (payload: unknown) => void;
}

const DEFAULT_EVENTS = [
	"crew.run.created",
	"crew.run.completed",
	"crew.run.failed",
	"crew.run.cancelled",
	"crew.subagent.completed",
	"crew.subagent.failed",
	"crew.mailbox.updated",
	"crew.mailbox.message",
];

/**
 * Coordinates UI renders with debounce + fallback polling.
 *
 * Critical: uses recursive setTimeout instead of setInterval + a rendering
 * guard (`rendering` / `pendingRender`) so that when render() takes longer
 * than the fallback interval, callbacks do NOT pile up and storm the event
 * loop.  Instead, overlapping schedules are collapsed into a single deferred
 * re-render.
 */
export class RenderScheduler {
	private readonly render: () => void;
	private readonly onInvalidate?: (payload: unknown) => void;
	private readonly debounceMs: number;
	private readonly fallbackMs: number;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private lastEventAt = 0;
	private rendering = false;
	private pendingRender = false;
	private readonly unsubs: Array<() => void> = [];

	constructor(events: RenderSchedulerEventBus | undefined, render: () => void, options: RenderSchedulerOptions = {}) {
		this.render = render;
		this.onInvalidate = options.onInvalidate;
		this.debounceMs = options.debounceMs ?? 75;
		this.fallbackMs = options.fallbackMs ?? 750;
		for (const event of options.events ?? DEFAULT_EVENTS) this.subscribe(events, event);
		this.fallbackTimer = setTimeout(() => this.fallbackLoop(), this.fallbackMs);
		this.fallbackTimer.unref();
	}

	private subscribe(events: RenderSchedulerEventBus | undefined, event: string): void {
		if (!events?.on) return;
		const handler = (payload: unknown): void => this.schedule(payload);
		try {
			const unsub = events.on(event, handler);
			if (typeof unsub === "function") this.unsubs.push(unsub);
		} catch (error) {
			logInternalError("render-scheduler.subscribe", error, event);
		}
	}

	/** Recursive setTimeout — avoids setInterval timer storms. */
	private fallbackLoop(): void {
		if (this.disposed) return;
		if (Date.now() - this.lastEventAt < this.fallbackMs) {
			this.fallbackTimer = setTimeout(() => this.fallbackLoop(), this.fallbackMs);
			this.fallbackTimer.unref();
			return;
		}
		this.schedule();
		this.fallbackTimer = setTimeout(() => this.fallbackLoop(), this.fallbackMs);
		this.fallbackTimer.unref();
	}

	schedule(payload?: unknown): void {
		if (this.disposed) return;
		this.lastEventAt = Date.now();
		try {
			this.onInvalidate?.(payload);
		} catch (error) {
			logInternalError("render-scheduler.invalidate", error);
		}
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined;
			this.flush();
		}, this.debounceMs);
		this.debounceTimer.unref();
	}

	/**
	 * Flush a render.  If a render is already in progress the request is
	 * collapsed: `pendingRender` is set and the caller that holds
	 * `rendering==true` will loop one more time after finishing.
	 */
	flush(): void {
		if (this.disposed) return;
		if (this.rendering) {
			this.pendingRender = true;
			return;
		}
		this.rendering = true;
		this.pendingRender = false;
		try {
			do {
				this.pendingRender = false;
				this.render();
			} while (this.pendingRender && !this.disposed);
		} catch (error) {
			logInternalError("render-scheduler.render", error);
		} finally {
			this.rendering = false;
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
		this.debounceTimer = undefined;
		this.fallbackTimer = undefined;
		for (const unsub of this.unsubs.splice(0)) {
			try { unsub(); } catch (error) { logInternalError("render-scheduler.unsubscribe", error); }
		}
	}
}
