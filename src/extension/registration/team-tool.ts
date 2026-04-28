import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "../../config/config.ts";
import { TeamToolParams, type TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import type { CrewWidgetState } from "../../ui/crew-widget.ts";
import { updateCrewWidget } from "../../ui/crew-widget.ts";
import { updatePiCrewPowerbar } from "../../ui/powerbar-publisher.ts";
import type { createManifestCache } from "../../runtime/manifest-cache.ts";
import { handleTeamTool } from "../team-tool.ts";

export interface RegisterTeamToolDeps {
	foregroundControllers: Set<AbortController>;
	startForegroundRun: (ctx: ExtensionContext, runner: (signal?: AbortSignal) => Promise<void>, runId?: string) => void;
	openLiveSidebar: (ctx: ExtensionContext, runId: string) => void;
	getManifestCache: (cwd: string) => ReturnType<typeof createManifestCache>;
	widgetState: CrewWidgetState;
}

export function registerTeamTool(pi: ExtensionAPI, deps: RegisterTeamToolDeps): void {
	const tool: ToolDefinition = {
		name: "team",
		label: "Team",
		description: "Coordinate Pi teams. Use proactively for complex multi-file work, planning, implementation, tests, reviews, security audits, research, async/background runs, and worktree-isolated execution. Use action='recommend' when unsure which team/workflow to choose. Destructive actions require explicit user confirmation.",
		promptSnippet: "Use the team tool proactively for coordinated multi-agent work. If unsure, call { action: 'recommend', goal } first, then run or plan with the suggested team/workflow.",
		parameters: TeamToolParams as never,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const controller = new AbortController();
			deps.foregroundControllers.add(controller);
			const abort = (): void => controller.abort();
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const output = await handleTeamTool(params as TeamToolParamsValue, { ...ctx, signal: controller.signal, startForegroundRun: (runner, runId) => deps.startForegroundRun(ctx, runner, runId), onRunStarted: (runId) => deps.openLiveSidebar(ctx, runId) });
				const config = loadConfig(ctx.cwd).config.ui;
				const cache = deps.getManifestCache(ctx.cwd);
				updateCrewWidget(ctx, deps.widgetState, config, cache);
				updatePiCrewPowerbar(pi.events, ctx.cwd, config, cache);
				return output;
			} finally {
				signal?.removeEventListener("abort", abort);
				deps.foregroundControllers.delete(controller);
			}
		},
	};
	pi.registerTool(tool);
}
