// Copyright 2026 will Farrell, and 1state contributors.
// SPDX-License-Identifier: MIT
// The tardisec onboarding wizard as one machine.
//
// Every export below is a self-contained series machine: one state per question,
// an event that records the answer as a self-transition, and a `go` guard that
// leaves once the answer is on the context. Guards read the ANSWER, never a
// stored cursor, which buys three things for free:
//   resume            enter from the top, settle, land on the first gap
//   no-skip-ahead     a later state is unreachable until its predecessors pass
//   forward-migration adding a state re-opens an already-"complete" record
//
// Booleans are read by PRESENCE (`in`, `=== false`), never truthiness — answering
// "no" must not read as unanswered and trap the user. Answers that can't be told
// apart from their default get an `At` marker instead.
//
// Composition is `{ ...machine, onFinal: "next" }`: no sub-machine names its
// successor, so the same definition drives both entry points —
//   wizard    createMachine(onboard, { scripts, context: initialContext() })
//   settings  createMachine(accountName, { scripts, context: loadedContext })
// with only the scripts registry (in-memory here, DB writes in the app) and the
// starting context differing.

const stamp = () => new Date().toISOString();

// The trust boundary of the whole flow: `event.patch` is whatever the form
// posted. `Object.assign` would apply a `__proto__` key through its setter,
// replacing the target's prototype instead of adding a property — and since
// every guard here asks `"answer" in config`, a request could then satisfy a
// question it never answered, with `Object.keys` still showing nothing. Own
// keys only, and never that one.
const merge = (target, patch = {}) => {
	for (const key of Object.keys(patch))
		if (key !== "__proto__") target[key] = patch[key];
	return target;
};

// ---------------------------------------------------------------- account ---

export const accountUsername = {
	initial: "username",
	states: {
		username: {
			on: { answer: { target: "username", actions: "patchAccount" } },
			go: [{ target: "done", cond: (ctx) => !!ctx.account.value }],
		},
		done: { type: "final" },
	},
};

// The WebAuthn ceremony owns the first page, so the credential is registered
// unnamed and labelled on the next one. Both are presence checks: keys created
// before the label step carry a default name and stay satisfied.
export const accountWebauthnPassKey = {
	initial: "credential",
	states: {
		credential: {
			on: { register: { target: "credential", actions: "addPasskey" } },
			go: [{ target: "name", cond: (ctx) => ctx.passkey.length > 0 }],
		},
		name: {
			on: { answer: { target: "name", actions: "namePasskey" } },
			go: [
				{ target: "done", cond: (ctx) => ctx.passkey.every((k) => !!k.name) },
			],
		},
		done: { type: "final" },
	},
};

// The only recovery channel for a passkey-only account, so it lands right after
// the passkey and deliberately BEFORE any second factor: a member who then can't
// produce the security key still has a way back in.
export const accountRecoveryCodes = {
	initial: "codes",
	states: {
		codes: {
			// Idempotent: the answer self-transition re-enters this state.
			onEntry: "generateRecoveryCodes",
			on: { acknowledge: { target: "codes", actions: "patchAccount" } },
			go: [
				{ target: "done", cond: (ctx) => !!ctx.account.recoveryCodesAckedAt },
			],
		},
		done: { type: "final" },
	},
};

// Second factor. Whether the flow asks for one is `mfaRequire`, and that lives on
// the transition INTO this machine, not in it — see accountOnboard. A section that
// skipped itself would still be entered, which puts it on the trail as a page Back
// could land on; and from settings you can always add a key, required or not.
export const accountWebauthnSecurityKey = {
	initial: "credential",
	states: {
		credential: {
			on: { register: { target: "credential", actions: "addSecurityKey" } },
			go: [{ target: "name", cond: (ctx) => ctx.securityKey.length > 0 }],
		},
		name: {
			on: { answer: { target: "name", actions: "nameSecurityKey" } },
			go: [
				{
					target: "done",
					cond: (ctx) => ctx.securityKey.every((k) => !!k.name),
				},
			],
		},
		done: { type: "final" },
	},
};

export const accountName = {
	initial: "name",
	states: {
		name: {
			on: { answer: { target: "name", actions: "patchAccount" } },
			go: [{ target: "done", cond: (ctx) => !!ctx.account.name }],
		},
		done: { type: "final" },
	},
};

// Captured, then proven. `emailCount` is the VERIFIED count, so the flow can't
// leave on an address nobody owns. Saving the address mails the code in the same
// action list — no separate state to resume into and accidentally re-send from.
export const accountEmailAddress = {
	initial: "address",
	states: {
		address: {
			on: {
				answer: {
					target: "address",
					actions: ["patchAccount", "sendEmailCode"],
				},
			},
			go: [{ target: "code", cond: (ctx) => !!ctx.account.emailAddress }],
		},
		code: {
			on: {
				answer: { target: "code", actions: "verifyEmailCode" },
				resend: { target: "code", actions: "sendEmailCode" },
			},
			go: [{ target: "done", cond: (ctx) => ctx.emailCount > 0 }],
		},
		done: { type: "final" },
	},
};

export const accountOnboard = {
	initial: "terms",
	states: {
		// The start page creates the account and records the agreement; everything
		// after it is an answer on that row.
		terms: {
			on: { agree: { target: "terms", actions: "createAccount" } },
			go: [{ target: "username", cond: (ctx) => !!ctx.account.termsAt }],
		},
		username: { ...accountUsername, onFinal: "passkey" },
		passkey: { ...accountWebauthnPassKey, onFinal: "recoveryCodes" },
		// The second factor comes AFTER the recovery codes on purpose: a member who
		// then can't produce the key still has a way back in. Adding it to the flow
		// re-opens finished accounts, which is how an admin turning mfaRequire on
		// reaches existing members.
		recoveryCodes: {
			...accountRecoveryCodes,
			onFinal: [
				{ target: "securityKey", cond: (ctx) => ctx.mfaRequire },
				{ target: "name" },
			],
		},
		securityKey: { ...accountWebauthnSecurityKey, onFinal: "name" },
		name: { ...accountName, onFinal: "emailAddress" },
		emailAddress: { ...accountEmailAddress, onFinal: "review" },
		review: {
			on: { confirm: { target: "review", actions: "patchAccount" } },
			go: [{ target: "invite", cond: (ctx) => !!ctx.account.reviewedAt }],
		},
		// A pending org invite short-circuits the fork that follows — offer to accept
		// it before asking whether to create an organization.
		invite: {
			on: { answer: { target: "invite", actions: "patch" } },
			go: [
				{
					target: "done",
					cond: (ctx) => !ctx.invites.length || "inviteAccepted" in ctx,
				},
			],
		},
		done: { type: "final" },
	},
};

// ----------------------------------------------------------- organization ---

// tardisec's three pages for every list question (billing emails, promo codes,
// collaborators): "add one?" → the row → review, looping until the user says no
// more or the list is full.
//
// `<key>Wanted` is how many rows the user has ASKED to enter; the add page rests
// until the list catches up. That's also what keeps the trail replayable — at
// rest the loop edge is closed (`length < Wanted` is false), so Back walks
// through the section in a straight line. Inside the loop it can only reach back
// to the first page, which is the honest answer: a repeated page has no single
// predecessor.
//
// `min` and `max` are build-time bounds:
//   min > 0   a required list has no "add one?" page at all — dropped here rather
//             than skipped by a guard, which would leave a phantom step on the
//             trail for Back to link to. It also can't finish empty.
//   max       caps what the flow will wait for, so at the limit the review page
//             drops the "add another?" question and only offers Continue.
export const listFlow = (key, { min = 0, max = 128 } = {}) => {
	if (min > max)
		throw new Error(`list "${key}": min ${min} is above max ${max}`);
	const wanted = (ctx) =>
		Math.min(Math.max(ctx[`${key}Wanted`] ?? 0, min), max);
	const full = (ctx) => ctx[key].length >= max;
	const states = {
		add: {
			// Keyed on the value, not appended blindly: a double-submitted form must
			// not enter the same address twice, and none of these lists wants
			// duplicates anyway.
			on: {
				add: {
					target: "add",
					actions: (ctx, e) => {
						if (!ctx[key].includes(e.value)) ctx[key].push(e.value);
					},
				},
			},
			go: [{ target: "review", cond: (ctx) => ctx[key].length >= wanted(ctx) }],
		},
		// The rows so far, plus "add another?" — until the list is full, when the
		// question drops off and Continue is the only answer left to give.
		review: {
			on: {
				answer: {
					target: "review",
					actions: (ctx, e) => {
						ctx[`${key}Another`] = e.value;
						if (e.value && !full(ctx))
							ctx[`${key}Wanted`] = ctx[key].length + 1;
						else ctx[`${key}At`] = stamp();
					},
				},
				// Dropping a row here falls back through to the add page, since the list
				// no longer covers what was asked for. Once Continue is pressed the
				// section is done and stops listening — editing the list after that is
				// the settings page running this same machine over the reloaded row.
				// By value, not by index. The review page stays active after a removal,
				// so an index-based splice deletes a DIFFERENT row when the request is
				// replayed — a double-clicked Remove drops two. Removing the same value
				// twice is a no-op.
				remove: {
					target: "review",
					actions: (ctx, e) => {
						const at = ctx[key].indexOf(e.value);
						if (at !== -1) ctx[key].splice(at, 1);
					},
				},
			},
			go: [
				{ target: "add", cond: (ctx) => ctx[key].length < wanted(ctx) },
				{ target: "done", cond: (ctx) => !!ctx[`${key}At`] },
			],
		},
		done: { type: "final" },
	};
	if (min > 0) return { initial: "add", states };
	return {
		initial: "required",
		states: {
			required: {
				on: {
					answer: {
						target: "required",
						actions: (ctx, e) => {
							ctx[`${key}Required`] = e.value;
							if (e.value) ctx[`${key}Wanted`] = 1;
							else ctx[`${key}At`] = stamp();
						},
					},
				},
				// Presence, not truthiness: "no" is an answer, and an empty list is a
				// legitimate one.
				go: [
					{ target: "add", cond: (ctx) => ctx[`${key}Required`] === true },
					{ target: "done", cond: (ctx) => ctx[`${key}Required`] === false },
				],
			},
			...states,
		},
	};
};

export const organizationName = {
	initial: "name",
	states: {
		name: {
			on: { answer: { target: "name", actions: "patchOrganization" } },
			go: [{ target: "done", cond: (ctx) => !!ctx.organization.name }],
		},
		done: { type: "final" },
	},
};

// Billing has to reach someone, so at least one address — no "would you like to
// add one?" page, because there is no "no" to give.
export const organizationBillingEmail = listFlow("billingEmail", {
	min: 1,
	max: 8,
});
// ORGANIZATION_PROMO_CODE_MAX in tardisec: at five the review page shows the
// limit note instead of the question.
export const organizationPromoCode = listFlow("promoCode", { max: 10 });
export const organizationCollaborator = listFlow("collaborator", { max: 128 });

// Both are pick-from-a-list answers where every option — including "none" and the
// platform default — is a real choice, so presence decides, not the value.
export const organizationRetention = {
	initial: "retention",
	states: {
		retention: {
			on: { answer: { target: "retention", actions: "patchOrganization" } },
			go: [{ target: "done", cond: (ctx) => "retention" in ctx.organization }],
		},
		done: { type: "final" },
	},
};

export const organizationCompliance = {
	initial: "compliance",
	states: {
		compliance: {
			on: { answer: { target: "compliance", actions: "patchOrganization" } },
			go: [{ target: "done", cond: (ctx) => "compliance" in ctx.organization }],
		},
		done: { type: "final" },
	},
};

export const organizationOnboard = {
	initial: "name",
	states: {
		name: { ...organizationName, onFinal: "billingEmail" },
		billingEmail: { ...organizationBillingEmail, onFinal: "promoCode" },
		promoCode: { ...organizationPromoCode, onFinal: "retention" },
		retention: { ...organizationRetention, onFinal: "compliance" },
		compliance: { ...organizationCompliance, onFinal: "collaborator" },
		collaborator: { ...organizationCollaborator, onFinal: "review" },
		review: {
			on: { confirm: { target: "review", actions: "patchOrganization" } },
			go: [{ target: "done", cond: (ctx) => !!ctx.organization.reviewedAt }],
		},
		done: { type: "final" },
	},
};

// ----------------------------------------------------------------- domain ---
//
// Domain steps run at two hosts: ownership is proven on the apex, the rest are
// the entered FQDN's. Context carries both configs so each state reads whichever
// level owns its answer — `apexConfig` is domain-wide, `fqdnConfig` per host.

// Proof can land on the apex (inherited apex DNS) or on the host itself, and the
// submit only stamps a request marker, so read every marker on both configs. A
// requestedAt-only check traps a domain that verified before the user got here.
export const domainVerify = {
	initial: "verify",
	states: {
		verify: {
			on: {
				request: { target: "verify", actions: "patchFqdn" },
				observed: { target: "verify", actions: "patchApex" },
			},
			go: [
				{
					target: "done",
					cond: (ctx) =>
						[ctx.apexConfig, ctx.fqdnConfig].some(
							(cfg) =>
								cfg.verifiedDns ||
								cfg.verifiedWellKnown ||
								cfg.verifyRequestedAt,
						),
				},
			],
		},
		done: { type: "final" },
	},
};

export const domainDeployment = {
	initial: "environment",
	states: {
		environment: {
			on: { answer: { target: "environment", actions: "patchFqdn" } },
			// The marker, not the value: hosts from before the enum carry the old
			// `production` key, and re-opening those is the point.
			go: [
				{
					// Only a non-production host declares a parent, and only a real host
					// (not the apex root "_") has an in-domain parent to point at.
					target: "parent",
					cond: (ctx) =>
						!!ctx.fqdnConfig.deploymentEnvironmentAt &&
						ctx.fqdnConfig.deploymentEnvironment !== "production" &&
						ctx.fqdn !== "_",
				},
				{
					target: "done",
					cond: (ctx) => !!ctx.fqdnConfig.deploymentEnvironmentAt,
				},
			],
		},
		parent: {
			on: { answer: { target: "parent", actions: "patchFqdn" } },
			go: [{ target: "done", cond: (ctx) => "parentFqdn" in ctx.fqdnConfig }],
		},
		done: { type: "final" },
	},
};

// Confirm which CAs may issue for this domain → the CAA `issue` allowlist. Asked
// ONCE per domain: the marker and the confirmed list live on the apex config, so
// every host under the domain skips it after the first. Whether it applies at all
// is `caaApplies`, on the transition in.
export const domainCaa = {
	initial: "issuers",
	states: {
		issuers: {
			on: { answer: { target: "issuers", actions: "patchApex" } },
			go: [
				{
					// RFC 8657 account pinning, only once Let's Encrypt is in the list.
					target: "accountUri",
					cond: (ctx) =>
						!!ctx.apexConfig.caaIssuersAt &&
						(ctx.apexConfig.caaIssuers ?? []).includes("letsencrypt.org"),
				},
				{ target: "done", cond: (ctx) => !!ctx.apexConfig.caaIssuersAt },
			],
		},
		accountUri: {
			// Optional: a blank submit still writes the key, so presence is the guard.
			on: { answer: { target: "accountUri", actions: "patchApex" } },
			go: [
				{ target: "done", cond: (ctx) => "caaAccountUri" in ctx.apexConfig },
			],
		},
		done: { type: "final" },
	},
};

// Report-Only ignores upgrade-insecure-requests, so it can't be trialled — this is
// a straight "is this host fully HTTPS?". Gated by presence of the answer itself:
// a separate marker could outlive it and leave the review page lying.
export const domainUpgradeInsecureRequests = {
	initial: "upgrade",
	states: {
		upgrade: {
			on: { answer: { target: "upgrade", actions: "patchFqdn" } },
			go: [
				{
					target: "done",
					cond: (ctx) => "upgradeInsecureRequests" in ctx.fqdnConfig,
				},
			],
		},
		done: { type: "final" },
	},
};

// Per-host (a subdomain may serve assets differently than the apex) but pre-filled
// from the org → apex → default cascade, so the user confirms rather than answers
// cold. The prefill is a page concern; the machine only cares that it was decided.
export const domainCrossOriginAssets = {
	initial: "assets",
	states: {
		assets: {
			on: { answer: { target: "assets", actions: "patchFqdn" } },
			go: [
				{
					target: "done",
					cond: (ctx) => "crossOriginAssets" in ctx.fqdnConfig,
				},
			],
		},
		done: { type: "final" },
	},
};

// How this host receives its recommended config: a CI binding or manual. Gated on
// THIS host's own answer — the binding is domain-wide, so reading the apex would
// drag a "manual" host into a sibling's setup page. `setupComplete` keeps hosts
// that graduated before these states existed closed.
export const domainIntegration = {
	initial: "provider",
	states: {
		provider: {
			on: { answer: { target: "provider", actions: "patchFqdn" } },
			go: [
				{
					target: "setup",
					cond: (ctx) =>
						!!ctx.fqdnConfig.integrationAt &&
						ctx.fqdnConfig.integration !== "manual",
				},
				{
					target: "done",
					cond: (ctx) =>
						!!(ctx.fqdnConfig.integrationAt || ctx.fqdnConfig.setupComplete),
				},
			],
		},
		setup: {
			on: { acknowledge: { target: "setup", actions: "patchFqdn" } },
			go: [
				{
					target: "done",
					cond: (ctx) =>
						!!(
							ctx.fqdnConfig.integrationSetupAckedAt ||
							ctx.fqdnConfig.setupComplete
						),
				},
			],
		},
		done: { type: "final" },
	},
};

// Which sections this host gets at all. Named once here because every transition
// that can land on a skippable section has to route around it.
//   caa   an alternate root has no DNS and no CA, a PSL private suffix's zone
//         belongs to the provider, and a parent zone that already publishes CAA is
//         inherited (RFC 8659 §3) — in each case there is no record to publish.
//   uir   a Tor hidden service is plain http on a virtual port and the circuit
//         already provides what TLS would, so upgrading has no answer.
const caaApplies = (ctx) =>
	ctx.network === "clearnet" && !ctx.apexPrivateSuffix && !ctx.parentCaa;
const uirApplies = (ctx) => ctx.network !== "onion";

export const domainOnboard = {
	initial: "verify",
	states: {
		verify: { ...domainVerify, onFinal: "deployment" },
		deployment: {
			...domainDeployment,
			onFinal: [
				{ target: "caa", cond: caaApplies },
				{ target: "upgradeInsecureRequests", cond: uirApplies },
				{ target: "crossOriginAssets" },
			],
		},
		caa: {
			...domainCaa,
			onFinal: [
				{ target: "upgradeInsecureRequests", cond: uirApplies },
				{ target: "crossOriginAssets" },
			],
		},
		upgradeInsecureRequests: {
			...domainUpgradeInsecureRequests,
			onFinal: "crossOriginAssets",
		},
		crossOriginAssets: { ...domainCrossOriginAssets, onFinal: "integration" },
		integration: { ...domainIntegration, onFinal: "review" },
		review: {
			on: { confirm: { target: "review", actions: "patchFqdn" } },
			go: [
				{
					target: "reportOnly",
					cond: (ctx) =>
						!!(ctx.fqdnConfig.reviewedAt || ctx.fqdnConfig.setupComplete),
				},
			],
		},
		// Terminal and BLOCKING: nothing the user clicks satisfies this. Until the
		// report-only headers and reporting DNS are deployed no violation reports
		// flow, so the flow waits for a scan to observe them.
		reportOnly: {
			on: { scan: { target: "reportOnly", actions: "patchFqdn" } },
			go: [{ target: "done", cond: (ctx) => !!ctx.fqdnConfig.setupComplete }],
		},
		done: { type: "final" },
	},
};

// ---------------------------------------------------------------- onboard ---

export const onboard = {
	initial: "account",
	states: {
		account: { ...accountOnboard, onFinal: "organizationFork" },
		// tardisec asks these two on the account flow's last pages; here they are the
		// branch points themselves, so no section has to ask a question that another
		// section might already have answered.
		organizationFork: {
			on: { answer: { target: "organizationFork", actions: "patch" } },
			go: [
				{
					target: "organization",
					cond: (ctx) => ctx.createOrganization === true,
				},
				{
					target: "domainFork",
					cond: (ctx) => ctx.createOrganization === false,
				},
			],
		},
		organization: { ...organizationOnboard, onFinal: "domainFork" },
		domainFork: {
			on: { answer: { target: "domainFork", actions: "patch" } },
			go: [
				{ target: "domain", cond: (ctx) => ctx.createDomain === true },
				{ target: "done", cond: (ctx) => ctx.createDomain === false },
			],
		},
		domain: { ...domainOnboard, onFinal: "done" },
		done: { type: "final" },
	},
};

// A factory, not a literal: the machine mutates it, and the nested objects would
// otherwise be shared between every machine built from this definition.
export const initialContext = () => ({
	// account
	account: {}, // value = username (encrypted column), name, and the At markers
	passkey: [],
	securityKey: [],
	recoveryCodesCount: 0,
	emailCount: 0, // verified only
	mfaRequire: false,
	invites: [],
	// organization
	organization: {},
	billingEmail: [],
	promoCode: [],
	collaborator: [],
	// domain
	domain: null,
	fqdn: "_", // "_" = apex host
	network: "clearnet",
	apexConfig: {}, // domain-wide: verify markers, CAA
	fqdnConfig: {}, // per host: environment, assets, integration, setupComplete
	apexPrivateSuffix: false,
	parentCaa: false,
});

// The port every state writes through. In-memory here; in the app these are the
// server actions that write the row and stamp the markers — the definitions above
// don't change between the two.
export const scripts = {
	patch: (ctx, e) => merge(ctx, e.patch),
	patchAccount: (ctx, e) => merge(ctx.account, e.patch),
	patchOrganization: (ctx, e) => merge(ctx.organization, e.patch),
	patchApex: (ctx, e) => merge(ctx.apexConfig, e.patch),
	patchFqdn: (ctx, e) => merge(ctx.fqdnConfig, e.patch),

	createAccount: (ctx) => (ctx.account.termsAt = stamp()),
	addPasskey: (ctx, e) => ctx.passkey.push({ id: e.id }),
	namePasskey: (ctx, e) => {
		for (const k of ctx.passkey) k.name ??= e.name;
	},
	addSecurityKey: (ctx, e) => ctx.securityKey.push({ id: e.id }),
	nameSecurityKey: (ctx, e) => {
		for (const k of ctx.securityKey) k.name ??= e.name;
	},
	generateRecoveryCodes: (ctx) => {
		if (!ctx.recoveryCodesCount) ctx.recoveryCodesCount = 5;
	},
	sendEmailCode: (ctx) => (ctx.account.emailCodeSentAt = stamp()),
	// Stand-in for "the emailed code matched": only a verified address counts.
	verifyEmailCode: (ctx, e) => {
		if (e.code === "000000") ctx.emailCount += 1;
	},
};
