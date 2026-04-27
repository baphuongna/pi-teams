import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("doctor child smoke is opt-in and reports failure cleanly without throwing", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-doctor-smoke-"));
	const previousPiBin = process.env.PI_TEAMS_PI_BIN;
	try {
		const failingPi = path.join(tmp, "pi-fail.mjs");
		fs.writeFileSync(failingPi, "console.error('mock pi smoke failure'); process.exit(1);\n", "utf-8");
		process.env.PI_TEAMS_PI_BIN = failingPi;
		const result = await handleTeamTool({ action: "doctor", config: { smokeChildPi: true } }, { cwd: process.cwd() });
		const text = result.content[0]?.text ?? "";
		assert.match(text, /child Pi smoke/);
		assert.match(text, /mock pi smoke failure|Command failed/);
	} finally {
		if (previousPiBin === undefined) delete process.env.PI_TEAMS_PI_BIN;
		else process.env.PI_TEAMS_PI_BIN = previousPiBin;
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
