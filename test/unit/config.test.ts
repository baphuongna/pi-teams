import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configPath, loadConfig, projectConfigPath } from "../../src/config/config.ts";

test("loadConfig returns empty config when config file is absent or user-local", () => {
	const loaded = loadConfig();
	assert.equal(typeof loaded.path, "string");
	assert.equal(loaded.path, configPath());
	assert.equal(typeof loaded.config, "object");
});

test("loadConfig parses notification settings", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-notifications-config-"));
	try {
		fs.mkdirSync(path.dirname(projectConfigPath(cwd)), { recursive: true });
		fs.writeFileSync(projectConfigPath(cwd), JSON.stringify({ notifications: { enabled: true, severityFilter: ["info", "critical"], dedupWindowMs: 5000, batchWindowMs: 100, quietHours: "22:00-07:00", sinkRetentionDays: 14 } }), "utf-8");
		const loaded = loadConfig(cwd);
		assert.equal(loaded.config.notifications?.enabled, true);
		assert.deepEqual(loaded.config.notifications?.severityFilter, ["info", "critical"]);
		assert.equal(loaded.config.notifications?.dedupWindowMs, 5000);
		assert.equal(loaded.config.notifications?.batchWindowMs, 100);
		assert.equal(loaded.config.notifications?.quietHours, "22:00-07:00");
		assert.equal(loaded.config.notifications?.sinkRetentionDays, 14);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("loadConfig parses UI settings", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-ui-config-"));
	try {
		fs.mkdirSync(path.dirname(projectConfigPath(cwd)), { recursive: true });
		fs.writeFileSync(projectConfigPath(cwd), JSON.stringify({ ui: { widgetPlacement: "belowEditor", widgetMaxLines: 12, powerbar: false, dashboardPlacement: "right", dashboardWidth: 56, dashboardLiveRefreshMs: 750, autoOpenDashboard: true, autoOpenDashboardForForegroundRuns: false, showModel: true, showTokens: true, showTools: false, transcriptTailBytes: 131072 } }), "utf-8");
		const loaded = loadConfig(cwd);
		assert.equal(loaded.config.ui?.widgetPlacement, "belowEditor");
		assert.equal(loaded.config.ui?.widgetMaxLines, 12);
		assert.equal(loaded.config.ui?.powerbar, false);
		assert.equal(loaded.config.ui?.dashboardPlacement, "right");
		assert.equal(loaded.config.ui?.dashboardWidth, 56);
		assert.equal(loaded.config.ui?.dashboardLiveRefreshMs, 750);
		assert.equal(loaded.config.ui?.autoOpenDashboard, true);
		assert.equal(loaded.config.ui?.autoOpenDashboardForForegroundRuns, false);
		assert.equal(loaded.config.ui?.showModel, true);
		assert.equal(loaded.config.ui?.showTokens, true);
		assert.equal(loaded.config.ui?.showTools, false);
		assert.equal(loaded.config.ui?.transcriptTailBytes, 131072);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
