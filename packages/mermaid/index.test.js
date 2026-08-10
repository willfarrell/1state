import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as flows from "../../examples/onboard.js";
import render from "./index.js";

const body = (definition, options) =>
	render(definition, options).replace(/^```mermaid\n|```$/g, "");

// mermaid parses in the browser, so proving a diagram is renderable needs a
// window. It stays a devDependency of the test rather than the package: this
// module turns an object into a string and has no business pulling a DOM.
let mermaid;
before(async () => {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	mermaid = (await import("mermaid")).default;
});
const parses = (definition) => mermaid.parse(body(definition));

// The label a guard prints, read back off the one edge it decides.
const guard = (cond) =>
	body({
		initial: "a",
		states: { a: { go: [{ target: "b", cond }] }, b: {} },
	}).match(/^ {2}a --> b : (.*)$/m)[1];

describe("rendering", () => {
	it("draws a state, its guard and its end", () => {
		assert.equal(
			body({
				initial: "a",
				states: {
					a: { go: [{ target: "done", cond: (ctx) => !!ctx.answer }] },
					done: { type: "final" },
				},
			}),
			'stateDiagram-v2\n  [*] --> a\n  state "a" as a\n  a --> [*] : !!ctx.answer\n',
		);
	});

	// The title is what tells one diagram from the next in a document of them.
	it("names the diagram when given a title", () => {
		assert.match(
			body({ initial: "a", states: { a: {} } }, { title: "accountName" }),
			/^stateDiagram-v2\n {2}%% accountName\n/,
		);
	});

	// A final is never boxed, so a machine that starts on one is only the dots.
	it("draws a machine whose initial state is its end", () => {
		assert.equal(
			body({ initial: "a", states: { a: { type: "final" } } }),
			"stateDiagram-v2\n  [*] --> [*]\n",
		);
	});

	// The record-then-settle idiom: the loop exists so the guards re-run, and
	// drawing it as an edge back to the same box buries the flow.
	it("folds a self-transition into the caption", () => {
		const out = body({
			initial: "a",
			states: {
				a: { on: { answer: { target: "a", actions: "save" } }, go: "b" },
				b: {},
			},
		});
		assert.match(out, /state "a<br\/>answer → save" as a/);
		assert.doesNotMatch(out, /a --> a/);
	});

	it("draws an event that goes somewhere else as an edge", () => {
		assert.match(
			body({ initial: "a", states: { a: { on: { out: "b" } }, b: {} } }),
			/^ {2}a --> b : out$/m,
		);
		assert.match(
			body({
				initial: "a",
				states: { a: { on: { out: { target: "b", actions: "save" } } }, b: {} },
			}),
			/^ {2}a --> b : out\/save$/m,
		);
	});

	// The engine resolves a target against siblings then outward through each
	// ancestor. Prefixing the current path unconditionally invents a phantom box.
	it("resolves a target outward to an ancestor's sibling", () => {
		const out = body({
			initial: "outer",
			states: {
				outer: {
					initial: "inner",
					states: { inner: { on: { out: "sibling" } } },
				},
				sibling: {},
			},
		});
		assert.match(out, /outer_inner --> sibling : out/);
		assert.doesNotMatch(out, /outer_sibling/);
	});

	// Siblings come first, so a hop between two pages of a section stays in the
	// section even when an outer state answers to the same name.
	it("resolves a target to a sibling before looking outward", () => {
		assert.match(
			body({
				initial: "outer",
				states: {
					outer: { initial: "one", states: { one: { go: "two" }, two: {} } },
					two: {},
				},
			}),
			/^ {4}outer_one --> outer_two : always$/m,
		);
	});

	it("refuses a target that resolves to nothing, naming where it looked", () => {
		assert.throws(
			() => render({ initial: "a", states: { a: { go: "gone" } } }),
			/target "gone" not found from "\(root\)"/,
		);
		assert.throws(
			() =>
				render({
					initial: "outer",
					states: {
						outer: {
							initial: "mid",
							states: {
								mid: { initial: "leaf", states: { leaf: { go: "gone" } } },
							},
						},
					},
				}),
			/target "gone" not found from "outer_mid"/,
		);
	});

	it("nests a composed machine and elides its final", () => {
		const out = body({
			initial: "one",
			states: {
				one: {
					initial: "step",
					onFinal: "two",
					states: { step: { go: "end" }, end: { type: "final" } },
				},
				two: {},
			},
		});
		assert.match(out, /state "one" as one \{/);
		assert.match(out, /^ {4}\[\*\] --> one_step$/m);
		assert.match(out, /one_step --> \[\*\] : always/);
		assert.match(out, /^ {2}one --> two : done$/m);
		assert.doesNotMatch(out, /as one_end/);
	});

	it("shows both branches of a conditional hand-off", () => {
		const out = body({
			initial: "one",
			states: {
				one: {
					initial: "step",
					onFinal: [
						{ target: "gated", cond: (ctx) => ctx.mfa },
						{ target: "after" },
					],
					states: { step: { type: "final" } },
				},
				gated: {},
				after: {},
			},
		});
		assert.match(out, /^ {2}one --> gated : done if ctx\.mfa$/m);
		assert.match(out, /^ {2}one --> after : done$/m);
	});

	it("draws both invoke outcomes", () => {
		const out = body({
			initial: "load",
			states: {
				load: { invoke: { src: "fetchIt", onSuccess: "ok", onError: "bad" } },
				ok: {},
				bad: {},
			},
		});
		assert.match(out, /load --> ok : fetchIt ok/);
		assert.match(out, /load --> bad : fetchIt error/);
	});

	// An invoke with no src still has outcomes, and an edge reading " ok" reads
	// as a mistake.
	it("names an invoke after itself when it has no src", () => {
		assert.match(
			body({
				initial: "load",
				states: { load: { invoke: { onSuccess: "ok" } }, ok: {} },
			}),
			/^ {2}load --> ok : invoke ok$/m,
		);
	});

	// Named scripts are the app's ports and worth an edge label. An inline closure
	// is plumbing whose body reads as noise once truncated.
	it("labels named actions and omits inline ones", () => {
		const out = body({
			initial: "a",
			states: {
				a: {
					on: { x: { target: "a", actions: ["save", () => {}, "log"] } },
					go: "b",
				},
				b: {},
			},
		});
		assert.match(out, /state "a<br\/>x → save, log" as a/);
	});
});

describe("guards", () => {
	// A named guard is a key into the app's script registry, so it prints as
	// written — the tidying below is for closures, whose source nobody chose.
	it("prints a named guard as written", () => {
		assert.equal(guard("account:answered"), "account:answered");
	});

	it("collapses a closure onto one line and drops mermaid's syntax", () => {
		const cond = (ctx) => {
			const { role } = ctx;
			return role === "admin";
		};
		assert.equal(
			guard(cond),
			'{ const { role } = ctx return role === "admin" }',
		);
	});

	// The parameters are noise in a diagram — and a bundled app hands over its
	// guards minified, so the spaces and parens are not there to lean on.
	it("strips the parameter list, however it is written", () => {
		assert.equal(
			guard((ctx) => !!ctx.answer),
			"!!ctx.answer",
		);
		// biome-ignore format: how these two are written IS the fixture — the formatter
		// would put the parens and the spaces back, and the test would stop covering
		// the shapes it names.
		assert.equal(guard(ctx => !!ctx.answer), "!!ctx.answer");
		// biome-ignore format: as above, the minified shape.
		assert.equal(guard((ctx)=>!!ctx.answer), "!!ctx.answer");
		assert.equal(
			guard(({ answer }) => !!answer),
			"!!answer",
		);
	});

	// Only a parameter list at the head is one. Snipping the first `x => ` found
	// anywhere would cut the middle out of a guard that reads perfectly well.
	it("strips a parameter list only from the head", () => {
		assert.equal(
			guard(async (ctx) => ctx.ready),
			"async (ctx) => ctx.ready",
		);
	});

	// An arrow in a guard would read as an edge and take the diagram with it, so
	// it becomes a glyph however many dashes it was drawn with.
	it("draws an arrow inside a guard as a glyph", () => {
		assert.equal(
			guard((ctx) => ctx.text === "--->"),
			'ctx.text === "→"',
		);
	});

	// 96 characters is as much guard as an edge label carries: at the brim it
	// prints whole, one character over and it is cut back to 93 and an ellipsis.
	it("cuts a guard only once it is past the limit", () => {
		const brim = (ctx) =>
			ctx.account.value &&
			ctx.passkey.length > 0 &&
			ctx.account.recoveryCodesSeen &&
			ctx.attempts > 1;
		const over = (ctx) =>
			ctx.account.value &&
			ctx.passkey.length > 0 &&
			ctx.account.recoveryCodesSeen &&
			ctx.attempts > 10;
		assert.equal(guard(brim).length, 96);
		assert.doesNotMatch(guard(brim), /\.\.\.$/);
		assert.equal(guard(over), `${guard(brim).slice(0, 93)}...`);
	});
});

describe("output", () => {
	it("parses as a mermaid diagram", async () => {
		await parses({
			initial: "a",
			states: {
				a: { on: { answer: { target: "a", actions: "save" } }, go: "b" },
				b: { type: "final" },
			},
		});
	});

	// The guards carry template literals, quotes, `??` and `||` straight into edge
	// labels, so every real machine is checked rather than a tidy fixture.
	for (const [name, definition] of Object.entries(flows).filter(
		([, v]) => v?.states,
	))
		it(`parses ${name}`, async () => {
			await parses(definition);
		});
});
