import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { listRuns } from "./run-index.ts";

export function notifyActiveRuns(ctx: ExtensionContext): void {
	const active = listRuns(ctx.cwd).filter((run) => run.status === "queued" || run.status === "planning" || run.status === "running").slice(0, 5);
	if (active.length === 0) return;
	ctx.ui.notify(`pi-crew active runs: ${active.map((run) => `${run.runId} [${run.status}]`).join(", ")}`, "info");
}
