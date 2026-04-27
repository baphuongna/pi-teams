import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleTeamTool } from "../../src/extension/team-tool.ts";

test("api supports mailbox inbox/outbox and delivery state", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-mailbox-"));
	fs.mkdirSync(path.join(cwd, ".pi"));
	try {
		const run = await handleTeamTool({ action: "run", team: "fast-fix", goal: "mailbox api" }, { cwd });
		const runId = run.details.runId;
		assert.ok(runId);
		const sent = await handleTeamTool({ action: "api", runId, config: { operation: "send-message", direction: "outbox", from: "leader", to: "worker", body: "hello" } }, { cwd });
		assert.equal(sent.isError, false);
		const message = JSON.parse(sent.content[0]?.text ?? "{}");
		assert.equal(message.direction, "outbox");
		const mailbox = await handleTeamTool({ action: "api", runId, config: { operation: "read-mailbox", direction: "outbox" } }, { cwd });
		const messages = JSON.parse(mailbox.content[0]?.text ?? "[]") as Array<{ id: string }>;
		assert.equal(messages.length, 1);
		const ack = await handleTeamTool({ action: "api", runId, config: { operation: "ack-message", messageId: messages[0]?.id } }, { cwd });
		assert.equal(ack.isError, false);
		const delivery = JSON.parse(ack.content[0]?.text ?? "{}");
		assert.equal(delivery.messages[messages[0]!.id], "acknowledged");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
