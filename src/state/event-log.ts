import * as fs from "node:fs";
import * as path from "node:path";

export interface TeamEvent {
	time: string;
	type: string;
	runId: string;
	taskId?: string;
	message?: string;
	data?: Record<string, unknown>;
}

export function appendEvent(eventsPath: string, event: Omit<TeamEvent, "time">): TeamEvent {
	fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
	const fullEvent: TeamEvent = { time: new Date().toISOString(), ...event };
	fs.appendFileSync(eventsPath, `${JSON.stringify(fullEvent)}\n`, "utf-8");
	return fullEvent;
}

export function readEvents(eventsPath: string): TeamEvent[] {
	if (!fs.existsSync(eventsPath)) return [];
	return fs.readFileSync(eventsPath, "utf-8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TeamEvent);
}
