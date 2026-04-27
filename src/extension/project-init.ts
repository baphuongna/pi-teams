import * as fs from "node:fs";
import * as path from "node:path";
import { packageRoot } from "../utils/paths.ts";

export interface ProjectInitOptions {
	copyBuiltins?: boolean;
	overwrite?: boolean;
}

export interface ProjectInitResult {
	createdDirs: string[];
	copiedFiles: string[];
	skippedFiles: string[];
	gitignorePath: string;
	gitignoreUpdated: boolean;
}

function ensureDir(dir: string, createdDirs: string[]): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		createdDirs.push(dir);
	} else {
		fs.mkdirSync(dir, { recursive: true });
	}
}

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
	const piRoot = path.join(cwd, ".pi");
	const agentsDir = path.join(piRoot, "agents");
	const teamsDir = path.join(piRoot, "teams");
	const workflowsDir = path.join(piRoot, "workflows");
	ensureDir(agentsDir, createdDirs);
	ensureDir(teamsDir, createdDirs);
	ensureDir(workflowsDir, createdDirs);
	ensureDir(path.join(piRoot, "teams", "imports"), createdDirs);

	if (options.copyBuiltins) {
		copyBuiltinDir("agents", agentsDir, options.overwrite === true, copiedFiles, skippedFiles);
		copyBuiltinDir("teams", teamsDir, options.overwrite === true, copiedFiles, skippedFiles);
		copyBuiltinDir("workflows", workflowsDir, options.overwrite === true, copiedFiles, skippedFiles);
	}

	const gitignorePath = path.join(cwd, ".gitignore");
	const desired = [".pi/teams/state/", ".pi/teams/artifacts/", ".pi/teams/worktrees/", ".pi/teams/imports/"];
	const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
	const missing = desired.filter((entry) => !existing.split(/\r?\n/).includes(entry));
	let gitignoreUpdated = false;
	if (missing.length > 0) {
		const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
		fs.writeFileSync(gitignorePath, `${existing}${prefix}\n# pi-crew runtime state\n${missing.join("\n")}\n`, "utf-8");
		gitignoreUpdated = true;
	}

	return { createdDirs, copiedFiles, skippedFiles, gitignorePath, gitignoreUpdated };
}
