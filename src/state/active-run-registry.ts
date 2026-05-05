import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_CACHE, DEFAULT_PATHS } from "../config/defaults.ts";
import type { TeamRunManifest } from "./types.ts";
import { atomicWriteJson } from "./atomic-write.ts";
import { userCrewRoot } from "../utils/paths.ts";
import { isSafePathId } from "../utils/safe-paths.ts";

export interface ActiveRunRegistryEntry {
	runId: string;
	cwd: string;
	stateRoot: string;
	manifestPath: string;
	updatedAt: string;
}

function registryPath(): string {
	return path.join(userCrewRoot(), DEFAULT_PATHS.state.runsSubdir, "active-run-index.json");
}

function normalizeEntry(value: unknown): ActiveRunRegistryEntry | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const runId = typeof record.runId === "string" ? record.runId : undefined;
	const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
	const stateRoot = typeof record.stateRoot === "string" ? record.stateRoot : undefined;
	const manifestPath = typeof record.manifestPath === "string" ? record.manifestPath : undefined;
	const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : undefined;
	if (!runId || !isSafePathId(runId) || !cwd || !stateRoot || !manifestPath || !updatedAt) return undefined;
	if (path.basename(stateRoot) !== runId) return undefined;
	if (path.resolve(manifestPath) !== path.resolve(path.join(stateRoot, DEFAULT_PATHS.state.manifestFile))) return undefined;
	return { runId, cwd, stateRoot, manifestPath, updatedAt };
}

export function readActiveRunRegistry(maxEntries = DEFAULT_CACHE.manifestMaxEntries): ActiveRunRegistryEntry[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(registryPath(), "utf-8"));
	} catch {
		return [];
	}
	const entries = Array.isArray(parsed) ? parsed.map(normalizeEntry).filter((entry): entry is ActiveRunRegistryEntry => entry !== undefined) : [];
	const byId = new Map<string, ActiveRunRegistryEntry>();
	for (const entry of entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
		if (!byId.has(entry.runId)) byId.set(entry.runId, entry);
	}
	return [...byId.values()].slice(0, Math.max(0, maxEntries));
}

function writeEntries(entries: ActiveRunRegistryEntry[]): void {
	fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
	atomicWriteJson(registryPath(), entries.slice(0, DEFAULT_CACHE.manifestMaxEntries));
}

export function registerActiveRun(manifest: TeamRunManifest): void {
	const entry: ActiveRunRegistryEntry = {
		runId: manifest.runId,
		cwd: manifest.cwd,
		stateRoot: manifest.stateRoot,
		manifestPath: path.join(manifest.stateRoot, DEFAULT_PATHS.state.manifestFile),
		updatedAt: manifest.updatedAt,
	};
	writeEntries([entry, ...readActiveRunRegistry().filter((item) => item.runId !== manifest.runId)]);
}

export function unregisterActiveRun(runId: string): void {
	if (!isSafePathId(runId)) return;
	writeEntries(readActiveRunRegistry().filter((entry) => entry.runId !== runId));
}

export function activeRunRoots(): string[] {
	const roots = new Set<string>();
	for (const entry of readActiveRunRegistry()) {
		try {
			if (!fs.existsSync(entry.stateRoot) || !fs.existsSync(entry.manifestPath)) continue;
			if (fs.lstatSync(entry.stateRoot).isSymbolicLink()) continue;
			roots.add(path.dirname(entry.stateRoot));
		} catch {
			// Ignore stale entries; callers filter active status from manifests.
		}
	}
	return [...roots];
}
