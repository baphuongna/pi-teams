export interface ParsedFrontmatter {
	frontmatter: Record<string, string>;
	body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { frontmatter: {}, body: content };
	}

	const normalized = content.replaceAll("\r\n", "\n");
	const end = normalized.indexOf("\n---\n", 4);
	if (end === -1) return { frontmatter: {}, body: content };

	const raw = normalized.slice(4, end);
	const body = normalized.slice(end + "\n---\n".length);
	const frontmatter: Record<string, string> = {};

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf(":");
		if (separator === -1) continue;
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();
		if (key) frontmatter[key] = value;
	}

	return { frontmatter, body };
}

export function parseCsv(value: string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	const values = value.split(",").map((item) => item.trim()).filter(Boolean);
	return values.length > 0 ? [...new Set(values)] : undefined;
}
