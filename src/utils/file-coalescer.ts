interface TimerApi {
	setTimeout(handler: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

const defaultTimerApi: TimerApi = {
	setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface FileCoalescer {
	schedule(file: string, delayMs?: number): boolean;
	clear(): void;
}

export function createFileCoalescer(handler: (file: string) => void, defaultDelayMs: number, timerApi: TimerApi = defaultTimerApi): FileCoalescer {
	const pending = new Map<string, unknown>();
	return {
		schedule(file, delayMs = defaultDelayMs) {
			if (pending.has(file)) return false;
			const timer = timerApi.setTimeout(() => {
				pending.delete(file);
				handler(file);
			}, delayMs);
			pending.set(file, timer);
			return true;
		},
		clear() {
			for (const timer of pending.values()) timerApi.clearTimeout(timer);
			pending.clear();
		},
	};
}
