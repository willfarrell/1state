import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assign, createMachine, toPath, toValue } from "./index.js";

const start = async (definition, options) => {
	const machine = createMachine(definition, options);
	return [machine, await machine.start()];
};

describe("compile", () => {
	it("infers atomic, compound and final types", async () => {
		const [, state] = await start({
			initial: "idle",
			states: { idle: { on: { go: "done" } }, done: { type: "final" } },
		});
		assert.equal(state.value, "idle");
	});

	it("accepts initial as a string or as a transition with actions", async () => {
		const seen = [];
		const [, state] = await start({
			initial: { target: "idle", actions: () => seen.push("initial") },
			states: { idle: {} },
		});
		assert.deepEqual(seen, ["initial"]);
		assert.equal(state.value, "idle");
	});

	it("resolves targets outward through ancestors", async () => {
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					initial: "inner",
					states: { inner: { on: { out: "sibling" } } },
				},
				sibling: {},
			},
		});
		assert.deepEqual((await machine.send("out")).value, "sibling");
	});

	it("resolves dotted targets into a nested machine", async () => {
		const [machine] = await start({
			initial: "a",
			states: {
				a: { on: { deep: "outer.inner.deep" } },
				outer: {
					onEntry: () => {},
					initial: "inner",
					states: {
						inner: { initial: "shallow", states: { shallow: {}, deep: {} } },
					},
				},
			},
		});
		assert.deepEqual((await machine.send("deep")).value, {
			outer: { inner: "deep" },
		});
	});

	it("resolves scripts by name from the registry", async () => {
		const [, state] = await start(
			{ initial: "a", states: { a: { onEntry: "touch" } } },
			{ scripts: { touch: (context) => (context.touched = true) } },
		);
		assert.equal(state.context.touched, true);
	});

	// Every plain object inherits callables, so a bare `scripts[ref]` lookup would
	// accept a name nobody registered and silently run Object.prototype's.
	it("rejects a script name inherited from Object.prototype", () => {
		assert.throws(
			() =>
				createMachine(
					{ initial: "a", states: { a: { onEntry: "toString" } } },
					{ scripts: {} },
				),
			/script "toString" is not a function/,
		);
	});

	it("rejects a script name with no registry entry", () => {
		assert.throws(
			() => createMachine({ initial: "a", states: { a: { onEntry: "nope" } } }),
			/script "nope" is not a function/,
		);
	});

	it("rejects an unresolvable transition target", () => {
		assert.throws(
			() =>
				createMachine({ initial: "a", states: { a: { on: { x: "gone" } } } }),
			/target "gone" not found/,
		);
	});

	it("names the root when a root transition is unresolvable", () => {
		assert.throws(
			() =>
				createMachine({ initial: "a", on: { x: "gone" }, states: { a: {} } }),
			/target "gone" not found from "\(root\)"/,
		);
	});

	it("rejects an unresolvable initial target", () => {
		assert.throws(
			() => createMachine({ initial: "gone", states: { a: {} } }),
			/state "gone" not found under "\(root\)"/,
		);
	});

	// Entering drops straight to the state named, while a transition walks in
	// through every ancestor — so a descendant initial reports a value whose
	// intermediate entry actions never ran.
	it("rejects an initial naming a descendant rather than a direct child", () => {
		assert.throws(
			() =>
				createMachine({
					initial: "outer",
					states: {
						outer: {
							initial: "inner.deep",
							states: { inner: { initial: "deep", states: { deep: {} } } },
						},
					},
				}),
			/initial "inner\.deep" on "outer" must name a direct child/,
		);
	});

	it("rejects child states with no initial", () => {
		assert.throws(
			() => createMachine({ states: { a: {} } }),
			/"\(root\)" has child states but no initial/,
		);
	});

	it("rejects a parallel state with no regions", () => {
		assert.throws(
			() => createMachine({ type: "parallel" }),
			/parallel state "\(root\)" has no regions/,
		);
	});
});

describe("transitions", () => {
	it("ignores an event no active state handles", async () => {
		const [machine] = await start({
			initial: "a",
			states: { a: { on: { known: "b" } }, b: {} },
		});
		assert.equal((await machine.send("unknown")).value, "a");
	});

	it("refuses to send before start", async () => {
		const machine = createMachine({ initial: "a", states: { a: {} } });
		await assert.rejects(
			() => machine.send("x"),
			/call start\(\) before send\(\)/,
		);
	});

	it("is idempotent on repeated start", async () => {
		const entries = [];
		const [machine] = await start({
			initial: "a",
			states: { a: { onEntry: () => entries.push("a") } },
		});
		await machine.start();
		assert.deepEqual(entries, ["a"]);
	});

	it("picks the first transition whose cond passes", async () => {
		const [machine] = await start({
			context: { n: 2 },
			initial: "a",
			states: {
				a: {
					on: {
						go: [
							{ target: "low", cond: (ctx) => ctx.n < 2 },
							{ target: "high", cond: (ctx) => ctx.n >= 2 },
							{ target: "fallback" },
						],
					},
				},
				low: {},
				high: {},
				fallback: {},
			},
		});
		assert.equal((await machine.send("go")).value, "high");
	});

	it("waits for a cond that answers asynchronously", async () => {
		const [machine] = await start({
			initial: "a",
			states: {
				a: {
					on: {
						go: [
							{ target: "no", cond: async () => false },
							{ target: "yes", cond: async () => true },
						],
					},
				},
				no: {},
				yes: {},
			},
		});
		assert.equal((await machine.send("go")).value, "yes");
	});

	// `cond: (ctx) => ctx.ready` is how most guards are written, and an answer
	// nobody has given yet is undefined rather than false — reading it for
	// truthiness has to survive that, not just report it as a no.
	it("reads a cond that answers with nothing as a no", async () => {
		const [machine] = await start({
			initial: "a",
			states: {
				a: {
					on: {
						go: [{ target: "b", cond: (ctx) => ctx.ready }, { target: "c" }],
					},
				},
				b: {},
				c: {},
			},
		});
		assert.equal((await machine.send("go")).value, "c");
	});

	it("stays put when no cond passes", async () => {
		const [machine] = await start({
			initial: "a",
			states: {
				a: { on: { go: [{ target: "b", cond: () => false }] } },
				b: {},
			},
		});
		assert.equal((await machine.send("go")).value, "a");
	});

	it("bubbles an unhandled event to an ancestor", async () => {
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					initial: "inner",
					on: { reset: "done" },
					states: { inner: { on: { other: "inner" } } },
				},
				done: {},
			},
		});
		assert.equal((await machine.send("reset")).value, "done");
	});

	it("handles an event declared on the root", async () => {
		const [machine] = await start({
			initial: "a",
			on: { reset: "a" },
			states: { a: { on: { go: "b" } }, b: {} },
		});
		assert.equal((await machine.send("go")).value, "b");
		assert.equal((await machine.send("reset")).value, "a");
	});

	it("exits and re-enters on a self transition", async () => {
		const log = [];
		const [machine] = await start({
			initial: "a",
			states: {
				a: {
					onEntry: () => log.push("enter"),
					onExit: () => log.push("exit"),
					on: { again: "a" },
				},
			},
		});
		await machine.send("again");
		assert.deepEqual(log, ["enter", "exit", "enter"]);
	});

	// The self transition reaching further: a transition declared on `outer` and
	// aimed inside it is external too, so `outer` is left and re-entered rather
	// than stepped through from where it already is.
	it("exits and re-enters the source when the target is inside it", async () => {
		const log = [];
		const trace = (name) => () => log.push(name);
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					onEntry: trace("enter:outer"),
					onExit: trace("exit:outer"),
					initial: "here",
					on: { in: "outer.there.deep" },
					states: {
						here: {},
						there: {
							onEntry: trace("enter:there"),
							initial: "deep",
							states: { deep: {} },
						},
					},
				},
			},
		});
		log.length = 0;
		const state = await machine.send("in");
		assert.deepEqual(state.value, { outer: { there: "deep" } });
		assert.deepEqual(log, ["exit:outer", "enter:outer", "enter:there"]);
	});

	// And the same the other way: a target that is an ancestor of the state the
	// event was answered from leaves that ancestor before opening it again.
	it("exits and re-enters the target when it is an ancestor of the source", async () => {
		const log = [];
		const trace = (name) => () => log.push(name);
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					onEntry: trace("enter:outer"),
					onExit: trace("exit:outer"),
					initial: "here",
					states: { here: { on: { restart: "outer" } } },
				},
			},
		});
		log.length = 0;
		const state = await machine.send("restart");
		assert.deepEqual(state.value, { outer: "here" });
		assert.deepEqual(log, ["exit:outer", "enter:outer"]);
	});

	// Mirror of the exit rule: entering re-runs every ancestor's entry down from
	// the boundary, and the boundary itself — already active — is left alone.
	it("runs entry actions down from the common ancestor only", async () => {
		const log = [];
		const trace = (name) => () => log.push(name);
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					onEntry: trace("enter:outer"),
					initial: "here",
					states: {
						here: { on: { in: "there.deep" } },
						there: {
							onEntry: trace("enter:there"),
							initial: "deep",
							states: { deep: { onEntry: trace("enter:deep") } },
						},
					},
				},
			},
		});
		log.length = 0;
		await machine.send("in");
		assert.deepEqual(log, ["enter:there", "enter:deep"]);
	});

	it("exits the previous leaf on a transition declared at the root", async () => {
		const log = [];
		const [machine] = await start({
			initial: "a",
			on: { reset: "a" },
			states: {
				a: { on: { go: "b" } },
				b: { onExit: () => log.push("exit:b") },
			},
		});
		await machine.send("go");
		assert.equal((await machine.send("reset")).value, "a");
		assert.deepEqual(log, ["exit:b"]);
	});

	it("runs exit actions up to the common ancestor only", async () => {
		const log = [];
		const trace = (name) => () => log.push(name);
		const [machine] = await start({
			initial: "outer",
			states: {
				outer: {
					onExit: trace("exit:outer"),
					initial: "inner",
					states: {
						inner: { onExit: [trace("exit:inner")], on: { out: "sibling" } },
					},
				},
				sibling: { onEntry: trace("enter:sibling") },
			},
		});
		await machine.send("out");
		assert.deepEqual(log, ["exit:inner", "exit:outer", "enter:sibling"]);
	});

	// Two branches that part company below the root: the walk inward has to stop
	// where they differ, or it reports a boundary only one side is under and the
	// machine it leaves is never exited.
	it("leaves one nested machine and enters another", async () => {
		const log = [];
		const trace = (name) => () => log.push(name);
		const [machine] = await start({
			initial: "x",
			states: {
				x: {
					onExit: trace("exit:x"),
					initial: "a",
					states: { a: { on: { over: "y.b" } } },
				},
				y: { onEntry: trace("enter:y"), initial: "b", states: { b: {} } },
			},
		});
		assert.deepEqual((await machine.send("over")).value, { y: "b" });
		assert.deepEqual(log, ["exit:x", "enter:y"]);
	});
});

describe("context", () => {
	it("merges definition context with options context", async () => {
		const [, state] = await start(
			{ context: { a: 1, b: 1 }, initial: "s", states: { s: {} } },
			{ context: { b: 2 } },
		);
		assert.deepEqual(state.context, { a: 1, b: 2 });
	});

	it("applies assign with static and computed values", async () => {
		const [machine] = await start({
			context: { count: 0 },
			initial: "a",
			states: {
				a: {
					on: {
						bump: {
							target: "a",
							actions: assign({ count: (ctx) => ctx.count + 1, touched: true }),
						},
					},
				},
			},
		});
		const state = await machine.send("bump");
		assert.deepEqual(state.context, { count: 1, touched: true });
	});

	it("reads the event payload in an action", async () => {
		const [machine] = await start({
			initial: "a",
			states: {
				a: {
					on: { set: { target: "a", actions: assign({ v: (_c, e) => e.v }) } },
				},
			},
		});
		assert.equal((await machine.send("set", { v: 7 })).context.v, 7);
	});
});

describe("eventless (go) transitions", () => {
	it("settles forward through go transitions on start", async () => {
		const [, state] = await start({
			initial: "a",
			states: { a: { go: "b" }, b: { go: [{ target: "ctx" }] }, ctx: {} },
		});
		assert.equal(state.value, "ctx");
	});

	it("rests where no guard opens, then advances when context changes", async () => {
		const [machine, first] = await start({
			context: { ready: false },
			initial: "wait",
			states: {
				wait: {
					go: [{ target: "done", cond: (ctx) => ctx.ready }],
					on: { ready: { target: "wait", actions: assign({ ready: true }) } },
				},
				done: {},
			},
		});
		assert.equal(first.value, "wait");
		assert.equal((await machine.send("ready")).value, "done");
	});

	// Every state here has somewhere it could go, the root included, and only the
	// guards decide where the flow stops — a machine that read itself as having
	// no eventless transitions at all would never leave the first step.
	it("settles a machine whose every state declares a go", async () => {
		const shut = [{ target: "a", cond: () => false }];
		const [, state] = await start({
			go: shut,
			initial: "a",
			states: { a: { go: "b" }, b: { go: shut } },
		});
		assert.equal(state.value, "b");
	});

	it("rejects a machine that never settles", async () => {
		const machine = createMachine({
			initial: "a",
			states: { a: { go: "b" }, b: { go: "a" } },
		});
		await assert.rejects(() => machine.start(), /microstep limit reached/);
	});

	// The limit counts microsteps, not states: a flow long enough to spend every
	// one of them is a loop as far as settling can tell, and a flow one hop
	// shorter comes to rest.
	it("spends every microstep it is allowed and no more", async () => {
		const limit = 1000; // MAX_MICROSTEPS, which the module keeps to itself
		const chain = (hops) => ({
			initial: "s0",
			states: Object.fromEntries(
				Array.from({ length: hops + 1 }, (_, i) => [
					`s${i}`,
					i < hops ? { go: `s${i + 1}` } : {},
				]),
			),
		});
		assert.equal((await start(chain(limit - 1)))[1].value, `s${limit - 1}`);
		await assert.rejects(
			() => createMachine(chain(limit)).start(),
			/microstep limit reached/,
		);
	});
});

// The engine runs a guard, an action or an entry synchronously when it answers
// synchronously, and only reaches for a promise when one is actually handed
// back. Every place that can suspend has to pick the walk back up where it left
// it — these are those places, each proving the order survives the wait.
describe("async guards and actions", () => {
	const tick = (log, name) => async () => {
		await Promise.resolve();
		log.push(name);
	};

	// A list that suspends halfway has to pick itself back up: the actions after
	// the one that waited are the rest of the transition, not optional.
	it("runs the rest of an action list after one suspends", async () => {
		const log = [];
		const [machine] = await start({
			initial: "a",
			states: {
				a: {
					on: {
						go: {
							target: "b",
							actions: [tick(log, "first"), () => log.push("second")],
						},
					},
				},
				b: {},
			},
		});
		await machine.send("go");
		assert.deepEqual(log, ["first", "second"]);
	});

	// A hand-off that waits must finish before the machine reports where it is —
	// the state it is moving to has been left but not yet entered.
	it("waits for a hand-off's action before reporting", async () => {
		const [, state] = await start({
			initial: "one",
			states: {
				one: {
					initial: "end",
					onFinal: {
						target: "two",
						actions: async (context) => {
							await new Promise((resolve) => setTimeout(resolve, 0));
							context.handed = true;
						},
					},
					states: { end: { type: "final" } },
				},
				two: {},
			},
		});
		assert.equal(state.value, "two");
		assert.equal(state.context.handed, true);
	});

	it("settles across an async entry, guard and action", async () => {
		const log = [];
		const [machine, state] = await start({
			initial: "a",
			states: {
				a: {
					onEntry: tick(log, "enter:a"),
					go: [
						{ target: "b", cond: async () => true, actions: tick(log, "move") },
					],
				},
				b: { onEntry: tick(log, "enter:b") },
			},
		});
		assert.equal(state.value, "b");
		assert.deepEqual(log, ["enter:a", "move", "enter:b"]);
		// path() replays the same guard, so the trail waits on it too.
		assert.deepEqual(await machine.path(), ["a", "b"]);
	});

	it("waits for an onFinal cond, both settling and on the trail", async () => {
		const log = [];
		const [machine, state] = await start({
			initial: "one",
			states: {
				one: {
					initial: "go",
					onFinal: [
						{
							target: "two",
							cond: async () => true,
							actions: tick(log, "done"),
						},
					],
					states: { go: { go: "end" }, end: { type: "final" } },
				},
				two: {},
			},
		});
		assert.equal(state.value, "two");
		assert.deepEqual(log, ["done"]);
		assert.deepEqual(await machine.path(), ["one.go", "two"]);
	});

	it("enters parallel regions in order across an async entry", async () => {
		const log = [];
		const [, state] = await start({
			initial: "both",
			states: {
				both: {
					type: "parallel",
					states: {
						x: {
							onEntry: tick(log, "x"),
							initial: "a",
							states: { a: {} },
						},
						y: {
							onEntry: () => log.push("y"),
							initial: "b",
							states: { b: {} },
						},
					},
				},
			},
		});
		assert.deepEqual(state.value, { both: { x: "a", y: "b" } });
		assert.deepEqual(log, ["x", "y"]);
	});

	it("resumes back() across an async exit action", async () => {
		const log = [];
		const [machine] = await start({
			context: { answered: true },
			initial: "one",
			states: {
				one: { go: [{ target: "two", cond: (ctx) => ctx.answered }] },
				two: { onExit: tick(log, "exit:two") },
			},
		});
		assert.equal((await machine.back()).value, "one");
		assert.deepEqual(log, ["exit:two"]);
	});
});

describe("invoke", () => {
	it("takes onSuccess and exposes the result as event.data", async () => {
		const [, state] = await start({
			initial: "load",
			states: {
				load: {
					invoke: {
						src: async () => "payload",
						onSuccess: {
							target: "ok",
							actions: assign({ data: (_c, e) => e.data }),
						},
						onError: "fail",
					},
				},
				ok: {},
				fail: {},
			},
		});
		assert.equal(state.value, "ok");
		assert.equal(state.context.data, "payload");
	});

	it("takes onError and exposes the cause as event.error", async () => {
		const [, state] = await start({
			initial: "load",
			states: {
				load: {
					invoke: {
						src: () => {
							throw new Error("boom");
						},
						onSuccess: "ok",
						onError: {
							target: "fail",
							actions: assign({ why: (_c, e) => e.error.message }),
						},
					},
				},
				ok: {},
				fail: {},
			},
		});
		assert.equal(state.value, "fail");
		assert.equal(state.context.why, "boom");
	});

	it("keeps settling after the invoke resolves", async () => {
		const [, state] = await start({
			initial: "load",
			states: {
				load: {
					invoke: {
						src: async () => 1,
						onSuccess: {
							target: "ok",
							actions: assign({ n: (_c, e) => e.data }),
						},
						onError: "fail",
					},
				},
				ok: { go: [{ target: "settled", cond: (ctx) => ctx.n === 1 }] },
				settled: {},
				fail: {},
			},
		});
		assert.equal(state.value, "settled");
	});

	it("carries the triggering event through to the invoke's handlers", async () => {
		const [machine] = await start({
			initial: "idle",
			states: {
				idle: { on: { fetch: "load" } },
				load: {
					invoke: {
						src: () => "payload",
						onSuccess: {
							target: "ok",
							actions: assign({ via: (_c, e) => e.type }),
						},
						onError: "ok",
					},
				},
				ok: {},
			},
		});
		assert.equal((await machine.send("fetch")).context.via, "fetch");
	});

	// A machine of nothing but invokes has to reach the same limit a loop of `go`
	// transitions does. The root declares one as well: it is a node like any
	// other, so nothing here is left over to say the machine has somewhere to go.
	it("rejects a machine whose invokes never settle", async () => {
		const src = () => "x";
		const machine = createMachine({
			invoke: { src, onSuccess: "a", onError: "a" },
			initial: "a",
			states: {
				a: { invoke: { src, onSuccess: "b", onError: "b" } },
				b: { invoke: { src, onSuccess: "a", onError: "a" } },
			},
		});
		await assert.rejects(() => machine.start(), /microstep limit reached/);
	});

	it("rejects when no onSuccess transition matches", async () => {
		const machine = createMachine({
			initial: "load",
			states: {
				load: {
					invoke: {
						src: () => "x",
						onSuccess: [{ target: "ok", cond: () => false }],
						onError: "ok",
					},
				},
				ok: {},
			},
		});
		await assert.rejects(
			() => machine.start(),
			/no onSuccess transition matched/,
		);
	});

	it("rejects when no onError transition matches", async () => {
		const machine = createMachine({
			initial: "load",
			states: {
				load: {
					invoke: {
						src: () => {
							throw new Error("boom");
						},
						onSuccess: "ok",
						onError: [{ target: "ok", cond: () => false }],
					},
				},
				ok: {},
			},
		});
		await assert.rejects(
			() => machine.start(),
			/no onError transition matched/,
		);
	});
});

describe("final states", () => {
	it("marks the machine done at the root", async () => {
		const [, state] = await start({
			initial: "end",
			states: { end: { type: "final" } },
		});
		assert.deepEqual(state, { value: "end", context: {}, done: true });
	});

	// A definition with no states of its own is a single state — the root — which
	// is the one node no key ever names, so the value it reports is the empty one.
	it("marks a machine that is nothing but a final root done", async () => {
		const [, state] = await start({ type: "final" });
		assert.deepEqual(state, { value: "", context: {}, done: true });
	});

	it("follows onFinal out of a nested machine", async () => {
		const [, state] = await start({
			initial: "onboard",
			states: {
				onboard: {
					initial: "step",
					onFinal: "draft",
					states: { step: { go: "done" }, done: { type: "final" } },
				},
				draft: {},
			},
		});
		assert.equal(state.value, "draft");
	});

	it("picks the first onFinal branch whose cond passes", async () => {
		const definition = {
			initial: "flow",
			states: {
				flow: {
					initial: "step",
					onFinal: [
						{ target: "gated", cond: (ctx) => ctx.open },
						{ target: "after" },
					],
					states: { step: { go: "end" }, end: { type: "final" } },
				},
				gated: {},
				after: {},
			},
		};
		assert.equal(
			(await start(definition, { context: { open: true } }))[1].value,
			"gated",
		);
		assert.equal(
			(await start(definition, { context: { open: false } }))[1].value,
			"after",
		);
	});

	it("rests inside a finished machine when no onFinal cond passes", async () => {
		const [, state] = await start({
			initial: "flow",
			states: {
				flow: {
					initial: "step",
					onFinal: [{ target: "after", cond: () => false }],
					states: { step: { go: "end" }, end: { type: "final" } },
				},
				after: {},
			},
		});
		assert.deepEqual(state.value, { flow: "end" });
	});

	// A state that declares itself atomic is a leaf whatever it holds: entering it
	// stops there rather than opening a child, so nothing underneath it can finish
	// the machine — not even a final that a transition reached into directly.
	it("is not done through a state that declares itself atomic", async () => {
		const [machine] = await start({
			initial: "step",
			on: { skip: "step.done" },
			states: { step: { type: "atomic", states: { done: { type: "final" } } } },
		});
		assert.equal((await machine.send("skip")).done, false);
	});

	it("walks past an ancestor with no onFinal", async () => {
		const [, state] = await start({
			initial: "outer",
			states: {
				outer: {
					initial: "inner",
					onFinal: { target: "after" },
					states: {
						inner: {
							initial: "step",
							states: { step: { go: "done" }, done: { type: "final" } },
						},
					},
				},
				after: {},
			},
		});
		assert.equal(state.value, "after");
	});
});

describe("parallel states", () => {
	const definition = {
		initial: "draft",
		states: {
			draft: {
				type: "parallel",
				onExit: () => {},
				on: { abandon: "cancelled" },
				states: {
					locales: {
						initial: "editing",
						states: {
							editing: { on: { saveLocales: "saved" } },
							saved: { type: "final" },
						},
					},
					name: {
						initial: "editing",
						states: {
							editing: { on: { saveName: "saved" } },
							saved: { type: "final" },
						},
					},
				},
				onFinal: "published",
			},
			published: {},
			cancelled: {},
		},
	};

	it("activates every region at once", async () => {
		const [, state] = await start(definition);
		assert.deepEqual(state.value, {
			draft: { locales: "editing", name: "editing" },
		});
	});

	it("advances regions independently", async () => {
		const [machine] = await start(definition);
		const state = await machine.send("saveLocales");
		assert.deepEqual(state.value, {
			draft: { locales: "saved", name: "editing" },
		});
		assert.equal(state.done, false);
	});

	it("takes onFinal only once every region is final", async () => {
		const [machine] = await start(definition);
		await machine.send("saveLocales");
		assert.equal((await machine.send("saveName")).value, "published");
	});

	it("runs each shared ancestor's exit action once when leaving", async () => {
		const exits = [];
		const [machine] = await start({
			...definition,
			states: {
				...definition.states,
				draft: {
					...definition.states.draft,
					onExit: () => exits.push("draft"),
				},
			},
		});
		await machine.send("abandon");
		assert.deepEqual(exits, ["draft"]);
	});

	// Both regions answer `stop`, but the first one processed leaves the parallel
	// state entirely — the second region's transition must not still fire.
	it("skips a region whose transition another region already invalidated", async () => {
		const [machine] = await start({
			initial: "both",
			states: {
				both: {
					type: "parallel",
					states: {
						left: {
							initial: "on",
							states: { on: { on: { stop: "halted" } }, off: {} },
						},
						right: {
							initial: "on",
							states: { on: { on: { stop: "off" } }, off: {} },
						},
					},
				},
				halted: {},
			},
		});
		assert.equal((await machine.send("stop")).value, "halted");
	});

	// The shape datastream/datastreamDatasetSchema.json uses: regions that are
	// themselves atomic, so each reports its own key.
	it("reports atomic regions by their own key", async () => {
		const [, state] = await start({
			initial: "draft",
			states: {
				draft: {
					type: "parallel",
					states: { locales: {}, name: {}, datafile: {} },
				},
			},
		});
		assert.deepEqual(state.value, {
			draft: { locales: "locales", name: "name", datafile: "datafile" },
		});
	});
});

describe("state snapshot and restore", () => {
	it("reports an empty value before start", () => {
		const machine = createMachine({ initial: "a", states: { a: {} } });
		assert.deepEqual(machine.state(), {
			value: undefined,
			context: {},
			done: false,
		});
	});

	it("restores a flat stored value without re-running entry actions", async () => {
		const entries = [];
		const [, state] = await start(
			{
				initial: "a",
				states: { a: {}, b: { onEntry: () => entries.push("b") } },
			},
			{ state: "b" },
		);
		assert.equal(state.value, "b");
		assert.deepEqual(entries, []);
	});

	// A stored string names the child and says nothing about what is under it, so
	// that child opens at its own initial. Steps keyed by number are where reading
	// the name as though it were a shape would show: "0" is an index into "0".
	it("opens the named child at its initial, whatever the name indexes", async () => {
		const [, state] = await start(
			{ initial: "0", states: { 0: { initial: "a", states: { a: {} } } } },
			{ state: "0" },
		);
		assert.deepEqual(state.value, { 0: "a" });
	});

	it("restores a nested stored value", async () => {
		const [, state] = await start(
			{
				initial: "outer",
				states: { outer: { initial: "one", states: { one: {}, two: {} } } },
			},
			{ state: { outer: "two" } },
		);
		assert.deepEqual(state.value, { outer: "two" });
	});

	it("restores every region of a parallel value", async () => {
		const [, state] = await start(
			{
				initial: "both",
				states: {
					both: {
						type: "parallel",
						states: {
							left: { initial: "a", states: { a: {}, b: {} } },
							right: { initial: "a", states: { a: {}, b: {} } },
						},
					},
				},
			},
			{ state: { both: { left: "b", right: "a" } } },
		);
		assert.deepEqual(state.value, { both: { left: "b", right: "a" } });
	});

	// Forward migration: a record written before `right` existed has to resume, so
	// a region the stored value says nothing about opens where it would have if
	// nothing had been stored at all.
	it("opens a region the stored value never mentions at its own initial", async () => {
		const [, state] = await start(
			{
				initial: "both",
				states: {
					both: {
						type: "parallel",
						states: {
							left: { initial: "a", states: { a: {}, b: {} } },
							right: { initial: "a", states: { a: {}, b: {} } },
						},
					},
				},
			},
			{ state: { both: { left: "b" } } },
		);
		assert.deepEqual(state.value, { both: { left: "b", right: "a" } });
	});

	// Written when `both` was an ordinary state, so the record names it and either
	// stops or carries a shape no parallel state can wear. Neither describes the
	// regions, so all of them open at their own initial.
	it("opens every region when the stored value stops short of the parallel state", async () => {
		const definition = {
			initial: "both",
			states: {
				both: {
					type: "parallel",
					states: {
						left: { initial: "a", states: { a: {}, b: {} } },
						right: { initial: "a", states: { a: {}, b: {} } },
					},
				},
			},
		};
		const fresh = { both: { left: "a", right: "a" } };
		assert.deepEqual(
			(await start(definition, { state: "both" }))[1].value,
			fresh,
		);
		assert.deepEqual(
			(await start(definition, { state: { both: "left" } }))[1].value,
			fresh,
		);
	});

	it("rejects a stored value naming an unknown state", async () => {
		const machine = createMachine(
			{ initial: "a", states: { a: {} } },
			{ state: "ghost" },
		);
		await assert.rejects(() => machine.start(), /unknown state "ghost"/);
	});
});

describe("options hooks", () => {
	it("reports sends, transitions, context changes and completion", async () => {
		const log = [];
		const [machine] = await start(
			{
				initial: "a",
				states: {
					a: { on: { go: { target: "end", actions: assign({ v: 1 }) } } },
					end: { type: "final" },
				},
			},
			{
				onSend: (event) => log.push(["send", event.type]),
				onTransition: (state) => log.push(["transition", state.value]),
				onChange: (context) => log.push(["change", context.v]),
				onFinal: (state) => log.push(["final", state.value]),
			},
		);
		await machine.send("go");
		assert.deepEqual(log, [
			["transition", "a"],
			["send", "go"],
			["change", 1],
			["transition", "end"],
			["final", "end"],
		]);
	});

	it("reports completion for a machine that starts already final", async () => {
		const seen = [];
		await start(
			{ initial: "end", states: { end: { type: "final" } } },
			{ onFinal: (state) => seen.push(state.value) },
		);
		assert.deepEqual(seen, ["end"]);
	});

	// onChange means "the context moved", so a transition that carries no actions
	// must not raise it — a listener that persists on every change would otherwise
	// write on plain navigation.
	it("stays quiet on a transition with no actions", async () => {
		const log = [];
		const [machine] = await start(
			{ initial: "a", states: { a: { on: { go: "b" } }, b: {} } },
			{ onChange: () => log.push("change") },
		);
		await machine.send("go");
		assert.deepEqual(log, []);
	});

	it("runs without any hooks configured", async () => {
		const [machine] = await start({
			initial: "a",
			states: { a: { on: { go: { target: "b", actions: () => {} } } }, b: {} },
		});
		assert.equal((await machine.send("go")).value, "b");
	});
});

// The form-wizard case these machines exist for: a flow that knows the next
// question to ask and, for the Back button, which question preceded it — with
// conditional steps skipped in both directions. Modelled on the datastreamapp
// dataset onboarding and the tardisec onboard wizard, where `prev` is replayed
// from current answers rather than popped off a history stack, so changing an
// answer changes where Back goes.
describe("form flow", () => {
	const wizard = {
		context: {},
		initial: "name",
		states: {
			name: {
				on: { answer: { target: "name", actions: "patch" } },
				go: [{ target: "abstract", cond: (ctx) => ctx.name != null }],
			},
			abstract: {
				on: { answer: { target: "abstract", actions: "patch" } },
				go: [
					{
						target: "keywords",
						cond: (ctx) => ctx.abstract != null && ctx.keywordsRequired,
					},
					{ target: "licence", cond: (ctx) => ctx.abstract != null },
				],
			},
			keywords: {
				on: { answer: { target: "keywords", actions: "patch" } },
				go: [{ target: "licence", cond: (ctx) => ctx.keywords != null }],
			},
			licence: {
				on: { answer: { target: "licence", actions: "patch" } },
				go: [
					{ target: "licenceUrl", cond: (ctx) => ctx.licence === "OGL" },
					{ target: "review", cond: (ctx) => ctx.licence != null },
				],
			},
			licenceUrl: {
				on: { answer: { target: "licenceUrl", actions: "patch" } },
				go: [{ target: "review", cond: (ctx) => ctx.licenceUrl != null }],
			},
			review: { type: "final" },
		},
	};

	const scripts = {
		patch: (context, event) => Object.assign(context, event.patch),
	};
	const answer = (machine, patch) => machine.send("answer", { patch });

	it("opens on the first unanswered question", async () => {
		const [, state] = await start(wizard, { scripts });
		assert.equal(state.value, "name");
	});

	it("advances to the next question as answers arrive", async () => {
		const [machine] = await start(wizard, { scripts });
		assert.equal(
			(await answer(machine, { name: "Water quality" })).value,
			"abstract",
		);
	});

	it("skips a question its guard rules out", async () => {
		const [machine] = await start(wizard, { scripts });
		await answer(machine, { name: "Water quality" });
		const state = await answer(machine, {
			abstract: "...",
			keywordsRequired: false,
		});
		assert.equal(state.value, "licence");
	});

	it("resumes at the first gap when several answers land at once", async () => {
		const [machine] = await start(wizard, {
			scripts,
			context: {
				name: "Water quality",
				abstract: "...",
				keywordsRequired: true,
			},
		});
		assert.equal(machine.state().value, "keywords");
	});

	it("reports the trail it took, skips excluded", async () => {
		const [machine] = await start(wizard, { scripts });
		await answer(machine, { name: "Water quality" });
		await answer(machine, { abstract: "...", keywordsRequired: false });
		assert.deepEqual(await machine.path(), ["name", "abstract", "licence"]);
	});

	it("goes back over a skipped question", async () => {
		const seen = [];
		const [machine] = await start(wizard, {
			scripts,
			onTransition: (state) => seen.push(state.value),
		});
		await answer(machine, { name: "Water quality" });
		await answer(machine, { abstract: "...", keywordsRequired: false });
		assert.equal((await machine.back()).value, "abstract");
		assert.equal((await machine.back()).value, "name");
		assert.deepEqual(seen, ["name", "abstract", "licence", "abstract", "name"]);
	});

	it("stays put going back from the first question", async () => {
		const [machine] = await start(wizard, { scripts });
		assert.equal((await machine.back()).value, "name");
	});

	it("re-routes Back when an earlier answer changes", async () => {
		const [machine] = await start(wizard, {
			scripts,
			context: {
				name: "Water quality",
				abstract: "...",
				keywordsRequired: false,
			},
		});
		assert.equal(machine.state().value, "licence");
		assert.deepEqual(await machine.path(), ["name", "abstract", "licence"]);

		// The user goes back and now says keywords ARE required: Back from licence
		// must land on keywords, which was skipped a moment ago.
		await machine.back();
		await answer(machine, { keywordsRequired: true });
		assert.equal(machine.state().value, "keywords");

		await answer(machine, { keywords: ["water"] });
		assert.equal(machine.state().value, "licence");
		assert.deepEqual(await machine.path(), [
			"name",
			"abstract",
			"keywords",
			"licence",
		]);
		assert.equal((await machine.back()).value, "keywords");
	});

	it("does not bounce forward after going back", async () => {
		const [machine] = await start(wizard, { scripts });
		await answer(machine, { name: "Water quality" });
		await answer(machine, { abstract: "...", keywordsRequired: false });
		await machine.back();
		assert.equal(machine.state().value, "abstract");
	});

	it("runs the conditional branch to completion", async () => {
		const [machine] = await start(wizard, { scripts });
		await answer(machine, { name: "Water quality" });
		await answer(machine, { abstract: "...", keywordsRequired: false });
		assert.equal(
			(await answer(machine, { licence: "OGL" })).value,
			"licenceUrl",
		);
		const state = await answer(machine, { licenceUrl: "https://example.org" });
		assert.equal(state.value, "review");
		assert.equal(state.done, true);
	});

	// Composed flows (see examples/onboard.test.js): each section is its own machine
	// and hands off through onFinal, so the trail has to step over the boundary —
	// and over the `final` marker itself, which is no page the user ever saw.
	const section = (key) => ({
		initial: key,
		states: {
			[key]: {
				on: { answer: { target: key, actions: "patch" } },
				go: [{ target: "done", cond: (ctx) => ctx[key] != null }],
			},
			done: { type: "final" },
		},
	});

	it("walks the trail across a nested machine's hand-off", async () => {
		const [machine] = await start(
			{
				initial: "one",
				states: {
					one: { ...section("a"), onFinal: "two" },
					two: section("b"),
				},
			},
			{ scripts },
		);
		await answer(machine, { a: 1 });
		assert.deepEqual(machine.state().value, { two: "b" });
		assert.deepEqual(await machine.path(), ["one.a", "two.b"]);
		assert.deepEqual((await machine.back()).value, { one: "a" });
	});

	it("keeps the final it rests on, with no hand-off to follow", async () => {
		const [machine] = await start(
			{ initial: "one", states: { one: section("a") } },
			{ scripts },
		);
		await answer(machine, { a: 1 });
		assert.deepEqual(await machine.path(), ["one.a", "one.done"]);
		assert.deepEqual((await machine.back()).value, { one: "a" });
	});

	// Only a `final` hands off through onFinal. A step that has simply run out of
	// open guards is a dead end, even when the machine around it has somewhere to
	// go — otherwise the trail would jump the gap and report steps never taken.
	it("does not follow a hand-off from a step that merely stalled", async () => {
		const [machine] = await start(
			{
				initial: "one",
				states: {
					one: {
						initial: "a",
						onFinal: "two",
						states: {
							a: { go: [{ target: "done", cond: (ctx) => ctx.a != null }] },
							done: { type: "final" },
						},
					},
					two: section("b"),
				},
			},
			{ scripts, state: { two: "b" } },
		);
		assert.deepEqual(await machine.path(), ["two.b"]);
	});

	it("gives up on a trail that dead-ends on a finished machine", async () => {
		const [machine] = await start(
			{
				initial: "one",
				states: { one: section("a"), elsewhere: {} },
				context: { a: 1 },
			},
			{ scripts, state: "elsewhere" },
		);
		assert.deepEqual(await machine.path(), ["elsewhere"]);
	});

	// A hand-off is conditional like any other transition. When its guard is shut
	// the finished machine hands off to nothing, so the trail stops there rather
	// than following an edge the flow would not take.
	it("gives up on a trail whose hand-off guard is shut", async () => {
		const [machine] = await start(
			{
				initial: "one",
				states: {
					one: {
						...section("a"),
						onFinal: [{ target: "elsewhere", cond: () => false }],
					},
					elsewhere: {},
				},
				context: { a: 1 },
			},
			{ scripts, state: "elsewhere" },
		);
		assert.deepEqual(await machine.path(), ["elsewhere"]);
	});

	it("gives up on a trail that cannot be replayed", async () => {
		const [machine] = await start(
			{
				initial: "a",
				states: {
					a: { go: [{ target: "b", cond: () => false }] },
					b: {},
					ctx: {},
				},
			},
			{ state: "ctx" },
		);
		assert.deepEqual(await machine.path(), ["ctx"]);
		assert.equal((await machine.back()).value, "ctx");
	});

	it("gives up on a trail that dead-ends before the current state", async () => {
		const [machine] = await start(
			{ initial: "a", states: { a: { go: "b" }, b: {}, ctx: {} } },
			{ state: "ctx" },
		);
		assert.deepEqual(await machine.path(), ["ctx"]);
	});

	it("gives up on a trail that loops", async () => {
		const [machine] = await start(
			{
				initial: "a",
				states: { a: { go: "b" }, b: { go: "a" }, ctx: {} },
			},
			{ state: "ctx" },
		);
		assert.deepEqual(await machine.path(), ["ctx"]);
	});
});

// A flow's URL needs no route table: the node id IS the path, so the same
// definition that decides the next question also decides the next address.
describe("urls", () => {
	const flow = {
		initial: "one",
		states: {
			one: {
				initial: "a",
				onFinal: "two",
				states: {
					a: {
						on: { answer: { target: "a", actions: "patch" } },
						go: [{ target: "done", cond: (ctx) => ctx.a != null }],
					},
					done: { type: "final" },
				},
			},
			two: { initial: "b", states: { b: {} } },
		},
	};
	const scripts = {
		patch: (context, event) => Object.assign(context, event.patch),
	};

	it("maps a state value to segments and back", () => {
		assert.deepEqual(toPath({ one: { a: "x" } }), ["one", "a", "x"]);
		assert.deepEqual(toPath("done"), ["done"]);
		assert.deepEqual(toValue(["one", "a", "x"]), { one: { a: "x" } });
		assert.equal(toValue(["done"]), "done");
	});

	it("allows the current step and hands back its predecessor", async () => {
		const [machine] = await start(flow, { scripts });
		await machine.send("answer", { patch: { a: 1 } });
		assert.deepEqual(toPath(machine.state().value), ["two", "b"]);
		assert.deepEqual(await machine.route(["two", "b"]), {
			target: null,
			prev: ["one", "a"],
		});
	});

	it("allows an earlier step, with the link before THAT one", async () => {
		const [machine] = await start(flow, { scripts });
		await machine.send("answer", { patch: { a: 1 } });
		assert.deepEqual(await machine.route(["one", "a"]), {
			target: null,
			prev: null, // first step — render no Back link
		});
	});

	// A flow of one step is the root itself, which names no segment: its address
	// is the root url, so asking with none is asking for the step it is on rather
	// than for somewhere off the flow.
	it("allows the root url when the flow is a single step", async () => {
		const [machine] = await start({});
		assert.deepEqual(await machine.route(), { target: null, prev: null });
	});

	it("bounces an unknown, off-flow or skipped-ahead url to the current step", async () => {
		const [machine] = await start(flow, { scripts });
		const ahead = { target: ["one", "a"], prev: null };
		assert.deepEqual(await machine.route(["two", "b"]), ahead);
		assert.deepEqual(await machine.route(["nope"]), ahead);
		assert.deepEqual(await machine.route(), ahead);
	});
});
