import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("doctor includes platform diagnostics", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-doctor-platform-"));
	try {
		const doctor = await handleTeamTool({ action: "doctor" }, { cwd });
		assert.match(doctor.content[0]?.text ?? "", new RegExp(`platform: ${process.platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${process.arch}`));
		assert.match(doctor.content[0]?.text ?? "", /node=v/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("doctor includes resource validation result", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teams-doctor-test-"));
	fs.mkdirSync(path.join(cwd, ".pi", "teams"), { recursive: true });
	try {
		fs.writeFileSync(path.join(cwd, ".pi", "teams", "broken.team.md"), "---\nname: broken\ndescription: Broken team\ndefaultWorkflow: missing-flow\n---\n\n- ghost: agent=ghost\n", "utf-8");
		const doctor = await handleTeamTool({ action: "doctor" }, { cwd });
		assert.equal(doctor.isError, true);
		assert.match(doctor.content[0]?.text ?? "", /resource validation/);
		assert.match(doctor.content[0]?.text ?? "", /1 errors|2 errors/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
