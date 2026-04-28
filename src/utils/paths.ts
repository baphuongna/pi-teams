import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function userPiRoot(): string {
	return path.join(os.homedir(), ".pi", "agent");
}

export function findRepoRoot(cwd: string): string | undefined {
	let current = path.resolve(cwd);
	const root = path.parse(current).root;
	while (current !== root) {
		if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, ".pi"))) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	if (fs.existsSync(path.join(root, ".git")) || fs.existsSync(path.join(root, ".pi"))) {
		return root;
	}
	return undefined;
}

export function projectPiRoot(cwd: string): string {
	return path.join(findRepoRoot(cwd) ?? cwd, ".pi");
}
