import type { HookDefinition, HookName, HookContext, HookResult, HookExecutionReport } from "./types.ts";
import { appendEvent } from "../state/event-log.ts";
import type { TeamRunManifest } from "../state/types.ts";

const registry = new Map<HookName, HookDefinition[]>();

export function registerHook(definition: HookDefinition): void {
	const hooks = registry.get(definition.name) ?? [];
	hooks.push(definition);
	registry.set(definition.name, hooks);
}

export function clearHooks(): void {
	registry.clear();
}

export function getHooks(name: HookName): HookDefinition[] {
	return registry.get(name) ?? [];
}

export async function executeHook(name: HookName, ctx: HookContext): Promise<HookExecutionReport> {
	const hooks = getHooks(name);
	if (hooks.length === 0) return { hookName: name, outcome: "allow", durationMs: 0 };
	const start = Date.now();
	for (const hook of hooks) {
		try {
			const result: HookResult = await hook.handler(ctx);
			if (hook.mode === "blocking" && result.outcome === "block") {
				return { hookName: name, outcome: "block", durationMs: Date.now() - start, reason: result.reason };
			}
			if (result.outcome === "modify" && result.data) {
				Object.assign(ctx, result.data);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (hook.mode === "blocking") {
				return { hookName: name, outcome: "block", durationMs: Date.now() - start, reason: `Hook error: ${message}` };
			}
			// Non-blocking hook errors are recorded as diagnostics
			return { hookName: name, outcome: "diagnostic", durationMs: Date.now() - start, reason: message };
		}
	}
	return { hookName: name, outcome: "allow", durationMs: Date.now() - start };
}

export function appendHookEvent(manifest: TeamRunManifest, report: HookExecutionReport): void {
	appendEvent(manifest.eventsPath, {
		type: "hook.executed",
		runId: manifest.runId,
		message: `Hook ${report.hookName} completed with outcome=${report.outcome}${report.reason ? `: ${report.reason}` : ""}`,
		data: { hookName: report.hookName, outcome: report.outcome, durationMs: report.durationMs, reason: report.reason },
	});
}