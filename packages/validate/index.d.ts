// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
import type { MachineDefinition, MachineOptions } from "@1state/core";

/**
 * Static checks for a machine definition. Returns every problem it found —
 * an empty list means valid. Never mutates the definition.
 *
 * `options` is the same object `createMachine` takes, and is handed to it: in
 * practice only `scripts` changes the outcome, since a name with no registry
 * entry is one of the things reported.
 */
export default function validate(
	definition: MachineDefinition,
	options?: MachineOptions,
): string[];
