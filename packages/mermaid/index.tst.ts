import type { MachineDefinition as CoreDefinition } from "@1state/core";
import type {
	MachineDefinition,
	MermaidOptions,
	Script,
	ScriptList,
	ScriptRef,
	Transitions,
} from "@1state/mermaid";
import mermaid from "@1state/mermaid";
import { describe, expect, test } from "tstyche";

const flow = {
	initial: "idle",
	states: {
		idle: { on: { GO: "busy" } },
		busy: { go: [{ target: "done", cond: "isReady" }] },
		done: { type: "final" },
	},
} satisfies MachineDefinition;

describe("mermaid", () => {
	test("renders a definition to a fenced diagram", () => {
		expect(mermaid(flow)).type.toBe<string>();
	});

	test("takes an optional title", () => {
		expect(mermaid(flow, { title: "Onboarding" })).type.toBe<string>();
		expect(mermaid(flow, {})).type.toBe<string>();
	});

	test("needs a definition", () => {
		expect(mermaid).type.not.toBeCallableWith();
	});

	test("rejects an unknown option", () => {
		expect(mermaid).type.not.toBeCallableWith(flow, { heading: "Onboarding" });
	});
});

describe("MermaidOptions", () => {
	test("title is the only key, and optional", () => {
		expect<MermaidOptions>().type.toBe<{ title?: string }>();
	});
});

// The header of index.d.ts says the definition shape is restated here rather
// than imported, and that a core definition "passes straight in". Nothing else
// checks that, and the two files drift independently.
describe("compatibility with @1state/core", () => {
	test("a core definition is a mermaid definition", () => {
		expect<CoreDefinition>().type.toBeAssignableTo<MachineDefinition>();
	});

	test("and back the other way", () => {
		expect<MachineDefinition>().type.toBeAssignableTo<CoreDefinition>();
	});
});

describe("MachineDefinition", () => {
	test("accepts the four state types", () => {
		expect<{ type: "atomic" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "compound" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "parallel" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "final" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "finl" }>().type.not.toBeAssignableTo<MachineDefinition>();
	});

	test("nests", () => {
		expect<{
			initial: "a";
			states: { a: { states: { b: {} } } };
		}>().type.toBeAssignableTo<MachineDefinition>();
	});

	test("draws both invoke branches", () => {
		expect<{
			invoke: { src: "load"; onSuccess: "ok"; onError: "bad" };
		}>().type.toBeAssignableTo<MachineDefinition>();
	});
});

describe("Transitions", () => {
	test("one bare target, one long form, or a list of either", () => {
		expect<"next">().type.toBeAssignableTo<Transitions>();
		expect<{ target: "next" }>().type.toBeAssignableTo<Transitions>();
		expect<
			readonly ["next", { target: "other"; cond: "isReady" }]
		>().type.toBeAssignableTo<Transitions>();
	});
});

describe("Script", () => {
	test("a script or the name of one — the name is the edge label", () => {
		expect<Script>().type.toBeAssignableTo<ScriptRef>();
		expect<string>().type.toBeAssignableTo<ScriptRef>();
		expect<ScriptRef>().type.toBeAssignableTo<ScriptList>();
		expect<readonly ScriptRef[]>().type.toBeAssignableTo<ScriptList>();
	});
});
