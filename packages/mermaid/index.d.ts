// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// The definition shape is restated here rather than imported from
// `@1state/core`, which this package does not depend on at runtime and so
// cannot require a consumer to have installed. It is structurally the same, so
// a `MachineDefinition` from core passes straight in.

export type Script = (context: any, event: any) => unknown;

/** A script, or the name of one — a name is what gets drawn as an edge label. */
export type ScriptRef = Script | string;

export type ScriptList = ScriptRef | readonly ScriptRef[];

export interface TransitionDefinition {
	target: string;
	cond?: ScriptRef;
	actions?: ScriptList;
}

export type Transitions =
	| string
	| TransitionDefinition
	| readonly (string | TransitionDefinition)[];

/**
 * A machine, and any state within one. The root needs `states` and an
 * `initial`; there is no diagram to draw without them.
 */
export interface MachineDefinition {
	type?: "atomic" | "compound" | "parallel" | "final";
	context?: any;
	initial?: string | { target: string; actions?: ScriptList };
	states?: { [key: string]: MachineDefinition };
	on?: { [event: string]: Transitions };
	go?: Transitions;
	invoke?: { src: ScriptRef; onSuccess: Transitions; onError: Transitions };
	onEntry?: ScriptList;
	onExit?: ScriptList;
	onFinal?: Transitions;
}

export interface MermaidOptions {
	/** Written as a `%%` comment on the first line of the diagram. */
	title?: string;
}

/**
 * Renders the definition as a mermaid `stateDiagram-v2`, fenced in a
 * ```` ```mermaid ```` block ready to drop into a markdown file.
 */
export default function mermaid(
	definition: MachineDefinition,
	options?: MermaidOptions,
): string;
