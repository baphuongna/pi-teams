import * as fs from "node:fs";
import type { UsageState } from "../state/types.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberField(obj: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function usageFromValue(value: unknown): UsageState | undefined {
	const obj = asRecord(value);
	if (!obj) return undefined;
	const direct: UsageState = {
		input: numberField(obj, ["input", "inputTokens", "input_tokens"]),
		output: numberField(obj, ["output", "outputTokens", "output_tokens"]),
		cacheRead: numberField(obj, ["cacheRead", "cache_read", "cacheReadTokens", "cache_read_tokens"]),
		cacheWrite: numberField(obj, ["cacheWrite", "cache_write", "cacheWriteTokens", "cache_write_tokens"]),
		cost: numberField(obj, ["cost", "costUsd", "cost_usd"]),
		turns: numberField(obj, ["turns", "turnCount", "turn_count"]),
	};
	if (Object.values(direct).some((entry) => entry !== undefined)) return direct;
	for (const key of ["usage", "tokenUsage", "tokens", "stats"]) {
		const nested = usageFromValue(obj[key]);
		if (nested) return nested;
	}
	const message = asRecord(obj.message);
	return message ? usageFromValue(message.usage) : undefined;
}

function addUsage(total: UsageState, usage: UsageState): UsageState {
	return {
		input: (total.input ?? 0) + (usage.input ?? 0),
		output: (total.output ?? 0) + (usage.output ?? 0),
		cacheRead: (total.cacheRead ?? 0) + (usage.cacheRead ?? 0),
		cacheWrite: (total.cacheWrite ?? 0) + (usage.cacheWrite ?? 0),
		cost: (total.cost ?? 0) + (usage.cost ?? 0),
		turns: (total.turns ?? 0) + (usage.turns ?? 0),
	};
}

function compactUsage(total: UsageState, foundKeys: Set<keyof UsageState>): UsageState | undefined {
	if (foundKeys.size === 0) return undefined;
	const compact: UsageState = {};
	for (const key of foundKeys) compact[key] = total[key];
	return compact;
}

export function parseSessionUsageFromJsonlText(text: string): UsageState | undefined {
	let total: UsageState = {};
	const foundKeys = new Set<keyof UsageState>();
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const usage = usageFromValue(JSON.parse(trimmed) as unknown);
			if (!usage) continue;
			for (const key of Object.keys(usage) as Array<keyof UsageState>) foundKeys.add(key);
			total = addUsage(total, usage);
		} catch {
			// Session JSONL can contain partial/corrupt lines after interrupted workers.
		}
	}
	return compactUsage(total, foundKeys);
}

export function parseSessionUsage(filePath: string): UsageState | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		return parseSessionUsageFromJsonlText(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return undefined;
	}
}
