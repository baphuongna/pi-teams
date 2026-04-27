import type { AgentConfig } from "../agents/agent-config.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import type { WorkflowStep } from "../workflows/workflow-config.ts";
import { isLiveSessionRuntimeAvailable } from "./runtime-resolver.ts";

export interface LiveSessionSpawnInput {
	manifest: TeamRunManifest;
	task: TeamTaskState;
	step: WorkflowStep;
	agent: AgentConfig;
	prompt: string;
}

export interface LiveSessionUnavailableResult {
	available: false;
	reason: string;
}

export interface LiveSessionPlannedResult {
	available: true;
	reason: string;
}

export async function probeLiveSessionRuntime(): Promise<LiveSessionUnavailableResult | LiveSessionPlannedResult> {
	const availability = await isLiveSessionRuntimeAvailable();
	if (!availability.available) return { available: false, reason: availability.reason ?? "Live-session runtime is unavailable." };
	return { available: true, reason: "Live-session SDK exports are available. Full session execution is intentionally gated behind the runtime adapter implementation." };
}

export async function runLiveSessionTask(_input: LiveSessionSpawnInput): Promise<never> {
	const probe = await probeLiveSessionRuntime();
	throw new Error(probe.available ? "Live-session runtime adapter is not enabled yet; use child-process runtime or scaffold." : probe.reason);
}
