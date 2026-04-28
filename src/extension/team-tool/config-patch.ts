import { effectiveAutonomousConfig, parseConfig, type PiTeamsAutonomousConfig, type PiTeamsConfig } from "../../config/config.ts";

export function autonomousPatchFromConfig(config: unknown): PiTeamsAutonomousConfig {
	const rootPatch = parseConfig(config).autonomous;
	if (rootPatch) return rootPatch;
	return parseConfig({ autonomous: config }).autonomous ?? {};
}

export function configPatchFromConfig(config: unknown): PiTeamsConfig {
	return parseConfig(config);
}

export function effectiveRunConfig(base: PiTeamsConfig, rawOverride: unknown): PiTeamsConfig {
	const patch = parseConfig(rawOverride);
	return {
		...base,
		...patch,
		limits: patch.limits ? { ...(base.limits ?? {}), ...patch.limits } : base.limits,
		runtime: patch.runtime ? { ...(base.runtime ?? {}), ...patch.runtime } : base.runtime,
		control: patch.control ? { ...(base.control ?? {}), ...patch.control } : base.control,
		worktree: patch.worktree ? { ...(base.worktree ?? {}), ...patch.worktree } : base.worktree,
	};
}

export function formatAutonomyStatus(config: PiTeamsAutonomousConfig | undefined, pathValue: string, updated: boolean): string {
	const effective = effectiveAutonomousConfig(config);
	return [
		updated ? "Updated pi-crew autonomous mode." : "pi-crew autonomous mode:",
		`Path: ${pathValue}`,
		`Profile: ${effective.profile}`,
		`Enabled: ${effective.enabled}`,
		`Inject policy: ${effective.injectPolicy}`,
		`Prefer async for long tasks: ${effective.preferAsyncForLongTasks}`,
		`Allow worktree suggestion: ${effective.allowWorktreeSuggestion}`,
	].join("\n");
}
