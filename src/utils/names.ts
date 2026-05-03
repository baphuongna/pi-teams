export function sanitizeName(name: string): string {
	const result = name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
	return result || "unnamed";
}

export function requireString(value: unknown, label: string): { value?: string; error?: string } {
	if (typeof value !== "string" || !value.trim()) return { error: `${label} must be a non-empty string.` };
	return { value: value.trim() };
}

export function parseConfigObject(config: unknown): { value?: Record<string, unknown>; error?: string } {
	let parsed = config;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed) as unknown;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { error: `config must be valid JSON: ${message}` };
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "config must be an object." };
	return { value: parsed as Record<string, unknown> };
}

export function hasOwn(obj: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}
