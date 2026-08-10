// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// Renders a v2 machine definition as a mermaid stateDiagram-v2.
//
// Reads the definition, not a running machine, so it documents every branch —
// including the ones current context would skip. Nesting is the point: a
// composed flow is sub-machines chained by onFinal, and each one becomes a
// mermaid composite state at its own depth.

const asArray = (value) =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

const asTransitions = (value) =>
	asArray(value).map((t) => (typeof t === "string" ? { target: t } : t));

// Inline arrow functions are the guards worth reading, so print their source
// rather than the word "cond": collapsed to one line, shortened, and stripped of
// the characters mermaid parses as syntax. A named script prints its name.
const label = (script, fallback) => {
	if (script === undefined) return fallback;
	if (typeof script === "string") return script;
	const source = String(script)
		.replace(/\s+/g, " ")
		.replace(/^\(?[\w\s,{}]*\)?\s*=>\s*/, "")
		// `-->` is an edge, and `:` opens a label — everything else reads fine.
		.replace(/--+>/g, "→")
		.replace(/[:;#]/g, "");
	return source.length > 96 ? `${source.slice(0, 93)}...` : source;
};

// Only NAMED actions are worth an edge label — those are the app's ports, and a
// reader wants to know which one a page calls. An inline closure is plumbing, and
// its body is a statement block that reads as noise once truncated.
const actionsLabel = (actions) =>
	asArray(actions)
		.filter((a) => typeof a === "string")
		.join(", ");

const isComposite = (state) => !!state.states;

// Every state id in the definition, so a target can be resolved and classified
// before it is drawn — see `ref` and `node`.
const collect = (states, segments, into = new Map()) => {
	for (const [key, state] of Object.entries(states)) {
		into.set([...segments, key].join("_"), state);
		if (isComposite(state)) collect(state.states, [...segments, key], into);
	}
	return into;
};

const render = (states, segments, depth, ids) => {
	const pad = "  ".repeat(depth);
	// Targets resolve against the source's siblings, then outward through each
	// ancestor's children — the same walk compile() does, so "done" and
	// "onboard.done" both land where the machine would put them. Getting this
	// wrong invents a phantom box instead of pointing at the real state.
	const ref = (target) => {
		for (let scope = [...segments]; ; scope.pop()) {
			const candidate = [...scope, target].join("_");
			if (ids.has(candidate)) return candidate;
			if (!scope.length)
				throw new Error(
					`target "${target}" not found from "${segments.join("_") || "(root)"}"`,
				);
		}
	};

	// A `final` is where a machine stops, not a page anyone visits — mermaid
	// already draws that as the end dot, scoped to the enclosing composite. So
	// edges into one point straight at `[*]` and the state itself is never boxed.
	const node = (id) => (ids.get(id).type === "final" ? "[*]" : id);
	const to = (target) => node(ref(target));
	let out = "";

	for (const [key, state] of Object.entries(states)) {
		const id = [...segments, key].join("_");
		if (state.type === "final") continue;

		// An event that targets its own state is how a page records an answer: it
		// re-enters so the `go` guards re-run. Drawing that as a loop back to the
		// same box buries the flow — the reader wants to see the guard the submit
		// opens. So a self-transition becomes part of the page's caption, and only
		// an event that actually goes somewhere else is drawn as an edge.
		const submits = [];
		const jumps = [];
		for (const [event, value] of Object.entries(state.on ?? {}))
			for (const t of asTransitions(value)) {
				const via = actionsLabel(t.actions);
				if (t.target === key) submits.push(via ? `${event} → ${via}` : event);
				else jumps.push({ event, via, target: t.target });
			}
		const caption = [key, ...submits].join("<br/>");

		if (isComposite(state)) {
			const nested = [...segments, key];
			out += `${pad}state "${caption}" as ${id} {\n`;
			out += `${pad}  [*] --> ${node(`${id}_${state.initial.target ?? state.initial}`)}\n`;
			out += render(state.states, nested, depth + 1, ids);
			out += `${pad}}\n`;
		} else {
			out += `${pad}state "${caption}" as ${id}\n`;
		}

		for (const t of jumps)
			out += `${pad}${id} --> ${to(t.target)} : ${t.event}${t.via ? `/${t.via}` : ""}\n`;

		// Eventless: the guards that decide the next page.
		for (const t of asTransitions(state.go))
			out += `${pad}${id} --> ${to(t.target)} : ${label(t.cond, "always")}\n`;

		if (state.invoke) {
			const src = label(state.invoke.src, "invoke");
			for (const [outcome, branch] of [
				["ok", state.invoke.onSuccess],
				["error", state.invoke.onError],
			])
				for (const t of asTransitions(branch))
					out += `${pad}${id} --> ${to(t.target)} : ${src} ${outcome}\n`;
		}

		// The hand-off out of a nested machine, drawn from the composite itself.
		for (const t of asTransitions(state.onFinal))
			out += `${pad}${id} --> ${to(t.target)} : done${t.cond ? ` if ${label(t.cond)}` : ""}\n`;
	}

	return out;
};

export default (definition, { title } = {}) => {
	const ids = collect(definition.states, []);
	const initial = definition.initial.target ?? definition.initial;
	let out = "```mermaid\nstateDiagram-v2\n";
	if (title) out += `  %% ${title}\n`;
	out += `  [*] --> ${ids.get(initial).type === "final" ? "[*]" : initial}\n`;
	out += render(definition.states, [], 1, ids);
	return `${out}\`\`\``;
};
