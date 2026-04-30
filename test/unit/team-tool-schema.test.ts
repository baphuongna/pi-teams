import test from "node:test";
import assert from "node:assert/strict";
import { TeamToolParams } from "../../src/schema/team-tool-schema.ts";

function walkSchema(node: unknown, visit: (node: Record<string, unknown>) => void): void {
	if (!node || typeof node !== "object" || Array.isArray(node)) return;
	const record = node as Record<string, unknown>;
	visit(record);
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) {
			for (const item of value) walkSchema(item, visit);
		} else {
			walkSchema(value, visit);
		}
	}
}

test("team tool schema is strict-provider friendly", () => {
	const violations: string[] = [];
	walkSchema(TeamToolParams, (node) => {
		if (Array.isArray(node.type)) violations.push("array type union");
		if (node.description && !node.type && !node.anyOf && !node.oneOf && !node.allOf && !node.properties) violations.push(`description-only schema: ${node.description}`);
		if (node.type === "array" && !node.items) violations.push("array without items");
		if (node.type && (node.anyOf || node.oneOf)) violations.push("type combined with union keyword");
	});
	assert.deepEqual(violations, []);
});

test("team tool flexible fields use explicit schema shapes", () => {
	const properties = (TeamToolParams as { properties: Record<string, unknown> }).properties;
	const skill = properties.skill as { anyOf?: unknown[] };
	const config = properties.config as { type?: string; additionalProperties?: boolean };
	assert.equal(Array.isArray(skill.anyOf), true);
	assert.equal(skill.anyOf?.length, 3);
	assert.equal(config.type, "object");
	assert.equal(config.additionalProperties, true);
});
