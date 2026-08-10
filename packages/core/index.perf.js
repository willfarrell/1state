import { ok } from "node:assert";
import test from "node:test";
import { Bench } from "tinybench";
import { createMachine } from "./index.js";

const time = Number(process.env.BENCH_TIME ?? 5_000);

// A benchmark that throws or yields zero throughput is a regression, not a
// "pass". Fail the test instead of only printing a table.
const assertHealthy = (bench) => {
	ok(bench.tasks.length > 0, `${bench.name}: no tasks ran`);
	for (const task of bench.tasks) {
		ok(!task.result?.error, `${bench.name}: "${task.name}" threw`);
		ok(
			(task.result?.throughput?.mean ?? 0) > 0,
			`${bench.name}: "${task.name}" produced no throughput`,
		);
	}
};

const report = async (bench) => {
	await bench.run();
	assertHealthy(bench);
	console.log(`\n${bench.name}`);
	console.table(bench.table());
};

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

// -- Tests --

test("perf: compile", async () => {
	const bench = new Bench({ name: "compile", time });

	bench
		.add("compile 6 states", () => createMachine(flat(6)))
		.add("compile 1000 states", () => createMachine(flat(1000)))
		.add("compile 12 nested sections", () => createMachine(sections));

	await report(bench);
});

test("perf: send", async () => {
	const bench = new Bench({ name: "send", time });

	bench
		.add("send: 6 states", () => small.send("ping"))
		.add("send: 1000 states", () => wide.send("ping"))
		.add("send: 5 levels deep", () => deep.send("ping"))
		.add("send: bubble 5 levels to root", () => bubbler.send("ping"))
		.add("send: 4 parallel regions", () => forked.send("ping"));

	await report(bench);
});

test("perf: page render", async () => {
	const bench = new Bench({ name: "page render", time });

	bench
		.add("path(): 10-step wizard", () => form.path())
		// What a page render actually costs: resume from stored answers, settling
		// across every hand-off, then the guard and Back link for the requested step.
		// back() isn't listed — it is path() plus one transition, and it would walk
		// the shared fixture backwards out from under the other tasks.
		.add("start(): resume across 12 sections", () =>
			started(sections, { context: { ...sectionAnswers } }),
		)
		.add("path(): across 12 sections", () => sectioned.path())
		.add("route(): guard + back link", () => sectioned.route(["s11", "one"]));

	await report(bench);
});

test("perf: recompile", async () => {
	const bench = new Bench({ name: "recompile", time });

	// The whole point of compiling: pay the table build once, not per transition.
	bench.add("send: 1000 states, recompiled each time", async () => {
		const machine = createMachine(flat(1000));
		await machine.start();
		await machine.send("ping");
	});

	await report(bench);
});
