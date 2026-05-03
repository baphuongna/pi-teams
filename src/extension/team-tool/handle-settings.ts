import type { TeamContext } from "../team-tool.ts";
import { loadConfig, updateConfig } from "../../config/config.ts";
import { configPatchFromConfig } from "../team-tool/config-patch.ts";
import { result } from "../team-tool/context.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
	const keys = path.split(".");
	let target: Record<string, unknown> = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		if (!target[keys[i]] || typeof target[keys[i]] !== "object") {
			target[keys[i]] = {};
		}
		target = target[keys[i]] as Record<string, unknown>;
	}
	target[keys[keys.length - 1]] = value;
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
	const keys = path.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function formatValue(value: unknown): string {
	if (value === undefined) return "<not set>";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

const KNOWN_KEYS = [
	"asyncByDefault",
	"executeWorkers",
	"notifierIntervalMs",
	"requireCleanWorktreeLeader",
	"runtime.mode",
	"runtime.preferLiveSession",
	"runtime.allowChildProcessFallback",
	"runtime.maxTurns",
	"runtime.graceTurns",
	"runtime.inheritContext",
	"runtime.promptMode",
	"runtime.groupJoin",
	"runtime.groupJoinAckTimeoutMs",
	"runtime.requirePlanApproval",
	"runtime.completionMutationGuard",
	"limits.maxConcurrentWorkers",
	"limits.allowUnboundedConcurrency",
	"limits.maxTaskDepth",
	"limits.maxChildrenPerTask",
	"limits.maxRunMinutes",
	"limits.maxRetriesPerTask",
	"limits.maxTasksPerRun",
	"limits.heartbeatStaleMs",
	"control.enabled",
	"control.needsAttentionAfterMs",
	"autonomous.profile",
	"autonomous.enabled",
	"autonomous.injectPolicy",
	"autonomous.preferAsyncForLongTasks",
	"autonomous.allowWorktreeSuggestion",
	"tools.enableClaudeStyleAliases",
	"tools.enableSteer",
	"tools.terminateOnForeground",
	"agents.disableBuiltins",
	"observability.prometheus.enabled",
	"observability.otlp.enabled",
	"worktree.enabled",
];

const OK = { action: "settings", status: "ok" as const };
const ERR = { action: "settings", status: "error" as const };

export function handleSettings(params: { config?: Record<string, unknown> }, ctx: TeamContext): PiTeamsToolResult {
	const cfg = (params.config ?? {}) as Record<string, unknown>;
	const args = typeof cfg.args === "string" ? cfg.args.trim() : "";
	const scope = cfg.scope === "project" ? "project" : "user";
	const loaded = loadConfig(ctx.cwd);
	const effective = loaded.config as Record<string, unknown>;

	// team-settings list
	if (!args || args === "list") {
		const lines = ["pi-crew settings:", `Path: ${loaded.path}`, ""];
		for (const key of KNOWN_KEYS) {
			const value = getNested(effective, key);
			lines.push(`  ${key} = ${formatValue(value)}`);
		}
		lines.push("", "Usage: team-settings [list|get <key>|set <key> <value>|unset <key>|path|scope]");
		return result(lines.join("\n"), { ...OK, count: KNOWN_KEYS.length } as never);
	}

	// team-settings path
	if (args === "path") {
		return result(`pi-crew config path: ${loaded.path}`, { ...OK, path: loaded.path } as never);
	}

	// team-settings scope
	if (args === "scope") {
		return result(`Current scope: ${scope}\nConfig at: ${loaded.path}`, { ...OK, scope } as never);
	}

	// team-settings get <key>
	if (args.startsWith("get ")) {
		const key = args.slice(4).trim();
		if (!key) return result("Usage: team-settings get <key>", { ...ERR }, true);
		const value = getNested(effective, key);
		return result(`${key} = ${formatValue(value)}`, { ...OK, key, value } as never);
	}

	// team-settings unset <key>
	if (args.startsWith("unset ")) {
		const key = args.slice(6).trim();
		if (!key) return result("Usage: team-settings unset <key>", { ...ERR }, true);
		try {
			const saved = updateConfig({}, { cwd: ctx.cwd, scope, unsetPaths: [key] });
			return result(`Unset ${key}\nPath: ${saved.path}`, { ...OK, key } as never);
		} catch (error) {
			return result(error instanceof Error ? error.message : String(error), { ...ERR }, true);
		}
	}

	// team-settings set <key> <value>
	if (args.startsWith("set ")) {
		const rest = args.slice(4).trim();
		const spaceIdx = rest.indexOf(" ");
		if (spaceIdx === -1) return result("Usage: team-settings set <key> <value>", { ...ERR }, true);
		const key = rest.slice(0, spaceIdx);
		const rawValue = rest.slice(spaceIdx + 1).trim();
		if (!key) return result("Usage: team-settings set <key> <value>", { ...ERR }, true);

		let value: unknown = rawValue;
		try { value = JSON.parse(rawValue); } catch { /* keep as string */ }
		if (rawValue === "true") value = true;
		if (rawValue === "false") value = false;

		const patch = {};
		setNested(patch as Record<string, unknown>, key, value);

		try {
			const converted = configPatchFromConfig({ config: patch as Record<string, unknown> });
			const saved = updateConfig(converted, { cwd: ctx.cwd, scope });
			return result(`Set ${key} = ${formatValue(value)}\nPath: ${saved.path}`, { ...OK, key, value } as never);
		} catch (error) {
			return result(error instanceof Error ? error.message : String(error), { ...ERR }, true);
		}
	}

	return result("Unknown subcommand. Usage: team-settings [list|get <key>|set <key> <value>|unset <key>|path|scope]", { ...ERR }, true);
}
