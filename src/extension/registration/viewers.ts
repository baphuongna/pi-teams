import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { loadRunManifestById } from "../../state/state-store.ts";
import { readCrewAgents } from "../../runtime/crew-agent-records.ts";
import { loadConfig } from "../../config/config.ts";
import { DurableTranscriptViewer } from "../../ui/transcript-viewer.ts";

export async function selectAgentTask(ctx: ExtensionCommandContext, runId: string | undefined, taskId?: string): Promise<{ runId: string; taskId?: string } | undefined> {
	if (!runId) return undefined;
	if (taskId) return { runId, taskId };
	const loaded = loadRunManifestById(ctx.cwd, runId);
	if (!loaded) return { runId };
	const agents = readCrewAgents(loaded.manifest);
	if (ctx.hasUI && agents.length > 1) {
		const choice = await ctx.ui.select("Select pi-crew agent", agents.map((agent) => `${agent.taskId} ${agent.role}→${agent.agent} [${agent.status}]`));
		return { runId, taskId: choice?.split(" ")[0] };
	}
	return { runId, taskId: agents[0]?.taskId };
}

export async function openTranscriptViewer(ctx: ExtensionCommandContext, initialRunId: string | undefined, initialTaskId?: string): Promise<boolean> {
	const selected = await selectAgentTask(ctx, initialRunId, initialTaskId);
	if (!selected) return false;
	const runId = selected.runId;
	const taskId = selected.taskId;
	if (!runId || !ctx.hasUI) return false;
	const loaded = loadRunManifestById(ctx.cwd, runId);
	if (!loaded) return false;
	const uiConfig = loadConfig(ctx.cwd).config.ui;
	await ctx.ui.custom<undefined>((_tui, theme, _keybindings, done) => new DurableTranscriptViewer(loaded.manifest, theme, done, taskId, { maxTailBytes: uiConfig?.transcriptTailBytes }), {
		overlay: true,
		overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" },
	});
	return true;
}
