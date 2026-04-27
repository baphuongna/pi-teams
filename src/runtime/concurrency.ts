export interface ResolveBatchConcurrencyInput {
	workflowName: string;
	teamMaxConcurrency?: number;
	limitMaxConcurrentWorkers?: number;
	readyCount: number;
	workspaceMode?: "single" | "worktree";
	readyRoles?: string[];
}

export interface BatchConcurrencyDecision {
	maxConcurrent: number;
	selectedCount: number;
	defaultConcurrency: number;
	reason: string;
}

export function defaultWorkflowConcurrency(workflowName: string): number {
	if (workflowName === "parallel-research") return 6;
	if (workflowName === "research") return 2;
	if (workflowName === "implementation" || workflowName === "review" || workflowName === "default") return 2;
	return 1;
}

function positiveInteger(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.max(1, Math.trunc(value));
}

export function resolveBatchConcurrency(input: ResolveBatchConcurrencyInput): BatchConcurrencyDecision {
	const defaultConcurrency = defaultWorkflowConcurrency(input.workflowName);
	const limitMax = positiveInteger(input.limitMaxConcurrentWorkers);
	const teamMax = positiveInteger(input.teamMaxConcurrency);
	const requested = limitMax ?? teamMax ?? defaultConcurrency;
	const source = limitMax !== undefined ? "limit" : teamMax !== undefined ? "team" : "workflow";
	const readyCount = Math.max(0, Math.trunc(input.readyCount));
	return {
		maxConcurrent: requested,
		selectedCount: readyCount === 0 ? 0 : Math.min(readyCount, requested),
		defaultConcurrency,
		reason: `${source}:${requested};ready:${readyCount}`,
	};
}
