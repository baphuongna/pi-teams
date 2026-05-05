export const DEFAULT_CHILD_PI = {
	postExitStdioGuardMs: 3000,
	finalDrainMs: 5000,
	hardKillMs: 3000,
	// Child workers can spend more than a few seconds in provider calls or long-running tools without emitting stdout.
	// Keep this as a coarse stuck-worker guard rather than a short per-message latency budget.
	responseTimeoutMs: 5 * 60_000,
	maxCaptureBytes: 256 * 1024,
	maxAssistantTextChars: 8192,
	maxToolResultChars: 1024,
	maxToolInputChars: 2048,
	maxCompactContentChars: 4096,
};

export const DEFAULT_LOCKS = {
	staleMs: 30_000,
};

export const DEFAULT_CONCURRENCY = {
	hardCap: 8,
	workflow: {
		parallelResearch: 4,
		research: 2,
		implementation: 2,
		review: 2,
		default: 2,
	},
	fallback: 1,
};

export const DEFAULT_EVENT_LOG = {
	terminalEventTypes: ["run.blocked", "run.completed", "run.failed", "run.cancelled", "task.completed", "task.failed", "task.skipped", "task.cancelled"],
};

export const DEFAULT_ARTIFACT_CLEANUP = {
	maxAgeDays: 7,
};

export const DEFAULT_PATHS = {
	state: {
		runsSubdir: "state/runs",
		artifactsSubdir: "artifacts",
		subagentsSubdir: "state/subagents",
		importsSubdir: "imports",
		worktreesSubdir: "worktrees",
		manifestFile: "manifest.json",
		tasksFile: "tasks.json",
		eventsFile: "events.jsonl",
	},
};

export const DEFAULT_UI = {
	refreshMs: 1000,
	notifierIntervalMs: 5000,
	widgetDefaultFrameMs: 1000,
	widgetPlacement: "aboveEditor" as const,
	widgetMaxLines: 8,
	powerbar: true,
	dashboardPlacement: "center" as const,
	dashboardWidth: 72,
	dashboardLiveRefreshMs: 1000,
	autoOpenDashboard: false,
	autoOpenDashboardForForegroundRuns: false,
	showModel: true,
	showTokens: true,
	showTools: true,
	transcriptTailBytes: 1024 * 1024,
	mascotStyle: "cat" as const,
	mascotEffect: "random" as const,
};

export const DEFAULT_NOTIFICATIONS = {
	severityFilter: ["warning", "error", "critical"] as const,
	dedupWindowMs: 30_000,
	batchWindowMs: 0,
	sinkRetentionDays: 7,
};

export const DEFAULT_CACHE = {
	manifestMaxEntries: 64,
};

export const DEFAULT_SUBAGENT = {
	stuckBlockedNotifyMs: 5 * 60_000,
};
