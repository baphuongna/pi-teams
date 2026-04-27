import * as fs from "node:fs";
import * as path from "node:path";

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(ms: number): void {
	const buffer = new SharedArrayBuffer(4);
	Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function isRetryableRenameError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && RETRYABLE_RENAME_CODES.has(String((error as NodeJS.ErrnoException).code)));
}

export function __test__renameWithRetry(tempPath: string, filePath: string, retries = 20, rename: (oldPath: string, newPath: string) => void = fs.renameSync): void {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			rename(tempPath, filePath);
			return;
		} catch (error) {
			lastError = error;
			if (!isRetryableRenameError(error) || attempt === retries) break;
			sleepSync(Math.min(250, 10 * 2 ** attempt));
		}
	}
	throw lastError;
}

export function atomicWriteFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		fs.writeFileSync(tempPath, content, "utf-8");
		__test__renameWithRetry(tempPath, filePath);
	} catch (error) {
		try { fs.rmSync(tempPath, { force: true }); } catch {}
		throw error;
	}
}

export function atomicWriteJson<T>(filePath: string, value: T): void {
	atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonFile<T>(filePath: string): T | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}
