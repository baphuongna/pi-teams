import * as fs from "node:fs";
import * as path from "node:path";

export function atomicWriteFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tempPath, content, "utf-8");
	fs.renameSync(tempPath, filePath);
}

export function atomicWriteJson<T>(filePath: string, value: T): void {
	atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonFile<T>(filePath: string): T | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}
