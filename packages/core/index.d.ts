// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// Types for the machine definition, the options it runs under, and the six
// methods a running machine exposes.
//
// `Context` is inferred from `definition.context`, or failing that from
// `options.context`, so scripts written inline get their `context` typed for
// free:
//
//   createMachine({ context: { n: 0 }, initial: "a", states: { ... } })
//   createMachine(flow, { context: loadedRow })
//
// and an explicit `createMachine<Context>(...)` takes over when neither is a
// literal. With no candidate at all it falls back to `any`, so an untyped
// definition stays as usable from TypeScript as it is from JavaScript.
//
// A definition held in its own `const` needs `satisfies MachineDefinition`, or
// an annotation: `type: "final"` widens to `string` otherwise, and `string` is
// not one of the four state types.

/**
 * The public state value, following the xstate convention:
 * `"idle"`, `{ parent: "child" }`, `{ region: { a: "x", b: "y" } }`.
 */
export type StateValue = string | { [key: string]: StateValue };

/**
 * What every script is called with. `send(type, payload)` builds one from its
 * arguments; `start()`, `back()` and the replay behind `path()` pass a bare
 * object, so `type` is not always there.
 */
export interface MachineEvent {
	type?: string;
	/** What `invoke.src` resolved to, on its `onSuccess` transitions. */
	data?: any;
	/** What `invoke.src` threw, on its `onError` transitions. */
	error?: any;
	[key: string]: any;
}

/**
 * An action, a guard, or an `invoke` source. The engine awaits the result: an
 * action's is discarded, a guard's is read for truthiness, and an invoke's
 * arrives as `event.data`.
 */
export type Script<Context = any> = (
	context: Context,
	event: MachineEvent,
) => unknown;

/** A script, or the name of one registered in `options.scripts`. */
export type ScriptRef<Context = any> = Script<Context> | string;

/** One script, or a list run in order. */
export type ScriptList<Context = any> =
	| ScriptRef<Context>
	| readonly ScriptRef<Context>[];

export interface TransitionDefinition<Context = any> {
	/**
	 * Resolved against the source's siblings, then outward through each
	 * ancestor's children. Dotted targets reach into a nested machine
	 * ("onboard.done").
	 */
	target: string;
	/** Taken only if this passes. Without one the transition always applies. */
	cond?: ScriptRef<Context>;
	/** Run after exiting the source and before entering the target. */
	actions?: ScriptList<Context>;
}

/** A bare target, or the full form. */
export type Transition<Context = any> = string | TransitionDefinition<Context>;

/** One transition, or a list tried in order until a `cond` passes. */
export type Transitions<Context = any> =
	| Transition<Context>
	| readonly Transition<Context>[];

/** The child a compound state starts in. Must name a direct child. */
export type Initial<Context = any> =
	| string
	| { target: string; actions?: ScriptList<Context> };

export interface InvokeDefinition<Context = any> {
	src: ScriptRef<Context>;
	/** Taken with `event.data` set to what `src` resolved to. */
	onSuccess: Transitions<Context>;
	/** Taken with `event.error` set to what `src` threw. */
	onError: Transitions<Context>;
}

/**
 * A machine, and — since composition is `{ ...machine, onFinal: "next" }` — any
 * state within one.
 */
export interface MachineDefinition<Context = any> {
	/** Inferred when absent: `compound` with child states, `atomic` without. */
	type?: "atomic" | "compound" | "parallel" | "final";
	/**
	 * Only the root's is read; `options.context` is merged over it. Present here
	 * rather than on a separate root type so a sub-machine can be spread into a
	 * parent's `states`.
	 */
	context?: Context;
	/** Required on a compound state, ignored on a parallel one. */
	initial?: Initial<Context>;
	states?: { [key: string]: MachineDefinition<Context> };
	on?: { [event: string]: Transitions<Context> };
	/** Eventless: taken while settling, as soon as a `cond` passes. */
	go?: Transitions<Context>;
	invoke?: InvokeDefinition<Context>;
	onEntry?: ScriptList<Context>;
	onExit?: ScriptList<Context>;
	/** Where to hand off once every region of this state has reached a `final`. */
	onFinal?: Transitions<Context>;
}

export interface MachineOptions<Context = any> {
	/** Resolves every script named by string in the definition. */
	scripts?: { [name: string]: Script<Context> };
	/** Merged over `definition.context`. */
	context?: Partial<Context>;
	/**
	 * A value previously read off `state()`. `start()` lands exactly there
	 * without running entry actions or settling.
	 */
	state?: StateValue;
	onSend?: (event: MachineEvent) => unknown;
	onTransition?: (state: Snapshot<Context>) => unknown;
	/** Raised only by a transition that carried actions. */
	onChange?: (context: Context, event: MachineEvent) => unknown;
	onFinal?: (state: Snapshot<Context>) => unknown;
}

export interface Snapshot<Context = any> {
	/**
	 * Deliberately not optional: every snapshot `start()`, `send()` and `back()`
	 * return has one. The exception is `state()` called before `start()`, which
	 * reports `undefined` — typing that in would cost a check at every call site
	 * that cannot reach it.
	 */
	value: StateValue;
	context: Context;
	done: boolean;
}

/** What a step page needs, off one replay of the trail. */
export interface Route {
	/** Segments to redirect to, or null to render the step as asked. */
	target: string[] | null;
	/** The Back link for the requested step, or null for the first one. */
	prev: string[] | null;
}

export interface Machine<Context = any> {
	/** Idempotent: a second call reports the current state and does nothing. */
	start(event?: MachineEvent): Promise<Snapshot<Context>>;
	/** Rejects before `start()`. `payload` is merged into the event. */
	send(type: string, payload?: object): Promise<Snapshot<Context>>;
	/** Moves to the previous step on the trail, or stays put on the first. */
	back(event?: MachineEvent): Promise<Snapshot<Context>>;
	/** The trail as dotted node ids, replayed against the current context. */
	path(): Promise<string[]>;
	route(segments?: string[]): Promise<Route>;
	state(): Snapshot<Context>;
}

export function createMachine<Context = any>(
	definition: MachineDefinition<Context>,
	options?: MachineOptions<Context>,
): Machine<Context>;

/**
 * A static value, or a function called with `(context, event)` whose result is
 * assigned. There is no way to assign a function: one is always called.
 */
export type AssignUpdate<Context = any> =
	| Script<Context>
	| string
	| number
	| boolean
	| bigint
	| symbol
	| object
	| null
	| undefined;

/** An action that writes the given keys onto the context. */
export function assign<Context = any>(updates: {
	[key: string]: AssignUpdate<Context>;
}): Script<Context>;

/** A state value as url segments: `{ one: { a: "x" } }` -> `["one","a","x"]`. */
export function toPath(value: StateValue): string[];

/** The reverse of {@link toPath}. */
export function toValue(segments: string[]): StateValue;
