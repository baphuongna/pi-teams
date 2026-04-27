import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactDescriptor, TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { writeArtifact } from "../state/artifact-store.ts";
import type { WorkflowStep } from "../workflows/workflow-config.ts";

export interface DependencyOutputContext {
	dependencies: Array<{ taskId: string; title: string; status: string; result?: string; resultPath?: string }>;
	sharedReads: Array<{ name: string; path: string; content: string }>;
}

function readIfSmall(filePath: string, maxBytes = 24_000): string | undefined {
	try {
		const stat = fs.statSync(filePath);
		if (stat.size > maxBytes) return `${fs.readFileSync(filePath, "utf-8").slice(0, maxBytes)}\n\n...(truncated ${stat.size - maxBytes} bytes)`;
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

export function sharedPath(manifest: TeamRunManifest, name: string): string {
	return path.join(manifest.artifactsRoot, "shared", name);
}

export function collectDependencyOutputContext(manifest: TeamRunManifest, tasks: TeamTaskState[], task: TeamTaskState, step: WorkflowStep): DependencyOutputContext {
	const byStep = new Map(tasks.map((item) => [item.stepId, item]).filter((entry): entry is [string, TeamTaskState] => Boolean(entry[0])));
	const byId = new Map(tasks.map((item) => [item.id, item]));
	const dependencies = task.dependsOn.map((dep) => byStep.get(dep) ?? byId.get(dep)).filter((item): item is TeamTaskState => Boolean(item)).map((item) => ({
		taskId: item.id,
		title: item.title,
		status: item.status,
		resultPath: item.resultArtifact?.path,
		result: item.resultArtifact ? readIfSmall(item.resultArtifact.path) : undefined,
	}));
	const sharedReads = (step.reads === false ? [] : step.reads ?? []).map((name) => {
		const filePath = sharedPath(manifest, name);
		return { name, path: filePath, content: readIfSmall(filePath) ?? "" };
	}).filter((item) => item.content.trim().length > 0);
	return { dependencies, sharedReads };
}

export function renderDependencyOutputContext(context: DependencyOutputContext): string {
	const parts: string[] = [];
	if (context.dependencies.length) {
		parts.push("# Dependency Outputs", "");
		for (const dep of context.dependencies) {
			parts.push(`## ${dep.taskId} (${dep.title})`, `Status: ${dep.status}`, dep.resultPath ? `Result artifact: ${dep.resultPath}` : "", "", dep.result?.trim() || "(no result output)", "");
		}
	}
	if (context.sharedReads.length) {
		parts.push("# Shared Run Context Reads", "");
		for (const read of context.sharedReads) parts.push(`## shared/${read.name}`, `Path: ${read.path}`, "", read.content.trim(), "");
	}
	return parts.join("\n").trim();
}

export function writeTaskSharedOutput(manifest: TeamRunManifest, step: WorkflowStep, task: TeamTaskState): ArtifactDescriptor | undefined {
	if (step.output === false) return undefined;
	const name = step.output || `${task.id}.md`;
	const source = task.resultArtifact ? readIfSmall(task.resultArtifact.path, 80_000) : undefined;
	if (!source) return undefined;
	return writeArtifact(manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: `shared/${name}`,
		producer: task.id,
		content: source.endsWith("\n") ? source : `${source}\n`,
	});
}

export function writeTaskInputsArtifact(manifest: TeamRunManifest, task: TeamTaskState, context: DependencyOutputContext): ArtifactDescriptor {
	return writeArtifact(manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: `metadata/${task.id}.inputs.json`,
		producer: task.id,
		content: `${JSON.stringify(context, null, 2)}\n`,
	});
}

export function aggregateTaskOutputs(tasks: TeamTaskState[]): string {
	return tasks.map((task, index) => {
		const body = task.resultArtifact ? readIfSmall(task.resultArtifact.path, 40_000) : undefined;
		const hasBody = Boolean(body?.trim());
		const expectedMissing = task.resultArtifact && !fs.existsSync(task.resultArtifact.path);
		const status = task.status === "skipped"
			? "SKIPPED"
			: task.status === "failed"
				? `FAILED${task.exitCode !== undefined ? ` (exit code ${task.exitCode ?? "null"})` : ""}${task.error ? `: ${task.error}` : ""}`
				: expectedMissing
					? `EMPTY OUTPUT (expected result artifact missing: ${task.resultArtifact?.path})`
					: !hasBody
						? "EMPTY OUTPUT (no textual response returned)"
						: task.status.toUpperCase();
		return [
			`=== Task ${index + 1}: ${task.id} (${task.agent}) ===`,
			`Status: ${status}`,
			task.role ? `Role: ${task.role}` : "",
			task.resultArtifact?.path ? `Result artifact: ${task.resultArtifact.path}` : "",
			task.logArtifact?.path ? `Log artifact: ${task.logArtifact.path}` : "",
			task.transcriptArtifact?.path ? `Transcript: ${task.transcriptArtifact.path}` : "",
			task.usage ? `Usage: ${JSON.stringify(task.usage)}` : "",
			"",
			hasBody ? body!.trim() : status,
		].filter(Boolean).join("\n");
	}).join("\n\n");
}
