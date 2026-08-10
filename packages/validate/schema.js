// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// https://www.w3.org/TR/scxml/
//
// Deliberately strict about unknown properties: the engine reads the keys it
// knows and silently ignores the rest, so `onEnter` for `onEntry` or `onSucess`
// for `onSuccess` is a no-op that nothing else will ever catch. That, and the
// fact that it reports every problem at once, is what this buys over compiling.
//
// Note it does NOT say `on` and `go` are exclusive — a wizard state has both:
// the event records the answer, the guards decide the next page.

// biome-ignore-all lint/suspicious/noThenProperty: `if`/`then`/`else` are JSON Schema keywords here, not a thenable — this object is data handed to ajv, never awaited

const ID = "^[a-zA-Z_][a-zA-Z0-9_-]*$";
const TARGET = "^[a-zA-Z_][a-zA-Z0-9_.-]*$";
const ref = (name) => ({ $ref: `#/$defs/${name}` });

export default {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	// 2020-12 lets `$ref` sit beside other keywords, so the root is just a
	// pointer at the recursive state definition.
	...ref("state"),
	$defs: {
		// Shorthands are discriminated on type rather than collected in an `anyOf`,
		// so a malformed transition reports the one thing actually wrong with it
		// instead of one failure per branch that didn't match.
		//
		// A function, or the name of one in options.scripts.
		script: { typeof: ["function", "string"] },
		scripts: {
			if: { type: "array" },
			then: { type: "array", minItems: 1, items: ref("script") },
			else: ref("script"),
		},
		transition: {
			type: "object",
			additionalProperties: false,
			// Dotted targets reach into a nested machine ("onboard.done"); bare ones
			// resolve against siblings, then outward through each ancestor.
			properties: {
				target: { type: "string", pattern: TARGET },
				cond: ref("script"),
				actions: ref("scripts"),
			},
			required: ["target"],
		},
		// A bare target string, or the full form. The string branch carries the same
		// pattern — an empty `then` would let the shorthand skip every check the
		// long form gets.
		targeted: {
			if: { type: "string" },
			then: { pattern: TARGET },
			else: ref("transition"),
		},
		// One of those, or a list tried in order.
		transitions: {
			if: { type: "array" },
			then: { type: "array", minItems: 1, items: ref("targeted") },
			else: ref("targeted"),
		},
		state: {
			type: "object",
			additionalProperties: false,
			properties: {
				// Inferred when absent: compound with child states, atomic without.
				type: { enum: ["compound", "parallel", "atomic", "final"] },
				// Only the root's is read; options.context is merged over it.
				context: { type: "object" },
				initial: {
					if: { type: "string" },
					then: {},
					else: {
						type: "object",
						additionalProperties: false,
						properties: { target: { type: "string" }, actions: ref("scripts") },
						required: ["target"],
					},
				},
				states: {
					type: "object",
					additionalProperties: false,
					patternProperties: { [ID]: ref("state") },
				},
				on: {
					type: "object",
					additionalProperties: false,
					patternProperties: { [ID]: ref("transitions") },
				},
				go: ref("transitions"),
				invoke: {
					type: "object",
					additionalProperties: false,
					properties: {
						src: ref("script"),
						onSuccess: ref("transitions"),
						onError: ref("transitions"),
					},
					required: ["src", "onSuccess", "onError"],
				},
				onEntry: ref("scripts"),
				onExit: ref("scripts"),
				onFinal: ref("transitions"),
			},
			// A compound state has to say where it starts. A parallel one doesn't —
			// every region is entered.
			allOf: [
				{
					if: {
						required: ["states"],
						properties: { type: { not: { const: "parallel" } } },
					},
					then: { required: ["initial"] },
				},
			],
		},
	},
};
