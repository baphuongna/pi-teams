import test from "node:test";
import assert from "node:assert/strict";
import { configPath, loadConfig } from "../../src/config/config.ts";

test("loadConfig returns empty config when config file is absent or user-local", () => {
	const loaded = loadConfig();
	assert.equal(typeof loaded.path, "string");
	assert.equal(loaded.path, configPath());
	assert.equal(typeof loaded.config, "object");
});
