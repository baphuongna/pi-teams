import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function userPiRoot(): string {
	return path.join(os.homedir(), ".pi", "agent");
}

export function projectPiRoot(cwd: string): string {
	return path.join(cwd, ".pi");
}
