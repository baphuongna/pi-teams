import type { RunUiSnapshot } from "../snapshot-types.ts";

export function renderTranscriptPane(snapshot: RunUiSnapshot | undefined): string[] {
	if (!snapshot) return ["Output pane: snapshot unavailable"];
	return [
		`Output pane: ${snapshot.recentOutputLines.length} recent lines · press v for transcript viewer · o for raw output`,
		...snapshot.recentOutputLines.slice(-12).map((line) => `⎿ ${line}`),
		...(snapshot.recentOutputLines.length ? [] : ["No recent output"]),
	];
}
