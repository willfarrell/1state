import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import * as flows from "../../examples/onboard.js";
import validate from "./index.js";

const run = async (...args) => {
	try {
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [
			new URL("./cli.js", import.meta.url).pathname,
			...args,
		]);
		return { code: 0, stdout, stderr };
	} catch (error) {
		return { code: error.code, stdout: error.stdout, stderr: error.stderr };
	}
};

const machines = Object.entries(flows).filter(([, value]) => value?.states);
const options = () => ({
	scripts: flows.scripts,
	context: flows.initialContext(),
});

describe("the onboarding definitions", () => {
	// Guards the whole file at once: a section added without being routed to, or a
	// key quietly misspelled, fails here rather than at the page that needed it.
	for (const [name, definition] of machines)
		it(`${name} is a valid definition`, () => {
			assert.deepEqual(validate(definition, options()), []);
		});

	it("covers every exported machine", () => {
		assert.equal(machines.length, 22);
	});
});

describe("validate", () => {
	const broken = (state, options = {}) =>
		validate({ initial: "a", states: { a: state } }, options);

	// The one class of mistake compiling can't find: the engine reads the keys it
	// knows and ignores the rest, so a misspelling is a silent no-op.
	it("rejects a property the engine would silently ignore", () => {
		assert.deepEqual(broken({ onEnter: () => {} }), [
			"/states/a must NOT have additional properties",
		]);
	});

	it("rejects a misspelled invoke branch", () => {
		const errors = broken({
			invoke: { src: () => {}, onSucess: "a", onError: "a" },
		});
		assert.ok(
			errors.includes(
				"/states/a/invoke must have required property 'onSuccess'",
			),
		);
	});

	it("reports one error per mistake, not one per shorthand branch", () => {
		assert.deepEqual(broken({ go: [{ target: "a", condition: () => {} }] }), [
			"/states/a/go/0 must NOT have additional properties",
		]);
		assert.deepEqual(broken({ go: [{ target: "a", cond: 42 }] }), [
			'/states/a/go/0/cond must pass "typeof" keyword validation',
		]);
	});

	it("reports every problem at once", () => {
		const errors = validate({
			initial: "a",
			states: { a: { onEnter: () => {} }, b: { onExit: 1 } },
		});
		assert.equal(errors.length, 2);
	});

	it("finds a state nothing routes to", () => {
		assert.deepEqual(
			validate({ initial: "a", states: { a: {}, orphan: {} } }),
			['state "orphan" is unreachable: nothing targets it'],
		);
	});

	// A dotted target reaches into a nested machine, passing through every state
	// it names on the way, so none of them is an orphan.
	it("counts every segment of a dotted target", () => {
		assert.deepEqual(
			validate({
				initial: "a",
				states: {
					a: { on: { next: "b.c" } },
					b: { initial: "c", states: { c: {} } },
				},
			}),
			[],
		);
	});

	// Naming the state alone would be ambiguous: `orphan` under `account` and
	// `orphan` under `organization` are the same word and different bugs.
	it("names a nested orphan by its full path", () => {
		assert.deepEqual(
			validate({
				initial: "a",
				states: { a: { initial: "b", states: { b: {}, orphan: {} } } },
			}),
			['state "a.orphan" is unreachable: nothing targets it'],
		);
	});

	// The examples lean on both, but tangled up with everything else they route.
	// Here each section is the only thing pointing at its target.
	it("counts `go` and `onFinal` as routing to their targets", () => {
		assert.deepEqual(
			validate({
				initial: "a",
				states: { a: { go: "b" }, b: { onFinal: "c" }, c: {} },
			}),
			[],
		);
	});

	// A service's two outcomes are transitions like any other: the state each one
	// lands in has been routed to, and is not an orphan.
	it("counts an invoke's branches as routing to their targets", () => {
		assert.deepEqual(
			validate({
				initial: "loading",
				states: {
					loading: {
						invoke: { src: () => {}, onSuccess: "ready", onError: "failed" },
					},
					ready: {},
					failed: {},
				},
			}),
			[],
		);
	});

	it("does not call a parallel region an orphan", () => {
		assert.deepEqual(
			validate({
				initial: "both",
				states: {
					both: {
						type: "parallel",
						states: { left: {}, right: {} },
					},
				},
			}),
			[],
		);
	});

	// Targets, script names and missing initials are the engine's own rules, so
	// they are asked of it rather than reimplemented — but they still surface here.
	it("passes on what the engine refuses to compile", () => {
		assert.deepEqual(broken({ go: "gone" }), [
			'target "gone" not found from "a"',
		]);
		assert.deepEqual(broken({ onEntry: "nope" }, { scripts: {} }), [
			'script "nope" is not a function',
		]);
		assert.deepEqual(validate({ states: { a: {} } }), [
			"(root) must have required property 'initial'",
		]);
	});

	it("accepts every transition shorthand", () => {
		assert.deepEqual(
			validate({
				initial: { target: "a", actions: [() => {}] },
				states: {
					a: {
						on: {
							one: "b",
							two: { target: "b" },
							three: ["b", { target: "a" }],
						},
					},
					b: { go: "a", onFinal: [{ target: "a", cond: () => true }] },
				},
			}),
			[],
		);
	});
});

// The CLI is the CI surface: what matters is that a bad machine is named and the
// exit code is non-zero.
describe("cli", () => {
	it("passes a module of valid machines", async () => {
		const { code, stdout } = await run(
			new URL("../../examples/onboard.js", import.meta.url).pathname,
		);
		assert.equal(code, 0);
		assert.match(stdout, /✓ onboard\n/);
		assert.match(stdout, /22 machines, 0 invalid/);
	});

	it("names the invalid machine and exits non-zero", async () => {
		const dir = await mkdtemp(join(tmpdir(), "1state-"));
		const file = join(dir, "broken.json");
		await writeFile(
			file,
			JSON.stringify({
				initial: "a",
				states: { a: { onEnter: "x" }, orphan: {} },
			}),
		);
		const { code, stdout } = await run(file);
		assert.equal(code, 1);
		assert.match(stdout, /✗ broken\.json/);
		assert.match(stdout, /must NOT have additional properties/);
		assert.match(stdout, /1 machine, 1 invalid/);
	});

	it("reports a file it cannot read rather than crashing", async () => {
		const { code } = await run("does-not-exist.js");
		assert.equal(code, 1);
	});

	it("exits non-zero with usage when given nothing", async () => {
		const { code, stdout } = await run();
		assert.equal(code, 1);
		assert.match(stdout, /^Usage: 1state-validate/);
	});

	// A flow that names its scripts but leaves the registry to another module —
	// ports wired at the app edge rather than beside the machine.
	const split = async (registry) => {
		const dir = await mkdtemp(join(tmpdir(), "1state-"));
		await writeFile(join(dir, "ports.js"), registry);
		await writeFile(
			join(dir, "account.js"),
			'export const account = { initial: "a", states: { a: { onEntry: "patchAccount" } } };\n',
		);
		return [join(dir, "account.js"), join(dir, "ports.js")];
	};

	it("fails a machine whose named scripts live in another module", async () => {
		const [machine] = await split(
			"export default { patchAccount: () => {} };\n",
		);
		const { code, stdout } = await run(machine);
		assert.equal(code, 1);
		assert.match(
			stdout,
			/✗ account\n {6}script "patchAccount" is not a function/,
		);
		assert.match(stdout, /1 machine, 1 invalid/);
	});

	it("resolves those scripts against --scripts", async () => {
		const [machine, ports] = await split(
			"export default { patchAccount: () => {} };\n",
		);
		const { code, stdout } = await run("--scripts", ports, machine);
		assert.equal(code, 0);
		assert.match(stdout, /✓ account/);
		assert.match(stdout, /1 machine, 0 invalid/);
	});

	// A ports module is as likely to name its registry as to default-export it.
	it("takes the registry from a `scripts` export too", async () => {
		const [machine, ports] = await split(
			"export const scripts = { patchAccount: () => {} };\n",
		);
		const { code, stdout } = await run("--scripts", ports, machine);
		assert.equal(code, 0);
		assert.match(stdout, /1 machine, 0 invalid/);
	});

	// --scripts replaces a module's own registry rather than merging with it: the
	// run being checked is the one the flag describes, whole.
	it("overrides the scripts a module exports itself", async () => {
		const dir = await mkdtemp(join(tmpdir(), "1state-"));
		const ports = join(dir, "ports.js");
		await writeFile(ports, "export default { chargeCard: () => {} };\n");
		const machine = join(dir, "account.js");
		await writeFile(
			machine,
			"export const scripts = { patchAccount: () => {} };\n" +
				'export const account = { initial: "a", states: { a: { onEntry: "patchAccount" } } };\n',
		);

		assert.equal((await run(machine)).code, 0);

		const { code, stdout } = await run("--scripts", ports, machine);
		assert.equal(code, 1);
		assert.match(stdout, /script "patchAccount" is not a function/);
	});

	// Falling back to the module's own registry would report green for the run the
	// flag asked for and never made — the silent no-op this package exists to find.
	it("refuses a --scripts module with no registry to export", async () => {
		const dir = await mkdtemp(join(tmpdir(), "1state-"));
		const ports = join(dir, "ports.js");
		await writeFile(
			ports,
			"export const helpers = { patchAccount: () => {} };\n",
		);
		const machine = join(dir, "account.js");
		await writeFile(
			machine,
			"export const scripts = { patchAccount: () => {} };\n" +
				'export const account = { initial: "a", states: { a: { onEntry: "patchAccount" } } };\n',
		);

		const { code, stderr } = await run("--scripts", ports, machine);
		assert.equal(code, 1);
		assert.match(stderr, /ports\.js/);
	});

	it("reports a --scripts module it cannot load rather than crashing", async () => {
		const [machine] = await split("export default {};\n");
		const { code, stderr } = await run(
			"--scripts",
			"does-not-exist.js",
			machine,
		);
		assert.equal(code, 1);
		assert.match(stderr, /--scripts does-not-exist\.js\n {2}✗ /);
		assert.doesNotMatch(stderr, /node:internal/);
	});
});
