#!/usr/bin/env node
// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// Validate machine definitions from the command line.
//
//   1state-validate examples/onboard.js
//   1state-validate --scripts ./ports.js machines/*.json
//
// A JS module is scanned for every export that looks like a machine, so one file
// of composed flows checks in one call; a JSON file is a single machine. Named
// scripts resolve against the module's own `scripts` export, or --scripts.
// Exits non-zero if anything is invalid, so it drops into CI as-is.
//
// ponytail: globs are the shell's job — no expansion here.

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import validate from "./index.js";

const USAGE = `Usage: 1state-validate [--scripts <module>] <file...>

  <file>             .js module exporting machine definitions, or a .json machine
  --scripts <module> module whose default (or \`scripts\`) export is the registry
  -h, --help         this
`;

const { values, positionals } = parseArgs({
	options: {
		scripts: { type: "string" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

if (values.help || !positionals.length) {
	process.stdout.write(USAGE);
	process.exit(values.help ? 0 : 1);
}

const importFile = (file) => import(pathToFileURL(resolve(file)).href);

// A JSON file holds one machine and has no name of its own, so it borrows the
// file's. Anything with states or an initial is a machine; `scripts` and
// `initialContext` sitting beside them are not.
const machinesIn = async (file) => {
	if (file.endsWith(".json"))
		return [[basename(file), JSON.parse(await readFile(file, "utf8")), {}]];
	const module = await importFile(file);
	return Object.entries(module)
		.filter(
			([, value]) =>
				value &&
				typeof value === "object" &&
				("states" in value || "initial" in value),
		)
		.map(([name, definition]) => [name, definition, module]);
};

// The flag names the registry every machine is checked against, so a module
// that won't load or hasn't got one is fatal: falling through to whatever the
// machine module exports would report green for the check that was asked for
// and never made.
let override = null;
if (values.scripts) {
	try {
		const module = await importFile(values.scripts);
		override = module.default ?? module.scripts;
		if (!override) throw new Error("no default or `scripts` export");
	} catch (error) {
		process.stderr.write(`--scripts ${values.scripts}\n  ✗ ${error.message}\n`);
		process.exit(1);
	}
}

let checked = 0;
let failed = 0;

for (const file of positionals) {
	let found;
	try {
		found = await machinesIn(file);
	} catch (error) {
		failed += 1;
		process.stderr.write(`${file}\n  ✗ ${error.message}\n`);
		continue;
	}

	process.stdout.write(`${file}\n`);
	if (!found.length) process.stdout.write("  (no machines found)\n");

	for (const [name, definition, module] of found) {
		checked += 1;
		const errors = validate(definition, {
			scripts: override ?? module.scripts,
		});
		if (!errors.length) {
			process.stdout.write(`  ✓ ${name}\n`);
			continue;
		}
		failed += 1;
		process.stdout.write(`  ✗ ${name}\n`);
		for (const error of errors) process.stdout.write(`      ${error}\n`);
	}
}

process.stdout.write(
	`${checked} machine${checked === 1 ? "" : "s"}, ${failed} invalid\n`,
);
process.exit(failed ? 1 : 0);
