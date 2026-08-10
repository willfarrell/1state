import type {
	Machine,
	MachineDefinition,
	MachineEvent,
	Route,
	Script,
	Snapshot,
	StateValue,
} from "@1state/core";
import { assign, createMachine, toPath, toValue } from "@1state/core";
import { describe, expect, test } from "tstyche";

interface Answers {
	name: string;
	count: number;
}

// `satisfies` rather than a bare `const`: the header of index.d.ts claims one is
// needed, and this is where that claim gets checked — see "definition literals".
const flow = {
	initial: "idle",
	states: {
		idle: { on: { GO: "busy" } },
		busy: {
			go: [{ target: "done", cond: (context: Answers) => context.count > 0 }],
		},
		done: { type: "final" },
	},
} satisfies MachineDefinition<Answers>;

describe("StateValue", () => {
	test("is a leaf name or a nested record", () => {
		expect<string>().type.toBeAssignableTo<StateValue>();
		expect<{ parent: string }>().type.toBeAssignableTo<StateValue>();
		expect<{
			region: { a: string; b: string };
		}>().type.toBeAssignableTo<StateValue>();
	});

	test("does not accept a leaf that is not a state name", () => {
		expect<{ parent: number }>().type.not.toBeAssignableTo<StateValue>();
	});
});

describe("MachineEvent", () => {
	test("carries an optional type and the invoke outcomes", () => {
		expect<MachineEvent["type"]>().type.toBe<string | undefined>();
		expect<{ type: "SUBMIT" }>().type.toBeAssignableTo<MachineEvent>();
		expect<{ data: unknown }>().type.toBeAssignableTo<MachineEvent>();
		expect<{ error: unknown }>().type.toBeAssignableTo<MachineEvent>();
	});

	test("takes arbitrary payload keys", () => {
		expect<{
			type: "SUBMIT";
			answer: string;
		}>().type.toBeAssignableTo<MachineEvent>();
	});
});

describe("MachineDefinition", () => {
	test("accepts the four state types and nothing else", () => {
		expect<{ type: "atomic" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "compound" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "parallel" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "final" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ type: "atmoic" }>().type.not.toBeAssignableTo<MachineDefinition>();
	});

	test("takes a bare target or the long form, one or many", () => {
		expect<{ go: "next" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{
			go: { target: "next" };
		}>().type.toBeAssignableTo<MachineDefinition>();
		expect<{
			go: [{ target: "next"; cond: "isReady" }];
		}>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ on: { GO: "next" } }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{ onFinal: "next" }>().type.toBeAssignableTo<MachineDefinition>();
	});

	test("requires a target on the long form", () => {
		expect<{
			go: { cond: "isReady" };
		}>().type.not.toBeAssignableTo<MachineDefinition>();
	});

	test("requires both invoke branches", () => {
		expect<{
			invoke: { src: "load"; onSuccess: "ok"; onError: "bad" };
		}>().type.toBeAssignableTo<MachineDefinition>();
		expect<{
			invoke: { src: "load"; onSuccess: "ok" };
		}>().type.not.toBeAssignableTo<MachineDefinition>();
	});

	test("initial names a child, with or without actions", () => {
		expect<{ initial: "a" }>().type.toBeAssignableTo<MachineDefinition>();
		expect<{
			initial: { target: "a"; actions: ["track"] };
		}>().type.toBeAssignableTo<MachineDefinition>();
	});
});

describe("definition literals", () => {
	test("a `satisfies` definition is accepted", () => {
		expect(createMachine).type.toBeCallableWith(flow);
	});

	test("`type` widens to string without one", () => {
		const widened = { type: "final" };
		expect(createMachine).type.not.toBeCallableWith(widened);
	});
});

describe("createMachine", () => {
	test("returns a Machine over the inferred context", () => {
		expect(createMachine(flow)).type.toBe<Machine<Answers>>();
	});

	test("infers Context from definition.context", () => {
		const machine = createMachine({ ...flow, context: { name: "", count: 0 } });
		expect(machine.state().context).type.toBe<{
			name: string;
			count: number;
		}>();
	});

	test("infers Context from options.context when the definition has none", () => {
		const machine = createMachine(
			{ initial: "idle", states: { idle: {} } },
			{ context: { name: "", count: 0 } },
		);
		expect(machine.state().context).type.toBe<{
			name: string;
			count: number;
		}>();
	});

	test("takes an explicit type parameter", () => {
		expect(createMachine<Answers>(flow)).type.toBe<Machine<Answers>>();
	});

	test("options.context is a partial of the context", () => {
		expect(createMachine<Answers>).type.toBeCallableWith(flow, {
			context: { count: 1 },
		});
	});

	test("options.state takes a value read off a snapshot", () => {
		expect(createMachine<Answers>).type.toBeCallableWith(flow, {
			state: { parent: "child" },
		});
	});

	test("rejects an unknown option", () => {
		expect(createMachine<Answers>).type.not.toBeCallableWith(flow, {
			onTransitions: () => {},
		});
	});
});

describe("Machine", () => {
	const machine = createMachine(flow);

	test("start, send and back all resolve to a snapshot", () => {
		expect(machine.start()).type.toBe<Promise<Snapshot<Answers>>>();
		expect(machine.start({ type: "BOOT" })).type.toBe<
			Promise<Snapshot<Answers>>
		>();
		expect(machine.send("GO")).type.toBe<Promise<Snapshot<Answers>>>();
		expect(machine.send("GO", { answer: 1 })).type.toBe<
			Promise<Snapshot<Answers>>
		>();
		expect(machine.back()).type.toBe<Promise<Snapshot<Answers>>>();
	});

	test("send needs an event type", () => {
		expect(machine.send).type.not.toBeCallableWith();
	});

	test("path is the trail as dotted node ids", () => {
		expect(machine.path()).type.toBe<Promise<string[]>>();
	});

	test("route answers off url segments", () => {
		expect(machine.route()).type.toBe<Promise<Route>>();
		expect(machine.route(["account", "name"])).type.toBe<Promise<Route>>();
	});

	test("state is synchronous", () => {
		expect(machine.state()).type.toBe<Snapshot<Answers>>();
	});
});

describe("Snapshot", () => {
	test("reports value, context and done", () => {
		expect<Snapshot<Answers>>().type.toBe<{
			value: StateValue;
			context: Answers;
			done: boolean;
		}>();
	});
});

describe("Route", () => {
	test("nullable segments both ways", () => {
		expect<Route>().type.toBe<{
			target: string[] | null;
			prev: string[] | null;
		}>();
	});
});

describe("assign", () => {
	test("returns an action", () => {
		expect(assign({ count: 1 })).type.toBeAssignableTo<Script<Answers>>();
		expect(assign<Answers>({ count: 1 })).type.toBe<Script<Answers>>();
	});

	test("takes a static value or a function of (context, event)", () => {
		expect(assign).type.toBeCallableWith({ name: "a" });
		expect(assign).type.toBeCallableWith({ count: 1 });
		expect(assign).type.toBeCallableWith({ ok: true });
		expect(assign).type.toBeCallableWith({ nothing: null });
		expect(assign).type.toBeCallableWith({ absent: undefined });
		expect(assign).type.toBeCallableWith({ nested: { a: 1 } });
		expect(assign<Answers>).type.toBeCallableWith({
			count: (context: Answers) => context.count + 1,
		});
	});
});

describe("toPath / toValue", () => {
	test("a value becomes url segments and back", () => {
		expect(toPath("idle")).type.toBe<string[]>();
		expect(toPath({ one: { a: "x" } })).type.toBe<string[]>();
		expect(toValue(["one", "a", "x"])).type.toBe<StateValue>();
	});

	test("toPath will not take segments", () => {
		expect(toPath).type.not.toBeCallableWith(["one", "a"]);
	});
});
