// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
const pkg = process.env.MUTATE_PACKAGE;

// The whole suite runs against every scope: examples/onboard.test.js drives core
// through a real composed flow, and it is what kills a good share of core's
// mutants. Narrowing the runner to the scoped package would report survivors that
// the full run does not have.
const testFiles = [
	"packages/core/index.test.js",
	"packages/validate/index.test.js",
	"packages/mermaid/index.test.js",
	"packages/mermaid/cli.test.js",
	"examples/onboard.test.js",
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	packageManager: "npm",
	reporters: ["progress", "clear-text", "html"],
	testRunner: "tap",
	tap: {
		testFiles,
		nodeArgs: ["--test-reporter=tap"],
	},
	mutate: pkg
		? [`packages/${pkg}/index.js`]
		: [
				"packages/core/index.js",
				"packages/validate/index.js",
				"packages/mermaid/index.js",
			],
	coverageAnalysis: "perTest",
	ignoreStatic: true,
	thresholds: { high: 100, low: 100, break: 100 },
	tempDirName: pkg ? `.stryker-tmp/${pkg}` : ".stryker-tmp",
	// Kept outside tempDirName, which stryker empties on the way out.
	htmlReporter: {
		fileName: pkg
			? `.stryker-tmp/mutation-${pkg}.html`
			: ".stryker-tmp/mutation.html",
	},
	timeoutMS: 20000,
};
