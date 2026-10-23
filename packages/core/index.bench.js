import { bench, suite } from "node:bench";
import { createMachine } from "./index.js";

const opts = { warmup: 10, samples: 30 };

// -- Fixtures --

// Every fixture transitions to itself so a task can run indefinitely without
// the machine drifting into a state that no longer handles `ping`.

const flat = (n) => ({
	initial: "s0",
	states: Object.fromEntries(
		Array.from({ length: n }, (_, i) => [`s${i}`, { on: { ping: `s${i}` } }]),
	),
});

const nested = (depth) => {
	let node = { on: { ping: `l${depth - 1}` } };
	for (let i = depth - 1; i >= 0; i--)
		node = { initial: `l${i}`, states: { [`l${i}`]: node } };
	return node;
};

// Leaf handles nothing, so the event bubbles the full depth to the root.
const bubbling = (depth) => {
	const machine = nested(depth);
	delete machine.states.l0.states.l1.states.l2.states.l3.states.l4.on;
	machine.on = { ping: "l0" };
	return machine;
};

const parallel = (regions) => ({
	initial: "all",
	states: {
		all: {
			type: "parallel",
			states: Object.fromEntries(
				Array.from({ length: regions }, (_, i) => [
					`r${i}`,
					{ initial: "on", states: { on: { on: { ping: "on" } } } },
				]),
			),
		},
	},
});

// A wizard resting on its last step: path() replays the whole flow against
// current context, which is exactly what a Back button costs.
const wizard = {
	initial: "q0",
	states: {
		...Object.fromEntries(
			Array.from({ length: 9 }, (_, i) => [
				`q${i}`,
				{ go: [{ target: `q${i + 1}`, cond: (ctx) => ctx[`a${i}`] != null }] },
			]),
		),
		q9: {},
	},
};
const answered = Object.fromEntries(
	Array.from({ length: 9 }, (_, i) => [`a${i}`, true]),
);

// The composed shape: `sections` two-question machines chained by onFinal, all
// answered, so the flow rests on the last one. Settling walks every hand-off and
// path() replays them — the per-page cost of a nested wizard.
const composed = (sections) => ({
	initial: "s0",
	states: Object.fromEntries(
		Array.from({ length: sections }, (_, i) => [
			`s${i}`,
			{
				initial: "one",
				...(i < sections - 1 ? { onFinal: `s${i + 1}` } : {}),
				states: {
					one: {
						go: [{ target: "two", cond: (ctx) => ctx[`s${i}a`] != null }],
					},
					two: {
						go: [{ target: "end", cond: (ctx) => ctx[`s${i}b`] != null }],
					},
					end: { type: "final" },
				},
			},
		]),
	),
});
const filled = (sections) =>
	Object.fromEntries(
		Array.from({ length: sections }, (_, i) => i)
			.slice(0, -1)
			.flatMap((i) => [
				[`s${i}a`, true],
				[`s${i}b`, true],
			]),
	);

const started = async (definition, options) => {
	const machine = createMachine(definition, options);
	await machine.start();
	return machine;
};

const small = await started(flat(6));
const wide = await started(flat(1000));
const deep = await started(nested(5));
const bubbler = await started(bubbling(5));
const forked = await started(parallel(4));
const form = await started(wizard, { context: answered });
const sections = composed(12);
const sectionAnswers = filled(12);
const sectioned = await started(sections, { context: sectionAnswers });

// -- Benchmarks --

// Each sample times a batch of `ops` calls between b.start()/b.end(ops).
const run = (ops, fn) => async (b) => {
	b.start();
	for (let i = 0; i < ops; i++) await fn();
	b.end(ops);
};

suite("core", () => {
	// compile
	bench(
		"compile 6 states",
		opts,
		run(1_000, () => createMachine(flat(6))),
	);
	bench(
		"compile 1000 states",
		opts,
		run(10, () => createMachine(flat(1000))),
	);
	bench(
		"compile 12 nested sections",
		opts,
		run(100, () => createMachine(sections)),
	);

	// send
	bench(
		"send: 6 states",
		opts,
		run(1_000, () => small.send("ping")),
	);
	bench(
		"send: 1000 states",
		opts,
		run(1_000, () => wide.send("ping")),
	);
	bench(
		"send: 5 levels deep",
		opts,
		run(1_000, () => deep.send("ping")),
	);
	bench(
		"send: bubble 5 levels to root",
		opts,
		run(1_000, () => bubbler.send("ping")),
	);
	bench(
		"send: 4 parallel regions",
		opts,
		run(1_000, () => forked.send("ping")),
	);

	// page render
	bench(
		"path(): 10-step wizard",
		opts,
		run(1_000, () => form.path()),
	);
	// What a page render actually costs: resume from stored answers, settling
	// across every hand-off, then the guard and Back link for the requested step.
	// back() isn't listed — it is path() plus one transition, and it would walk
	// the shared fixture backwards out from under the other tasks.
	bench(
		"start(): resume across 12 sections",
		opts,
		run(100, () => started(sections, { context: { ...sectionAnswers } })),
	);
	bench(
		"path(): across 12 sections",
		opts,
		run(1_000, () => sectioned.path()),
	);
	bench(
		"route(): guard + back link",
		opts,
		run(1_000, () => sectioned.route(["s11", "one"])),
	);

	// recompile
	// The whole point of compiling: pay the table build once, not per transition.
	bench(
		"send: 1000 states, recompiled each time",
		opts,
		run(10, async () => {
			const machine = createMachine(flat(1000));
			await machine.start();
			await machine.send("ping");
		}),
	);
});
