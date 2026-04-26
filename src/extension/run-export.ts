import * as fs from "node:fs";
import * as path from "node:path";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { writeArtifact } from "../state/artifact-store.ts";
import { readEvents, type TeamEvent } from "../state/event-log.ts";

export interface ExportedRunBundle {
	schemaVersion: 1;
	exportedAt: string;
	manifest: TeamRunManifest;
	tasks: TeamTaskState[];
	events: TeamEvent[];
	artifactPaths: string[];
}

export function exportRunBundle(manifest: TeamRunManifest, tasks: TeamTaskState[]): { jsonPath: string; markdownPath: string } {
	const events = readEvents(manifest.eventsPath);
	const bundle: ExportedRunBundle = {
		schemaVersion: 1,
		exportedAt: new Date().toISOString(),
		manifest,
		tasks,
		events,
		artifactPaths: manifest.artifacts.map((artifact) => artifact.path),
	};
	const json = writeArtifact(manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: "export/run-export.json",
		producer: "run-export",
		content: `${JSON.stringify(bundle, null, 2)}\n`,
	});
	const markdown = writeArtifact(manifest.artifactsRoot, {
		kind: "summary",
		relativePath: "export/run-export.md",
		producer: "run-export",
		content: [
			`# pi-teams export ${manifest.runId}`,
			"",
			`Exported: ${bundle.exportedAt}`,
			`Status: ${manifest.status}`,
			`Team: ${manifest.team}`,
			`Workflow: ${manifest.workflow ?? "(none)"}`,
			`Goal: ${manifest.goal}`,
			"",
			"## Tasks",
			...tasks.map((task) => `- ${task.id}: ${task.status} (${task.role} -> ${task.agent})${task.error ? ` - ${task.error}` : ""}`),
			"",
			"## Artifacts",
			...(manifest.artifacts.length ? manifest.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path}`) : ["- (none)"]),
			"",
			"## Recent Events",
			...(events.slice(-20).map((event) => `- ${event.time} ${event.type}${event.taskId ? ` ${event.taskId}` : ""}${event.message ? `: ${event.message}` : ""}`)),
			"",
		].join("\n"),
	});
	// Ensure artifact dirs are materialized before returning paths on filesystems with delayed metadata.
	fs.statSync(path.dirname(json.path));
	return { jsonPath: json.path, markdownPath: markdown.path };
}
