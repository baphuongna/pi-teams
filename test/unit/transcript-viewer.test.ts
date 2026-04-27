import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DurableTextViewer, DurableTranscriptViewer, formatTranscriptText, readRunTranscript } from "../../src/ui/transcript-viewer.ts";
import { saveCrewAgents } from "../../src/runtime/crew-agent-records.ts";
import type { TeamRunManifest } from "../../src/state/types.ts";

function manifest(tmp: string): TeamRunManifest {
	return {
		schemaVersion: 1,
		runId: "team_transcript",
		team: "fast-fix",
		workflow: "fast-fix",
		goal: "transcript viewer",
		status: "completed",
		workspaceMode: "single",
		createdAt: "2026-04-27T00:00:00.000Z",
		updatedAt: "2026-04-27T00:00:00.000Z",
		cwd: tmp,
		stateRoot: tmp,
		artifactsRoot: tmp,
		tasksPath: path.join(tmp, "tasks.json"),
		eventsPath: path.join(tmp, "events.jsonl"),
		artifacts: [],
	};
}

test("formatTranscriptText formats message and tool JSONL into conversation lines", () => {
	const text = `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } })}\n${JSON.stringify({ type: "tool_result", toolName: "bash", text: "ok" })}\n`;
	assert.deepEqual(formatTranscriptText(text), ["[Assistant]:", "hello", "[Tool: bash] tool_result", "ok"]);
});

test("DurableTranscriptViewer renders transcript overlay and scroll controls", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-transcript-viewer-"));
	try {
		const run = manifest(tmp);
		const transcriptPath = path.join(tmp, "transcript.jsonl");
		fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "viewer hello" }] } })}\n`, "utf-8");
		saveCrewAgents(run, [{ id: "team_transcript:01", runId: run.runId, taskId: "01", agent: "explorer", role: "explorer", runtime: "live-session", status: "completed", startedAt: run.createdAt, transcriptPath }]);
		assert.match(readRunTranscript(run).lines.join("\n"), /viewer hello/);
		let closed = false;
		const viewer = new DurableTranscriptViewer(run, { fg: (_color: string, value: string) => value, bold: (value: string) => value } as never, () => { closed = true; });
		const lines = viewer.render(100);
		assert.ok(lines.some((line) => line.includes("pi-crew transcript")));
		assert.ok(lines.some((line) => line.includes("viewer hello")));
		viewer.handleInput("q");
		assert.equal(closed, true);
		const resultViewer = new DurableTextViewer("pi-crew result", "team_transcript:01", ["result hello"], { fg: (_color: string, value: string) => value, bold: (value: string) => value } as never, () => {});
		assert.ok(resultViewer.render(80).some((line) => line.includes("result hello")));
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
