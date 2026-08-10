// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// https://www.w3.org/TR/scxml/
//
// Compiles a machine definition into a flat node table once, then runs it over a
// set of active leaf states. Every transition target, condition and action is
// resolved at compile time, so running a transition is a Map lookup — no tree
// walking, no `new Function`.
//
// The active-set representation is what makes `parallel` fall out: an atomic
// machine keeps one leaf active, a parallel state keeps one per region.
//
// Public state value follows the xstate convention:
//   "idle" | { parent: "child" } | { region: { a: "x", b: "y" } }

// Most states carry no entry actions, no exit actions and no transitions of any
// given kind, so most of the lists a compile produces are empty. Compiled lists
// are only ever read, so all the empty ones can be this one — a thousand-state
// machine would otherwise allocate ten empty arrays per state.
const NONE = [];

const asArray = (value) =>
	value === undefined ? NONE : Array.isArray(value) ? value : [value];

// map(), but an empty list maps to the shared one rather than a fresh copy.
const mapEach = (list, fn) => (list.length ? list.map(fn) : NONE);

const asTransitions = (value) =>
	mapEach(asArray(value), (t) => (typeof t === "string" ? { target: t } : t));

// ponytail: a machine whose eventless transitions never settle is an authoring
// bug, not a runtime condition — fail loudly instead of hanging the process.
const MAX_MICROSTEPS = 1000;

// A guard, an action or an invoke may be async. Almost none are — a form flow
// reads context and returns a boolean — and `await` on a value that is not a
// promise still costs a microtask tick. One plain transition passed through six
// of these calls, which was most of what it cost.
//
// So every internal step below returns a promise ONLY when something it called
// actually returned one, and resumes through `after` instead of awaiting. The
// public methods are async either way, so none of this is visible from outside.
const isThenable = (value) => typeof value?.then === "function";

const after = (value, next) =>
	isThenable(value) ? value.then(next) : next(value);

export const assign = (updates) => async (context, event) => {
	for (const key of Object.keys(updates)) {
		const value = updates[key];
		context[key] =
			typeof value === "function" ? await value(context, event) : value;
	}
};

// The node id is the URL — "account.passkey.name" ⇄ /account/passkey/name. It is
// unique, stable, and already what path() reports, so routing a flow needs no
// table: segments in, state value out, and the reverse after every transition.
// ponytail: series flows only. A parallel state holds one active leaf per region,
// which no single path can name — give each region its own segments if you need it.
export const toPath = (value) =>
	typeof value === "string"
		? [value]
		: Object.entries(value).flatMap(([key, child]) => [key, ...toPath(child)]);

export const toValue = (segments) =>
	segments.length === 1
		? segments[0]
		: { [segments[0]]: toValue(segments.slice(1)) };

const compile = (definition, scripts) => {
	const nodes = new Map();
	// Definitions live beside the table rather than on the node. Hanging one on
	// and deleting it later would tip every node into dictionary mode, which is
	// paid twice: once to compile, then on every property read for the machine's
	// whole life. Pushed as each node is set, so the two stay in step and the
	// second pass can read them off in order.
	const defs = [];

	// Own properties only. A plain object inherits callables from
	// Object.prototype, so `onEntry: "toString"` would otherwise resolve to one
	// and run instead of reporting an unregistered script.
	const toScript = (ref) => {
		const fn =
			typeof ref === "string"
				? Object.hasOwn(scripts, ref) && scripts[ref]
				: ref;
		if (typeof fn !== "function")
			throw new Error(`script "${ref}" is not a function`);
		return fn;
	};

	const build = (id, key, def, parent, above) => {
		const childKeys = def.states ? Object.keys(def.states) : NONE;
		defs.push(def);
		// Self, then every ancestor out to the root. Parent chains never change
		// after compile and transitions walk them constantly, so each node extends
		// its parent's chain once here rather than rebuilding the array on every
		// lca() and exit.
		const ancestry = [id, ...above];
		const children = mapEach(childKeys, (k) => (id ? `${id}.${k}` : k));
		nodes.set(id, {
			id,
			key,
			parent,
			ancestry,
			type:
				def.type ??
				(childKeys.length
					? "compound"
					: // Stryker disable next-line StringLiteral: a type is only ever asked whether it is compound, parallel or final, so nothing can tell this label from any other — it is here for whoever reads a node
						"atomic"),
			entry: mapEach(asArray(def.onEntry), toScript),
			exit: mapEach(asArray(def.onExit), toScript),
			children,
			on: {},
			go: NONE,
			invoke: null,
			initial: null,
			initialActions: NONE,
			onFinal: NONE,
			leaf: id, // where entering lands; only compound states move off themselves
		});
		for (let i = 0; i < childKeys.length; i++)
			build(children[i], childKeys[i], def.states[childKeys[i]], id, ancestry);
	};
	build("", "", definition, null, []);

	// Targets resolve against the source's siblings, then outward through each
	// ancestor's children — so "final" and "onboard.done" both work from anywhere.
	const resolveSibling = (fromId, target) => {
		// The root has no siblings, so its own transitions resolve against its children.
		for (
			let scope = nodes.get(fromId).parent ?? fromId;
			scope !== null;
			scope = nodes.get(scope).parent
		) {
			const candidate = scope ? `${scope}.${target}` : target;
			if (nodes.has(candidate)) return candidate;
		}
		throw new Error(
			`target "${target}" not found from "${fromId || "(root)"}"`,
		);
	};

	const resolveChild = (parentId, target) => {
		const id = parentId ? `${parentId}.${target}` : target;
		if (!nodes.has(id))
			throw new Error(
				`state "${id}" not found under "${parentId || "(root)"}"`,
			);
		return id;
	};

	const toTargeted = (fromId) => (t) => ({
		target: resolveSibling(fromId, t.target),
		cond: t.cond === undefined ? null : toScript(t.cond),
		actions: mapEach(asArray(t.actions), toScript),
	});

	const compounds = [];
	// Whether any state can move without an event. See settle().
	// Stryker disable next-line BooleanLiteral: starting from true only sends every machine through settle(), which walks the active set to report what this flag already knew
	let settles = false;
	let index = 0;
	for (const node of nodes.values()) {
		const def = defs[index++];
		const map = toTargeted(node.id);
		const label = node.id || "(root)";

		if (def.on)
			for (const event of Object.keys(def.on))
				node.on[event] = mapEach(asTransitions(def.on[event]), map);
		node.go = mapEach(asTransitions(def.go), map);

		if (def.invoke)
			node.invoke = {
				src: toScript(def.invoke.src),
				onSuccess: mapEach(asTransitions(def.invoke.onSuccess), map),
				onError: mapEach(asTransitions(def.invoke.onError), map),
			};

		if (node.type === "compound") {
			if (!def.initial)
				throw new Error(`state "${label}" has child states but no initial`);
			const initial =
				typeof def.initial === "string" ? { target: def.initial } : def.initial;
			// Entering a state drops straight to the state named, where a transition
			// walks in through every ancestor. A descendant initial would report a
			// value whose intermediate entry actions never ran, so refuse the form
			// rather than carry two answers for how a state is entered.
			if (initial.target.includes("."))
				throw new Error(
					`initial "${initial.target}" on "${label}" must name a direct child`,
				);
			node.initial = resolveChild(node.id, initial.target);
			node.initialActions = mapEach(asArray(initial.actions), toScript);
			compounds.push(node);
		}

		if (node.type === "parallel" && !node.children.length)
			throw new Error(`parallel state "${label}" has no regions`);

		// Conditional, like any other transition list: a nested machine is routed
		// around by whoever precedes it, so a section that doesn't apply is never
		// entered — rather than entering and skipping itself, which would leave it on
		// the trail as a page Back could land on.
		node.onFinal = mapEach(asTransitions(def.onFinal), map);
		settles ||=
			// Stryker disable next-line ConditionalExpression: taking every state for one that can move only sends the machine through settle(), which finds nothing to take and says so
			node.invoke !== null ||
			node.go.length !== 0 ||
			// Stryker disable next-line EqualityOperator: for this to lower the flag every node in the machine would have to be final, and a final under nothing but finals never hands off — an ancestor is done only while it is itself active, which it is not while a descendant is
			node.type === "final";
	}

	// The initial chain is fixed once every target resolves, so the trail follows
	// it by lookup instead of walking down on each step. Only compound states
	// open anywhere but themselves, and they are the few.
	const opensAt = (id) => {
		const node = nodes.get(id);
		return node.type === "compound" ? opensAt(node.initial) : id;
	};
	for (const node of compounds) node.leaf = opensAt(node.initial);

	return { nodes, settles };
};

export const createMachine = (definition, options = {}) => {
	const { nodes, settles } = compile(definition, options.scripts ?? {});
	const context = { ...definition.context, ...options.context };
	const config = new Set(); // active leaf ids
	let started = false;

	// Every entry and exit goes through these, so `generation` counts changes to
	// the active set and nothing can move a leaf behind the memo's back.
	let generation = 0;
	const activate = (id) => {
		config.add(id);
		generation++;
	};
	const deactivate = (id) => {
		config.delete(id);
		generation++;
	};

	// parentId -> its active child, read off the active leaves. Compound nodes have
	// exactly one, so snapshots cost O(active leaves x depth) and never scan siblings
	// — a 1000-state machine reports as fast as a 6-state one.
	//
	// One settled configuration is asked the same question several times over —
	// once per region by isActive(), then again by state() and isDone() — so the
	// answer is kept until a leaf actually moves. Each rebuild is a fresh Map, so
	// a snapshot handed out earlier keeps describing the moment it was taken.
	let answered = -1;
	let answer = null;
	const activeChildren = () => {
		// Stryker disable next-line ConditionalExpression: missing the memo rebuilds a map of the same configuration, which answers every question the same way
		if (answered === generation) return answer;
		const map = new Map();
		for (const leaf of config)
			for (let n = leaf; nodes.get(n).parent !== null; n = nodes.get(n).parent)
				map.set(nodes.get(n).parent, n);
		answered = generation;
		answer = map;
		return answer;
	};

	const isActive = (id) => config.has(id) || activeChildren().has(id);

	// Deepest node that is a proper ancestor of both, so an external transition
	// exits and re-enters its source even when target is an ancestor or itself.
	// Both ancestries end at the root, so walking them inward from there finds it
	// without building a Set of one of them.
	const lca = (fromId, toId) => {
		const from = nodes.get(fromId).ancestry;
		const to = nodes.get(toId).ancestry;
		let common = "";
		for (let i = from.length - 1, j = to.length - 1; i > 0 && j > 0; i--, j--) {
			if (from[i] !== to[j]) break;
			common = from[i];
		}
		return common;
	};

	const isDone = (id, active = activeChildren()) => {
		const node = nodes.get(id);
		if (node.type === "final") return config.has(id);
		if (node.type === "parallel")
			return node.children.every((child) => isDone(child, active));
		if (node.type === "compound") {
			const child = active.get(id);
			return child !== undefined && isDone(child, active);
		}
		return false;
	};

	// Actions run in order and receive the live context, so assign() mutations stick.
	// Returns nothing unless an action actually suspended, in which case the rest
	// of the list runs off the promise it handed back.
	const runActions = (actions, event, from = 0) => {
		for (let i = from; i < actions.length; i++) {
			const running = actions[i](context, event);
			if (isThenable(running))
				return running.then(() => runActions(actions, event, i + 1));
		}
	};

	// The first transition whose guard opens, or null. path() replays every guard
	// in the flow on each call, so a synchronous guard must not cost a tick.
	const pick = (transitions, event, from = 0) => {
		for (let i = from; i < transitions.length; i++) {
			const t = transitions[i];
			if (!t.cond) return t;
			const passed = t.cond(context, event);
			if (isThenable(passed))
				return passed.then((open) =>
					open ? t : pick(transitions, event, i + 1),
				);
			if (passed) return t;
		}
		return null;
	};

	const enter = (id, event) => {
		const node = nodes.get(id);
		// Stryker disable next-line ConditionalExpression: an empty list runs nothing whether or not it is handed to runActions — the check is here for the call, not the actions
		return node.entry.length
			? after(runActions(node.entry, event), () => enterInto(node, event))
			: enterInto(node, event);
	};

	const enterInto = (node, event) => {
		if (node.type === "parallel") return enterEach(node.children, event, 0);
		if (node.type === "compound")
			// Stryker disable next-line ConditionalExpression: as above — an initial with no actions has nothing to run either way
			return node.initialActions.length
				? after(runActions(node.initialActions, event), () =>
						enter(node.initial, event),
					)
				: enter(node.initial, event);
		activate(node.id);
	};

	const enterEach = (children, event, from) => {
		for (let i = from; i < children.length; i++) {
			const entering = enter(children[i], event);
			if (isThenable(entering))
				return entering.then(() => enterEach(children, event, i + 1));
		}
	};

	// Collecting every exit action before running any of them keeps the one place
	// this can suspend at the end, rather than threading two loop positions
	// through the resume. Nothing observes the difference: an exit action is
	// handed context and event, never the active set.
	// Only ever concatenated, never pushed into: the first list found is used as
	// it stands, so the usual transition — where at most one state has actions of
	// a given kind — collects them without allocating, and the compiled list it
	// borrowed is left alone.
	const collect = (actions, more) =>
		// Stryker disable next-line ConditionalExpression: concat off the shared empty list answers with the same actions in the same order, so this decides an allocation rather than a result
		actions === NONE ? more : actions.concat(more);

	const exitTo = (boundary, event) => {
		const exited = new Set();
		let actions = NONE;
		// Deleting the value an iterator is sitting on is safe — a Set never
		// revisits it — so this walks config in place instead of copying it on
		// every transition.
		for (const leaf of config) {
			if (!nodes.get(leaf).ancestry.includes(boundary)) continue;
			deactivate(leaf);
			for (let n = leaf; n !== boundary; n = nodes.get(n).parent) {
				if (exited.has(n)) continue;
				exited.add(n);
				const { exit } = nodes.get(n);
				// Stryker disable next-line ConditionalExpression: collecting an empty list adds nothing either way
				if (exit.length) actions = collect(actions, exit);
			}
		}
		// Stryker disable next-line ConditionalExpression: running the shared empty list runs nothing and answers undefined, so this saves the call rather than changing what comes back
		if (actions !== NONE) return runActions(actions, event);
	};

	const doTransition = (sourceId, t, event) => {
		const boundary = lca(sourceId, t.target);
		return after(exitTo(boundary, event), () =>
			t.actions.length
				? after(runActions(t.actions, event), () =>
						after(options.onChange?.({ ...context }, event), () =>
							enterFrom(t.target, boundary, event),
						),
					)
				: enterFrom(t.target, boundary, event),
		);
	};

	// Enter inwards from just inside the boundary down to the target's parent.
	// Indexing the ancestry backwards beats slice/reverse/slice, which would copy
	// it three times per transition — and must not mutate what is now shared
	// compile-time state.
	const enterFrom = (target, boundary, event) => {
		const up = nodes.get(target).ancestry;
		let actions = NONE;
		for (let i = up.indexOf(boundary) - 1; i > 0; i--) {
			const { entry } = nodes.get(up[i]);
			// Stryker disable next-line ConditionalExpression: as in exitTo — collecting an empty list adds nothing either way
			if (entry.length) actions = collect(actions, entry);
		}
		// Stryker disable next-line ConditionalExpression: as in exitTo — the empty list runs nothing, so both arms enter the same state
		return actions === NONE
			? enter(target, event)
			: after(runActions(actions, event), () => enter(target, event));
	};

	// One automatic (eventless) transition, or false when the machine is stable.
	const step = async (event) => {
		for (const id of config) {
			const node = nodes.get(id);

			if (node.invoke) {
				let next = { ...event };
				let t;
				try {
					next.data = await node.invoke.src(context, event);
				} catch (error) {
					next = { ...event, error };
					t = await pick(node.invoke.onError, next);
					if (!t)
						throw new Error(`invoke "${id}": no onError transition matched`);
				}
				t ??= await pick(node.invoke.onSuccess, next);
				if (!t)
					throw new Error(`invoke "${id}": no onSuccess transition matched`);
				await doTransition(id, t, next);
				return true;
			}

			// Stryker disable next-line ConditionalExpression: picking from an empty list answers null, so this saves the call rather than changing what comes back
			if (node.go.length) {
				const picked = pick(node.go, event);
				const t = isThenable(picked) ? await picked : picked;
				// No passing cond is a legitimate rest state: the flow waits here until
				// an event changes context enough for a guard to open.
				if (t) {
					await doTransition(id, t, event);
					return true;
				}
			}

			// Stryker disable next-line ConditionalExpression: a leaf that is not final is not done, and every ancestor's doneness is asked through it, so the walk below would break on its first step
			if (node.type === "final") {
				const active = activeChildren();
				for (let p = node.parent; p !== null; p = nodes.get(p).parent) {
					if (!isDone(p, active)) break;
					const { onFinal } = nodes.get(p);
					const picked = onFinal.length ? pick(onFinal, event) : null;
					const t = isThenable(picked) ? await picked : picked;
					if (t) {
						await doTransition(p, t, event);
						return true;
					}
				}
			}
		}
		return false;
	};

	// Callers check `settles` first. With no invoke, no `go` and no final
	// anywhere, a microstep has nothing it could ever take: stepping would walk
	// the active set only to report that, and awaiting the walk costs a tick on
	// every event-driven machine without eventless transitions.
	const settle = async (event) => {
		for (let i = 0; i < MAX_MICROSTEPS; i++) if (!(await step(event))) return;
		throw new Error("microstep limit reached: machine has a transition loop");
	};

	const value = (id, active) => {
		const node = nodes.get(id);
		if (node.type === "parallel") {
			const out = {};
			for (const child of node.children)
				out[nodes.get(child).key] = value(child, active);
			return out;
		}
		if (node.type === "compound") {
			const activeId = active.get(id);
			if (activeId === undefined) return undefined;
			const child = nodes.get(activeId);
			if (!child.children.length) return child.key;
			// Assigned rather than written as `{ [child.key]: … }`: a computed key in
			// an object literal misses V8's boilerplate cache and costs several times
			// the keyed store, once per level of every snapshot taken.
			const out = {};
			out[child.key] = value(activeId, active);
			return out;
		}
		return node.key;
	};

	// ponytail: shallow. The spread copies the top level only, so a caller that
	// mutates a nested object on the snapshot mutates the live context — deep clone
	// if that ever bites. Not today: state() runs on every transition through
	// onTransition, so structuredClone would land in the per-transition cost, and it
	// throws outright on a context holding functions.
	const state = () => {
		const active = activeChildren();
		return {
			value: value("", active),
			context: { ...context },
			done: isDone("", active),
		};
	};

	// A record outlives the machine that wrote it: regions and steps get added
	// under states it already names. Anywhere the stored value stops describing a
	// node — a region it predates, a shape that no longer fits — that node opens at
	// its own initial, exactly as if nothing were stored for it, which is what lets
	// a finished record re-open when the flow grows. Only a state the record names
	// outright and the machine has never heard of is an error worth raising.
	const restore = (stored, id = "") => {
		const node = nodes.get(id);
		if (node.type === "parallel") {
			for (const child of node.children)
				restore(stored?.[nodes.get(child).key], child);
			return;
		}
		if (node.type === "compound") {
			const key =
				typeof stored === "string" ? stored : Object.keys(stored ?? {})[0];
			const childId =
				key === undefined ? node.initial : id ? `${id}.${key}` : key;
			if (!nodes.has(childId)) throw new Error(`unknown state "${childId}"`);
			restore(typeof stored === "string" ? undefined : stored?.[key], childId);
			return;
		}
		activate(id);
	};

	// One settled configuration, one snapshot: state() twice over was two context
	// spreads and two walks of the active set, and isDone() a third, all for the
	// same answer. The hooks and the caller share it.
	const settled = async () => {
		const snapshot = state();
		if (options.onTransition) await options.onTransition(snapshot);
		if (snapshot.done && options.onFinal) await options.onFinal(snapshot);
		return snapshot;
	};

	const start = async (event = {}) => {
		if (started) return state();
		started = true;
		// A stored value is the truth: land exactly there without re-running entry
		// actions or re-settling, so resume can't re-fire an invoke or skip ahead.
		if (options.state !== undefined) {
			restore(options.state);
		} else {
			const entering = enter("", event);
			// Stryker disable next-line ConditionalExpression: awaiting a plain undefined answers with undefined, so always taking that branch costs a tick and enters the same states
			if (isThenable(entering)) await entering;
			// Stryker disable next-line ConditionalExpression: settling such a machine anyway reaches the same end, having walked the active set to find that no state has anything to take
			if (settles) await settle(event);
		}
		return settled();
	};

	const send = async (type, payload) => {
		if (!started) throw new Error("call start() before send()");
		const event = { type, ...payload };
		if (options.onSend) await options.onSend(event);

		// Each active leaf bubbles the event outward to the first ancestor with an
		// enabled transition. In a parallel state several regions may respond.
		const taken = new Map();
		for (const leaf of config) {
			for (let n = leaf; n !== null; n = nodes.get(n).parent) {
				const on = nodes.get(n).on[type];
				const picked = on ? pick(on, event) : null;
				const t = isThenable(picked) ? await picked : picked;
				if (t) {
					taken.set(n, t);
					break;
				}
			}
		}
		for (const [sourceId, t] of taken) {
			// An earlier region's transition may have exited this one.
			if (!isActive(sourceId)) continue;
			const moving = doTransition(sourceId, t, event);
			// Stryker disable next-line ConditionalExpression: as in start() — awaiting a plain undefined decides the same transition, one tick later
			if (isThenable(moving)) await moving;
		}

		// Stryker disable next-line ConditionalExpression: as in start() — a machine with nothing to take walks the active set to say so
		if (settles) await settle(event);
		return settled();
	};

	// Where the flow goes from here with nothing but current context: the first
	// open `go`, or — at the end of a nested machine — whatever its parent's
	// onFinal hands off to, so the trail crosses a machine boundary the same way
	// the machine does.
	const successor = (id) => {
		const node = nodes.get(id);
		return after(node.go.length ? pick(node.go, {}) : null, (t) =>
			t ? t.target : handOff(node, node.parent),
		);
	};

	// The ancestors' hand-offs, tried outward. Recursion rather than a loop over
	// the rest of them: a cond that answers asynchronously has to carry on from
	// the same place, and one exit reads better than two that must agree.
	const handOff = (node, from) => {
		if (node.type !== "final") return null;
		for (let p = from; p !== null; p = nodes.get(p).parent) {
			const { onFinal } = nodes.get(p);
			// Stryker disable next-line ConditionalExpression: picking from an empty list answers null and the walk carries on to the next ancestor either way, so this saves the call rather than changing where the trail goes
			if (!onFinal.length) continue;
			const above = nodes.get(p).parent;
			return after(pick(onFinal, {}), (t) =>
				t ? t.target : handOff(node, above),
			);
		}
		return null;
	};

	// The trail from the initial state to where the machine is now, replayed
	// against current context so skipped states stay skipped. Derived, never
	// recorded: a stored trail goes stale the moment an answer changes.
	// ponytail: linear `go`-driven flows only — parallel regions have no single
	// predecessor, and neither event-driven jumps nor loops are replayable.
	const path = async () => {
		const current = config.values().next().value;
		const out = [];
		const seen = new Set();
		for (let id = nodes.get("").leaf; !seen.has(id); ) {
			seen.add(id);
			// A `final` is a hand-off marker, not a step — it belongs in the trail only
			// when the flow has come to rest on one.
			if (nodes.get(id).type !== "final" || id === current) out.push(id);
			if (id === current) return out;
			const found = successor(id);
			const next = isThenable(found) ? await found : found;
			if (next === null) break;
			id = nodes.get(next).leaf;
		}
		return [current]; // unreachable by replay: no predecessor we can trust
	};

	// Everything a step page needs, off one replay of the trail.
	//   target  segments to redirect to, or null to allow. On or before the current
	//           step is allowed — that's back-nav and re-editing an earlier answer;
	//           off-flow, unknown, or ahead bounces to current.
	//   prev    the Back link for the REQUESTED step, not for current: re-editing an
	//           earlier answer has to go back to what preceded IT. null on the first
	//           step (render no link) and while redirecting, since the page that
	//           lands then asks for its own.
	// Never restore() from the URL: settling from context is what makes the trail
	// the truth, and a typed URL would otherwise skip ahead.
	const route = async (segments = []) => {
		const trail = await path();
		const at = trail.indexOf(segments.join("."));
		return {
			target: at === -1 ? trail.at(-1).split(".") : null,
			prev: at > 0 ? trail[at - 1].split(".") : null,
		};
	};

	// Back button. Moves to the previous state on that trail and deliberately does
	// NOT settle — the guard that let us move forward is still satisfied, so
	// settling would bounce straight back.
	const back = async (event = {}) => {
		const trail = await path();
		if (trail.length < 2) return state();
		await doTransition(
			trail.at(-1),
			{ target: trail.at(-2), actions: NONE },
			event,
		);
		const snapshot = state();
		if (options.onTransition) await options.onTransition(snapshot);
		return snapshot;
	};

	return { start, send, back, path, route, state };
};
