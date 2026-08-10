import type { MachineDefinition, Script } from "@1state/core";
import validate from "@1state/validate";
import schema from "@1state/validate/schema";
import { describe, expect, test } from "tstyche";

const flow = {
	initial: "idle",
	states: {
		idle: { on: { GO: "busy" } },
		busy: { go: [{ target: "done", cond: "isReady" }] },
		done: { type: "final" },
	},
} satisfies MachineDefinition;

const scripts: { [name: string]: Script } = {
	isReady: () => true,
};

describe("validate", () => {
	test("reports every problem it found", () => {
		expect(validate(flow)).type.toBe<string[]>();
	});

	test("takes the same options object createMachine does", () => {
		expect(validate(flow, { scripts })).type.toBe<string[]>();
		expect(validate(flow, {})).type.toBe<string[]>();
	});

	test("is synchronous", () => {
		expect(validate(flow)).type.not.toBeAssignableTo<Promise<string[]>>();
	});

	test("needs a definition", () => {
		expect(validate).type.not.toBeCallableWith();
	});

	test("rejects an unknown option", () => {
		expect(validate).type.not.toBeCallableWith(flow, { registry: scripts });
	});
});

describe("schema", () => {
	test("is a 2020-12 document rooted at a $ref", () => {
		expect(schema.$schema).type.toBe<string>();
		expect(schema.$ref).type.toBe<string>();
		expect(schema.$defs).type.toBe<{ [name: string]: unknown }>();
	});
});
