import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function collectTypeScriptFiles(root: string): string[] {
	const entries = fs.readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTypeScriptFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(fullPath);
		}
	}
	return files;
}

function fileHasTeamContextImportFromTeamTool(filePath: string): boolean {
	const content = fs.readFileSync(filePath, "utf-8");
	const matches = content.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s+["'][^"']*team-tool\.ts["']/g);
	for (const match of matches) {
		if (match[0]?.includes("TeamContext")) return true;
	}
	return false;
}

test("team-tool actions use direct TeamContext imports from team-tool/context.ts", () => {
	const cwd = process.cwd();
	const offenders: string[] = [];
	for (const file of collectTypeScriptFiles(path.join(cwd, "src"))) {
		if (path.relative(cwd, file) === "src/extension/team-tool.ts") continue;
		if (fileHasTeamContextImportFromTeamTool(file)) offenders.push(path.relative(cwd, file));
	}
	for (const file of collectTypeScriptFiles(path.join(cwd, "test"))) {
		if (fileHasTeamContextImportFromTeamTool(file)) offenders.push(path.relative(cwd, file));
	}
	assert.equal(
		offenders.length,
		0,
		`TeamContext should be imported directly from team-tool/context.ts, but found imports from team-tool.ts in: ${offenders.join(", ")}`,
	);
});
