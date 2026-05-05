import * as fs from "node:fs";
import * as path from "node:path";
import { configPath as globalConfigPath } from "../config/config.ts";
import { DEFAULT_UI } from "../config/defaults.ts";
import { packageRoot, projectCrewRoot, projectPiRoot } from "../utils/paths.ts";

export interface ProjectInitOptions {
	copyBuiltins?: boolean;
	overwrite?: boolean;
	configScope?: "global" | "project" | "none";
}

export interface ProjectInitResult {
	createdDirs: string[];
	copiedFiles: string[];
	skippedFiles: string[];
	gitignorePath: string;
	gitignoreUpdated: boolean;
	configPath: string;
	configScope: "global" | "project" | "none";
	configCreated: boolean;
	configSkipped: boolean;
}

function ensureDir(dir: string, createdDirs: string[]): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		createdDirs.push(dir);
	} else {
		fs.mkdirSync(dir, { recursive: true });
	}
}

const DEFAULT_PI_CREW_CONFIG = {
	// Keep generated config non-invasive: do not set runtime/limits defaults here.
	// Those are provided by pi-crew internals and should not make a normal workflow block.
	autonomous: {
		enabled: true,
		injectPolicy: true,
		preferAsyncForLongTasks: false,
		allowWorktreeSuggestion: true,
	},
	agents: {
		overrides: {
			explorer: { model: false, thinking: "off" },
			writer: { model: false, thinking: "off" },
			planner: { model: false, thinking: "medium" },
			analyst: { model: false, thinking: "off" },
			critic: { model: false, thinking: "low" },
			executor: { model: false, thinking: "medium" },
			reviewer: { model: false, thinking: "off" },
			"security-reviewer": { model: false, thinking: "medium" },
			"test-engineer": { model: false, thinking: "low" },
			verifier: { model: false, thinking: "off" },
		},
	},
	ui: {
		widgetPlacement: DEFAULT_UI.widgetPlacement,
		widgetMaxLines: DEFAULT_UI.widgetMaxLines,
		powerbar: DEFAULT_UI.powerbar,
		dashboardPlacement: DEFAULT_UI.dashboardPlacement,
		dashboardWidth: DEFAULT_UI.dashboardWidth,
		dashboardLiveRefreshMs: DEFAULT_UI.dashboardLiveRefreshMs,
		autoOpenDashboard: DEFAULT_UI.autoOpenDashboard,
		autoOpenDashboardForForegroundRuns: DEFAULT_UI.autoOpenDashboardForForegroundRuns,
		showModel: DEFAULT_UI.showModel,
		showTokens: DEFAULT_UI.showTokens,
		showTools: DEFAULT_UI.showTools,
	},
};

function copyBuiltinDir(kind: "agents" | "teams" | "workflows", targetDir: string, overwrite: boolean, copiedFiles: string[], skippedFiles: string[]): void {
	const sourceDir = path.join(packageRoot(), kind);
	if (!fs.existsSync(sourceDir)) return;
	for (const entry of fs.readdirSync(sourceDir)) {
		const source = path.join(sourceDir, entry);
		const target = path.join(targetDir, entry);
		if (!fs.statSync(source).isFile()) continue;
		if (fs.existsSync(target) && !overwrite) {
			skippedFiles.push(target);
			continue;
		}
		fs.copyFileSync(source, target);
		copiedFiles.push(target);
	}
}

export function initializeProject(cwd: string, options: ProjectInitOptions = {}): ProjectInitResult {
	const createdDirs: string[] = [];
	const copiedFiles: string[] = [];
	const skippedFiles: string[] = [];
	const crewRoot = projectCrewRoot(cwd);
	const usingLegacyPi = path.basename(crewRoot) === "teams" && path.basename(path.dirname(crewRoot)) === ".pi";
	const ignorePrefix = usingLegacyPi ? ".pi/teams" : ".crew";
	const agentsDir = path.join(crewRoot, "agents");
	const teamsDir = path.join(crewRoot, "teams");
	const workflowsDir = path.join(crewRoot, "workflows");
	const configScope = options.configScope ?? "global";
	const configPath = configScope === "project" ? path.join(projectPiRoot(cwd), "pi-crew.json") : configScope === "global" ? globalConfigPath() : "";
	ensureDir(agentsDir, createdDirs);
	ensureDir(teamsDir, createdDirs);
	ensureDir(workflowsDir, createdDirs);
	ensureDir(path.join(crewRoot, "imports"), createdDirs);

	let configCreated = false;
	let configSkipped = false;
	if (configPath) {
		if (configScope === "project") ensureDir(path.dirname(configPath), createdDirs);
		else fs.mkdirSync(path.dirname(configPath), { recursive: true });
		if (!fs.existsSync(configPath) || options.overwrite === true) {
			fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_PI_CREW_CONFIG, null, 2)}\n`, "utf-8");
			configCreated = true;
		} else {
			configSkipped = true;
		}
	}

	if (options.copyBuiltins) {
		copyBuiltinDir("agents", agentsDir, options.overwrite === true, copiedFiles, skippedFiles);
		copyBuiltinDir("teams", teamsDir, options.overwrite === true, copiedFiles, skippedFiles);
		copyBuiltinDir("workflows", workflowsDir, options.overwrite === true, copiedFiles, skippedFiles);
	}

	const gitignorePath = path.join(cwd, ".gitignore");
	const desired = [`${ignorePrefix}/state/`, `${ignorePrefix}/artifacts/`, `${ignorePrefix}/worktrees/`, `${ignorePrefix}/imports/`];
	const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
	const missing = desired.filter((entry) => !existing.split(/\r?\n/).includes(entry));
	let gitignoreUpdated = false;
	if (missing.length > 0) {
		const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
		fs.writeFileSync(gitignorePath, `${existing}${prefix}\n# pi-crew runtime state\n${missing.join("\n")}\n`, "utf-8");
		gitignoreUpdated = true;
	}

	return { createdDirs, copiedFiles, skippedFiles, gitignorePath, gitignoreUpdated, configPath, configScope, configCreated, configSkipped };
}
