import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config/config.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";

export interface PreparedTaskWorkspace {
	cwd: string;
	worktreePath?: string;
	branch?: string;
	reused?: boolean;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sanitizeBranchPart(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

export function findGitRoot(cwd: string): string {
	return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export function assertCleanLeader(repoRoot: string): void {
	const status = git(repoRoot, ["status", "--porcelain"]);
	if (status.trim()) {
		throw new Error("Worktree mode requires a clean leader repository. Commit/stash changes or use workspaceMode: 'single'.");
	}
}

export function prepareTaskWorkspace(manifest: TeamRunManifest, task: TeamTaskState): PreparedTaskWorkspace {
	if (manifest.workspaceMode !== "worktree") return { cwd: task.cwd };
	const repoRoot = findGitRoot(manifest.cwd);
	const loadedConfig = loadConfig(manifest.cwd);
	if (loadedConfig.config.requireCleanWorktreeLeader !== false) assertCleanLeader(repoRoot);
	const worktreeRoot = path.join(repoRoot, ".pi", "teams", "worktrees", manifest.runId);
	fs.mkdirSync(worktreeRoot, { recursive: true });
	const worktreePath = path.join(worktreeRoot, task.id);
	const branch = `pi-crew/${sanitizeBranchPart(manifest.runId)}/${sanitizeBranchPart(task.id)}`;
	if (fs.existsSync(worktreePath)) {
		const currentBranch = git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
		if (currentBranch !== branch) {
			throw new Error(`Existing worktree branch mismatch at ${worktreePath}: expected '${branch}', got '${currentBranch}'.`);
		}
		return { cwd: worktreePath, worktreePath, branch, reused: true };
	}
	git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
	return { cwd: worktreePath, worktreePath, branch, reused: false };
}

export function captureWorktreeDiff(worktreePath: string): string {
	try {
		return git(worktreePath, ["diff", "--stat"]) + "\n\n" + git(worktreePath, ["diff"]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Failed to capture worktree diff: ${message}`;
	}
}
