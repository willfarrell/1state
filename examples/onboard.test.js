// End-to-end run of the onboarding wizard in ./onboard.js — the flow a
// user walks, section by section, plus resume, Back, and the settings-page reuse
// each section exists for.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMachine } from "../packages/core/index.js";
import {
	accountName,
	accountWebauthnSecurityKey,
	domainCrossOriginAssets,
	initialContext,
	listFlow,
	onboard,
	scripts,
} from "./onboard.js";

const stamp = () => new Date().toISOString();

// ------------------------------------------------------------------ tests ---

const open = async (definition, context = initialContext()) => {
	const machine = createMachine(definition, { scripts, context });
	return [machine, await machine.start()];
};

const answered = () => ({
	...initialContext(),
	account: {
		termsAt: stamp(),
		value: "willfarrell",
		name: "Will Farrell",
		recoveryCodesAckedAt: stamp(),
		emailAddress: "will@example.org",
		reviewedAt: stamp(),
	},
	passkey: [{ id: "pk1", name: "MacBook" }],
	recoveryCodesCount: 10,
	emailCount: 1,
});

const finishAccount = async (machine) => {
	await machine.send("agree");
	await machine.send("answer", { patch: { value: "willfarrell" } });
	await machine.send("register", { id: "pk1" });
	await machine.send("answer", { name: "MacBook" });
	await machine.send("acknowledge", {
		patch: { recoveryCodesAckedAt: stamp() },
	});
	await machine.send("answer", { patch: { name: "Will Farrell" } });
	await machine.send("answer", { patch: { emailAddress: "will@example.org" } });
	await machine.send("answer", { code: "000000" });
	return machine.send("confirm", { patch: { reviewedAt: stamp() } });
};

const finishDomain = async (machine) => {
	await machine.send("request", { patch: { verifyRequestedAt: stamp() } });
	await machine.send("answer", {
		patch: {
			deploymentEnvironment: "production",
			deploymentEnvironmentAt: stamp(),
		},
	});
	await machine.send("answer", {
		patch: { caaIssuers: ["letsencrypt.org"], caaIssuersAt: stamp() },
	});
	await machine.send("answer", { patch: { caaAccountUri: "" } });
	await machine.send("answer", { patch: { upgradeInsecureRequests: true } });
	await machine.send("answer", { patch: { crossOriginAssets: false } });
	await machine.send("answer", {
		patch: { integration: "github", integrationAt: stamp() },
	});
	await machine.send("acknowledge", {
		patch: { integrationSetupAckedAt: stamp() },
	});
	return machine.send("confirm", { patch: { reviewedAt: stamp() } });
};

describe("account onboarding", () => {
	it("opens on the terms page", async () => {
		const [, state] = await open(onboard);
		assert.deepEqual(state.value, { account: "terms" });
	});

	it("walks the account section question by question", async () => {
		const [machine] = await open(onboard);
		assert.deepEqual((await machine.send("agree")).value, {
			account: { username: "username" },
		});
		const named = await machine.send("answer", {
			patch: { value: "willfarrell" },
		});
		assert.deepEqual(named.value, { account: { passkey: "credential" } });
		const registered = await machine.send("register", { id: "pk1" });
		assert.deepEqual(registered.value, { account: { passkey: "name" } });
	});

	it("generates recovery codes on entry and waits to be acknowledged", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		await machine.send("register", { id: "pk1" });
		const state = await machine.send("answer", { name: "MacBook" });
		assert.deepEqual(state.value, { account: { recoveryCodes: "codes" } });
		// How many is the script's business; the machine only needs some to exist.
		assert.ok(state.context.recoveryCodesCount > 0);
	});

	it("skips the security key when no org requires one", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		await machine.send("register", { id: "pk1" });
		await machine.send("answer", { name: "MacBook" });
		const state = await machine.send("acknowledge", {
			patch: { recoveryCodesAckedAt: stamp() },
		});
		assert.deepEqual(state.value, { account: { name: "name" } });
	});

	it("holds the email step until the code verifies", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		await machine.send("register", { id: "pk1" });
		await machine.send("answer", { name: "MacBook" });
		await machine.send("acknowledge", {
			patch: { recoveryCodesAckedAt: stamp() },
		});
		await machine.send("answer", { patch: { name: "Will Farrell" } });
		const sent = await machine.send("answer", {
			patch: { emailAddress: "will@example.org" },
		});
		assert.deepEqual(sent.value, { account: { emailAddress: "code" } });
		const wrong = await machine.send("answer", { code: "999999" });
		assert.deepEqual(wrong.value, { account: { emailAddress: "code" } });
		const right = await machine.send("answer", { code: "000000" });
		assert.deepEqual(right.value, { account: "review" });
	});

	it("offers a pending invite before the organization fork", async () => {
		const [machine] = await open(onboard, {
			...answered(),
			invites: [{ organization: "Acme" }],
		});
		assert.deepEqual(machine.state().value, { account: "invite" });
		const state = await machine.send("answer", {
			patch: { inviteAccepted: false },
		});
		assert.equal(state.value, "organizationFork");
	});
});

// Guards are presence checks over data a form posted, so the answer path is the
// place a request could lie about having answered.
describe("patches from a request", () => {
	it("cannot satisfy a guard through the prototype", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		// What JSON.parse('{"__proto__":{...}}') hands an action: an own key that
		// assignment would route to the prototype setter.
		const hostile = JSON.parse(
			'{"value":"willfarrell","__proto__":{"name":"x"}}',
		);
		const state = await machine.send("answer", { patch: hostile });
		assert.equal(state.context.account.value, "willfarrell");
		assert.equal("name" in state.context.account, false);
		assert.equal({}.name, undefined);
		// The name question still gets asked, three sections later.
		assert.deepEqual(state.value, { account: { passkey: "credential" } });
	});
});

// A double-clicked button or a retried POST replays the same event. Most of the
// flow is safe for free — the state that accepted it is no longer active — but
// that only holds where the answer advanced the flow.
describe("replayed submits", () => {
	it("ignores a repeat of an answer that already advanced", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		const once = await machine.send("register", { id: "pk1" });
		const twice = await machine.send("register", { id: "pk1" });
		assert.deepEqual(twice.context.passkey, once.context.passkey);
	});

	// The list pages stay active across add and remove, so these two carry the
	// burden themselves rather than inheriting it from the flow.
	it("does not add the same row twice", async () => {
		const [machine] = await open(listFlow("promoCode", { min: 3 }));
		await machine.send("add", { value: "A" });
		const state = await machine.send("add", { value: "A" });
		assert.deepEqual(state.context.promoCode, ["A"]);
		assert.equal(state.value, "add");
	});

	it("does not let a repeated remove drop a second row", async () => {
		const [machine] = await open(listFlow("promoCode", { min: 3 }));
		for (const value of ["A", "B", "C"]) await machine.send("add", { value });
		await machine.send("remove", { value: "A" });
		const state = await machine.send("remove", { value: "A" });
		assert.deepEqual(state.context.promoCode, ["B", "C"]);
	});
});

describe("resume", () => {
	it("lands on the first gap with no stored cursor", async () => {
		const [, state] = await open(onboard, {
			...answered(),
			account: { termsAt: stamp(), value: "willfarrell" },
			passkey: [{ id: "pk1" }],
		});
		assert.deepEqual(state.value, { account: { passkey: "name" } });
	});

	it("re-opens a finished account when the org turns on MFA", async () => {
		const [, state] = await open(onboard, { ...answered(), mfaRequire: true });
		assert.deepEqual(state.value, { account: { securityKey: "credential" } });
	});

	it("asks for the security key's name once it is registered", async () => {
		const [machine] = await open(onboard, { ...answered(), mfaRequire: true });
		const state = await machine.send("register", { id: "sk1" });
		assert.deepEqual(state.value, { account: { securityKey: "name" } });
		assert.equal(
			(await machine.send("answer", { name: "YubiKey" })).value,
			"organizationFork",
		);
	});
});

describe("back", () => {
	it("crosses a section boundary", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		assert.deepEqual(await machine.path(), [
			"account.terms",
			"account.username.username",
			"account.passkey.credential",
		]);
		assert.deepEqual((await machine.back()).value, {
			account: { username: "username" },
		});
	});

	// What a step page renders from: one replay gives the guard and the Back link,
	// and the node id is the URL — /onboard/account/username/username.
	it("guards a step url and links back from the same replay", async () => {
		const [machine] = await open(onboard);
		await machine.send("agree");
		await machine.send("answer", { patch: { value: "willfarrell" } });
		assert.deepEqual(
			await machine.route(["account", "passkey", "credential"]),
			{
				target: null,
				prev: ["account", "username", "username"],
			},
		);
		// Ahead of the answers — bounced to where the flow actually stops.
		assert.deepEqual(await machine.route(["account", "review"]), {
			target: ["account", "passkey", "credential"],
			prev: null,
		});
	});

	// A section that doesn't apply is never entered, so it can't be linked to or
	// landed on — the trail is only pages the user actually saw.
	it("leaves a section that does not apply off the trail entirely", async () => {
		const [machine] = await open(onboard, answered());
		const trail = await machine.path();
		assert.ok(!trail.some((id) => id.startsWith("account.securityKey")));
		assert.deepEqual(
			await machine.route(["account", "securityKey", "credential"]),
			{
				target: ["organizationFork"],
				prev: null,
			},
		);
	});

	it("puts it back on the trail once it does apply", async () => {
		const [machine] = await open(onboard, { ...answered(), mfaRequire: true });
		assert.deepEqual((await machine.path()).slice(-2), [
			"account.recoveryCodes.codes",
			"account.securityKey.credential",
		]);
		assert.deepEqual((await machine.back()).value, {
			account: { recoveryCodes: "codes" },
		});
	});

	it("walks back over a step the answers skipped", async () => {
		const [machine] = await open(onboard, answered());
		assert.equal(machine.state().value, "organizationFork");
		// securityKey never applied, so Back steps straight over it.
		assert.deepEqual((await machine.back()).value, { account: "invite" });
		assert.deepEqual((await machine.back()).value, { account: "review" });
	});
});

describe("organization onboarding", () => {
	it("branches into the organization section", async () => {
		const [machine] = await open(onboard, answered());
		const state = await machine.send("answer", {
			patch: { createOrganization: true },
		});
		assert.deepEqual(state.value, { organization: { name: "name" } });
	});

	it("reaches the domain fork once the organization is reviewed", async () => {
		const [machine] = await open(onboard, answered());
		await machine.send("answer", { patch: { createOrganization: true } });
		await machine.send("answer", { patch: { name: "Acme" } });
		await machine.send("add", { value: "billing@acme.example" });
		await machine.send("answer", { value: false }); // billing emails
		await machine.send("answer", { value: false }); // promo codes
		await machine.send("answer", { patch: { retention: 90 } });
		await machine.send("answer", { patch: { compliance: [] } });
		await machine.send("answer", { value: false }); // collaborators
		const state = await machine.send("confirm", {
			patch: { reviewedAt: stamp() },
		});
		assert.equal(state.value, "domainFork");
	});

	it("walks a whole list section back in a straight line", async () => {
		const [machine] = await open(onboard, answered());
		await machine.send("answer", { patch: { createOrganization: true } });
		await machine.send("answer", { patch: { name: "Acme" } });
		await machine.send("add", { value: "billing@acme.example" });
		await machine.send("answer", { value: false });
		// At rest the loop edge is closed, so the replay is linear right through it.
		assert.deepEqual((await machine.path()).slice(-4), [
			"organization.name.name",
			"organization.billingEmail.add",
			"organization.billingEmail.review",
			"organization.promoCode.required",
		]);
		assert.deepEqual((await machine.back()).value, {
			organization: { billingEmail: "review" },
		});
	});
});

// The list mechanics, driven directly — a section is a machine, so it needs no
// wizard around it to be exercised.
describe("list questions", () => {
	const list = (options) =>
		open(listFlow("promoCode", options), initialContext());

	it("takes 'no' on the first page as an answer", async () => {
		const [machine, state] = await list();
		assert.equal(state.value, "required");
		const done = await machine.send("answer", { value: false });
		assert.equal(done.done, true);
		assert.deepEqual(done.context.promoCode, []);
	});

	it("loops the add page until the user says no more", async () => {
		const [machine] = await list();
		assert.equal((await machine.send("answer", { value: true })).value, "add");
		assert.equal((await machine.send("add", { value: "A" })).value, "review");
		assert.equal((await machine.send("answer", { value: true })).value, "add");
		await machine.send("add", { value: "B" });
		const state = await machine.send("answer", { value: false });
		assert.equal(state.done, true);
		assert.deepEqual(state.context.promoCode, ["A", "B"]);
	});

	it("falls back to the add page when a row is removed", async () => {
		const [machine] = await list();
		await machine.send("answer", { value: true });
		await machine.send("add", { value: "A" });
		assert.equal((await machine.send("remove", { value: "A" })).value, "add");
	});

	// A list with a floor has no "add one?" page to render — there is no "no" to
	// give — so it isn't built, rather than being built and skipped.
	it("opens a required list straight on the add page", async () => {
		const [machine, state] = await list({ min: 1 });
		assert.equal(state.value, "add");
		assert.deepEqual(await machine.path(), ["add"]);
		assert.equal((await machine.send("add", { value: "A" })).value, "review");
		assert.equal((await machine.send("answer", { value: false })).done, true);
	});

	it("will not let a required list finish empty", async () => {
		const [machine] = await list({ min: 1 });
		assert.equal((await machine.send("answer", { value: false })).value, "add");
	});

	it("stops asking for more at the maximum", async () => {
		const [machine] = await list({ max: 2 });
		await machine.send("answer", { value: true });
		await machine.send("add", { value: "A" });
		await machine.send("answer", { value: true });
		const state = await machine.send("add", { value: "B" });
		// Full: the page shows the limit note in place of the question, so the only
		// answer left is Continue — and a stale "yes" can't reopen the add page.
		assert.equal(state.value, "review");
		const forced = await machine.send("answer", { value: true });
		assert.equal(forced.done, true);
		assert.deepEqual(forced.context.promoCode, ["A", "B"]);
	});

	it("reopens the add page when a row is removed at the maximum", async () => {
		const [machine] = await list({ max: 1 });
		await machine.send("answer", { value: true });
		const full = await machine.send("add", { value: "A" });
		assert.equal(full.value, "review");
		assert.equal((await machine.send("remove", { value: "A" })).value, "add");
	});

	it("rejects bounds that can never be satisfied", () => {
		assert.throws(
			() => listFlow("promoCode", { min: 3, max: 2 }),
			/min 3 is above max 2/,
		);
	});
});

describe("domain onboarding", () => {
	const atDomain = async (context = {}) => {
		const [machine] = await open(onboard, {
			...answered(),
			createOrganization: false,
			...context,
		});
		await machine.send("answer", { patch: { createDomain: true } });
		return machine;
	};

	it("opens on ownership", async () => {
		const machine = await atDomain();
		assert.deepEqual(machine.state().value, { domain: { verify: "verify" } });
	});

	it("accepts ownership proved on the apex", async () => {
		const machine = await atDomain({ apexConfig: { verifiedDns: true } });
		assert.deepEqual(machine.state().value, {
			domain: { deployment: "environment" },
		});
	});

	it("asks for a parent only on a non-production subdomain", async () => {
		const machine = await atDomain({
			fqdn: "staging",
			apexConfig: { verifiedDns: true },
		});
		const state = await machine.send("answer", {
			patch: {
				deploymentEnvironment: "staging",
				deploymentEnvironmentAt: stamp(),
			},
		});
		assert.deepEqual(state.value, { domain: { deployment: "parent" } });
	});

	it("skips CAA where there is no record to publish", async () => {
		const machine = await atDomain({
			apexConfig: { verifiedDns: true },
			parentCaa: true,
		});
		const state = await machine.send("answer", {
			patch: {
				deploymentEnvironment: "production",
				deploymentEnvironmentAt: stamp(),
			},
		});
		assert.deepEqual(state.value, {
			domain: { upgradeInsecureRequests: "upgrade" },
		});
	});

	it("skips CAA and HTTPS upgrade on a hidden service", async () => {
		const machine = await atDomain({
			network: "onion",
			apexConfig: { verifiedWellKnown: true },
		});
		const state = await machine.send("answer", {
			patch: {
				deploymentEnvironment: "production",
				deploymentEnvironmentAt: stamp(),
			},
		});
		assert.deepEqual(state.value, {
			domain: { crossOriginAssets: "assets" },
		});
	});

	it("asks for an ACME account only when Let's Encrypt is allowed", async () => {
		const machine = await atDomain({ apexConfig: { verifiedDns: true } });
		await machine.send("answer", {
			patch: {
				deploymentEnvironment: "production",
				deploymentEnvironmentAt: stamp(),
			},
		});
		const other = await machine.send("answer", {
			patch: { caaIssuers: ["digicert.com"], caaIssuersAt: stamp() },
		});
		assert.deepEqual(other.value, {
			domain: { upgradeInsecureRequests: "upgrade" },
		});
	});

	it("skips the setup page for a manual integration", async () => {
		const machine = await atDomain({
			apexConfig: { verifiedDns: true, caaIssuersAt: stamp(), caaIssuers: [] },
			fqdnConfig: {
				deploymentEnvironment: "production",
				deploymentEnvironmentAt: stamp(),
				upgradeInsecureRequests: true,
				crossOriginAssets: false,
			},
		});
		assert.deepEqual(machine.state().value, {
			domain: { integration: "provider" },
		});
		const state = await machine.send("answer", {
			patch: { integration: "manual", integrationAt: stamp() },
		});
		assert.deepEqual(state.value, { domain: "review" });
	});

	it("blocks on report-only until a scan observes the deployment", async () => {
		const machine = await atDomain();
		const reviewed = await finishDomain(machine);
		assert.deepEqual(reviewed.value, { domain: "reportOnly" });
		assert.equal(reviewed.done, false);
		const scanned = await machine.send("scan", {
			patch: { setupComplete: true },
		});
		assert.equal(scanned.value, "done");
		assert.equal(scanned.done, true);
	});
});

describe("end to end", () => {
	it("runs account → organization → domain to completion", async () => {
		const seen = [];
		const machine = createMachine(onboard, {
			scripts,
			context: initialContext(),
			onFinal: (state) => seen.push(state.value),
		});
		await machine.start();

		await finishAccount(machine);
		await machine.send("answer", { patch: { createOrganization: true } });
		await machine.send("answer", { patch: { name: "Acme" } });
		await machine.send("add", { value: "billing@acme.example" });
		await machine.send("answer", { value: false }); // billing emails: no more
		await machine.send("answer", { value: false }); // promo codes
		await machine.send("answer", { patch: { retention: 90 } });
		await machine.send("answer", { patch: { compliance: ["soc2"] } });
		await machine.send("answer", { value: false }); // collaborators
		await machine.send("confirm", { patch: { reviewedAt: stamp() } });
		await machine.send("answer", { patch: { createDomain: true } });
		await finishDomain(machine);
		const state = await machine.send("scan", {
			patch: { setupComplete: true },
		});

		assert.equal(state.value, "done");
		assert.equal(state.done, true);
		assert.deepEqual(seen, ["done"]);
	});

	it("stops after the account when nothing else is wanted", async () => {
		const [machine] = await open(onboard);
		await finishAccount(machine);
		await machine.send("answer", { patch: { createOrganization: false } });
		const state = await machine.send("answer", {
			patch: { createDomain: false },
		});
		assert.equal(state.done, true);
	});
});

// The reason each section is its own export: /settings/<thing> runs the same
// definition standalone, over a context loaded from the row instead of an empty
// one, and finishes when that one answer is in.
describe("settings pages", () => {
	it("edits one answer with the section machine alone", async () => {
		const [machine, state] = await open(accountName, {
			...initialContext(),
			account: { termsAt: stamp(), value: "willfarrell" },
		});
		assert.equal(state.value, "name");
		const saved = await machine.send("answer", {
			patch: { name: "Will Farrell" },
		});
		assert.equal(saved.done, true);
	});

	// Applicability lives on the transition into a section, so standalone the
	// section just runs — you can add a security key whether or not one is required.
	it("opens a section the wizard routed around", async () => {
		const [, state] = await open(accountWebauthnSecurityKey, answered());
		assert.equal(state.value, "credential");
	});

	it("closes immediately when the answer is already on the row", async () => {
		const [, state] = await open(domainCrossOriginAssets, {
			...initialContext(),
			fqdnConfig: { crossOriginAssets: false },
		});
		assert.equal(state.done, true);
	});
});
