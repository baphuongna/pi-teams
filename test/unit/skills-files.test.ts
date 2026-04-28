import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const expectedSkills = ["safe-bash", "verify-evidence", "git-master", "read-only-explorer", "task-packet"];

test("package ships built-in coding skills", () => {
	const root = process.cwd();
	for (const name of expectedSkills) {
		const skillPath = path.join(root, "skills", name, "SKILL.md");
		assert.equal(fs.existsSync(skillPath), true, `${name} should have SKILL.md`);
		const content = fs.readFileSync(skillPath, "utf-8");
		assert.match(content, new RegExp(`# ${name}`));
		assert.ok(content.length > 100, `${name} should contain usable guidance`);
	}
});
