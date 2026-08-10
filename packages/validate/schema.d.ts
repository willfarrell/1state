// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
/**
 * The JSON Schema (2020-12) a machine definition is checked against, exported
 * so it can be fed to your own validator or an editor's schema store.
 *
 * The root is a `$ref` at the recursive state definition in `$defs`.
 */
declare const schema: {
	$schema: string;
	$ref: string;
	$defs: { [name: string]: unknown };
};

export default schema;
