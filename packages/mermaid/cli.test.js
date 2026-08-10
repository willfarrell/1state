import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

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

const onboard = new URL("../../examples/onboard.js", import.meta.url).pathname;

const fixture = async (name, contents) => {
	const file = join(await mkdtemp(join(tmpdir(), "1state-")), name);
	await writeFile(file, contents);
	return file;
};

const machine = JSON.stringify({
	initial: "a",
	states: { a: { go: "b" }, b: {} },
});

describe("cli", () => {
	it("renders a section per exported machine", async () => {
		const { code, stdout } = await run(onboard);
		assert.equal(code, 0);
		assert.equal(stdout.match(/^## `/gm).length, 22);
		assert.match(stdout, /^## `accountEmailAddress`$/m);
		assert.match(
			stdout,
			/```mermaid\nstateDiagram-v2\n {2}%% accountEmailAddress/,
		);
	});

	it("titles the document, defaulting when not told", async () => {
		const file = await fixture("flow.json", machine);
		assert.match((await run(file)).stdout, /^# State machines\n/);
		assert.match(
			(await run("--title", "Onboarding flow", file)).stdout,
			/^# Onboarding flow\n/,
		);
	});

	it("passes --check on a file that is what it would have written", async () => {
		const source = await fixture("flow.json", machine);
		const doc = await fixture(
			"FLOW.md",
			(await run("--title", "Flow", source)).stdout,
		);
		const { code, stdout, stderr } = await run(
			"--title",
			"Flow",
			"--check",
			doc,
			source,
		);
		assert.equal(code, 0);
		assert.equal(stdout, "");
		assert.equal(stderr, "");
	});

	// The whole point of the command: a diagram that no longer matches its machine
	// fails CI. A file that was never generated is drift too, not a crash.
	it("fails --check on a stale file, naming it", async () => {
		const source = await fixture("flow.json", machine);
		const doc = await fixture(
			"FLOW.md",
			"# State machines\n\nwhat it used to say\n",
		);
		const { code, stdout, stderr } = await run("--check", doc, source);
		assert.equal(code, 1);
		assert.equal(stdout, "");
		assert.ok(stderr.startsWith(doc));
		assert.match(
			stderr,
			/is out of date — re-run without --check to regenerate/,
		);

		assert.equal((await run("--check", `${doc}.absent`, source)).code, 1);
	});

	it("exits non-zero with usage when given nothing", async () => {
		const { code, stdout } = await run();
		assert.equal(code, 1);
		assert.match(stdout, /^Usage: 1state-mermaid/);
	});

	it("prints usage and succeeds when asked for help", async () => {
		const { code, stdout } = await run("-h");
		assert.equal(code, 0);
		assert.match(stdout, /^Usage: 1state-mermaid/);
		assert.match(stdout, /--check <file>/);
	});
});
