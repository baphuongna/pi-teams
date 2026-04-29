export const SUBAGENT_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const SUBAGENT_SPINNER_FRAME_MS = 160;

export function spinnerBucket(now = Date.now(), frameMs = SUBAGENT_SPINNER_FRAME_MS): number {
	return Math.floor(now / Math.max(1, frameMs));
}

function hashKey(key: string): number {
	let hash = 0;
	for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
	return hash;
}

export function spinnerFrame(key = "", now = Date.now()): string {
	const offset = key ? hashKey(key) % SUBAGENT_SPINNER_FRAMES.length : 0;
	return SUBAGENT_SPINNER_FRAMES[(spinnerBucket(now) + offset) % SUBAGENT_SPINNER_FRAMES.length] ?? SUBAGENT_SPINNER_FRAMES[0];
}
