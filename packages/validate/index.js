// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// Static checks for a v2 machine definition. Returns a list of problems —
// empty means valid. Never mutates the definition: composed machines share their
// sub-machines by spread, so coercing one in place would corrupt the others.
//
// Three passes, each catching what the others can't:
//   schema       unknown/misspelled keys and malformed shapes, all at once
//   reachability a state nothing routes to
//   compile      targets, script names, missing initials — asked of the engine
//                itself rather than reimplementing its outward resolution here

import { createMachine } from "@1state/core";
// The 2020-12 build, to match the schema's $schema — the default ajv export is
// draft-07 and rejects a $ref sitting alongside sibling keywords.
import Ajv from "ajv/dist/2020.js";
import typeofKeyword from "ajv-keywords/dist/definitions/typeof.js";
import schema from "./schema.js";

// Strict mode rejects this schema on its way in: `typeof` is a keyword ajv only
// learns from ajv-keywords, and the `if` inside `allOf` tests a property it does
// not declare. Both are thrown while compiling — which is to say at import — so
// mutating either option takes the process down before a test can fail on it.
// The rule allErrors trips is about a request driving unbounded error
// allocation. Nothing here is a request: the input is a machine definition its
// own author wrote, checked at author time, and reporting every problem at once
// instead of dying on the first is the entire reason this package exists.
// Stryker disable ObjectLiteral: dropping these crashes the import, so nothing survives to observe it
// nosemgrep: javascript.ajv.security.audit.ajv-allerrors-true.ajv-allerrors-true
const ajv = new Ajv({
	// Stryker disable next-line BooleanLiteral: flipping this crashes the import, so nothing survives to observe it
	strict: false,
	allErrors: true,
	keywords: [typeofKeyword()],
});
// Stryker restore ObjectLiteral
const check = ajv.compile(schema);

// A transition section is one transition or a list of them, and either form is
// a bare target string or the long form.
const targetsOf = (transitions) =>
	[transitions].flat().map((t) => (typeof t === "string" ? t : t.target));

// Every name any transition points at, anywhere in the definition. A dotted
// target passes through the states it names, so each segment counts.
const routed = (state, into = new Set()) => {
	const add = (target) => {
		for (const segment of String(target).split(".")) into.add(segment);
	};

	if (state.initial) add(state.initial.target ?? state.initial);
	for (const value of Object.values(state.on ?? {}))
		targetsOf(value).forEach(add);
	if (state.go) targetsOf(state.go).forEach(add);
	if (state.onFinal) targetsOf(state.onFinal).forEach(add);
	if (state.invoke) {
		targetsOf(state.invoke.onSuccess).forEach(add);
		targetsOf(state.invoke.onError).forEach(add);
	}
	for (const child of Object.values(state.states ?? {})) routed(child, into);
	return into;
};

// A state nothing points at is dead weight the engine will never mention.
// Targets resolve outward, so a name used in one section can legitimately reach
// a state in another: this deliberately over-counts rather than calling a state
// dead when it isn't. What it does catch is the state you added and never routed
// to. Parallel regions are entered by their parent, so they are never orphans.
const unreachable = (state, path, reached, errors = []) => {
	for (const [key, child] of Object.entries(state.states ?? {})) {
		const at = path ? `${path}.${key}` : key;
		if (state.type !== "parallel" && !reached.has(key))
			errors.push(`state "${at}" is unreachable: nothing targets it`);
		unreachable(child, at, reached, errors);
	}
	return errors;
};

export default (definition, options = {}) => {
	const errors = [];

	if (!check(definition))
		// The `if` keyword reports its own failure on top of the real one from the
		// branch it selected — `must match "then" schema` says nothing a reader
		// can act on, and there is one per level of shorthand.
		for (const error of check.errors)
			if (error.keyword !== "if")
				errors.push(`${error.instancePath || "(root)"} ${error.message}`);

	// Only worth walking a definition that is the right shape.
	if (errors.length) return errors;

	errors.push(...unreachable(definition, "", routed(definition)));

	try {
		createMachine(definition, options);
	} catch (error) {
		errors.push(error.message);
	}

	return errors;
};
