import * as fs from "node:fs";
import * as path from "node:path";

export function isSafePathId(value: string): boolean {
	return /^[A-Za-z0-9_-]+$/.test(value);
}

export function assertSafePathId(kind: string, value: string): string {
	if (!isSafePathId(value)) throw new Error(`Invalid ${kind}: ${value}`);
	return value;
}

export function resolveContainedPath(baseDir: string, targetPath: string): string {
	const base = path.resolve(baseDir);
	const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(base, targetPath);
	const relative = path.relative(base, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path is outside ${baseDir}: ${targetPath}`);
	return resolved;
}

export function resolveRealContainedPath(baseDir: string, targetPath: string): string {
	const resolved = resolveContainedPath(baseDir, targetPath);
	const realBase = fs.realpathSync.native(baseDir);
	const realTarget = fs.realpathSync.native(resolved);
	const relative = path.relative(realBase, realTarget);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path is outside ${baseDir}: ${targetPath}`);
	return realTarget;
}

export function resolveContainedRelativePath(baseDir: string, relativePath: string, kind = "path"): string {
	const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
	if (!normalized || normalized.split("/").some((segment) => segment === "..") || path.isAbsolute(normalized)) throw new Error(`Invalid ${kind}: ${relativePath}`);
	return resolveContainedPath(baseDir, path.resolve(baseDir, normalized));
}
