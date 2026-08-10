---
title: Onboarding wizard
description: A real composed flow — account, organization and domain sections chained by onFinal, with a reusable list sub-flow and a blocking terminal state.
---

`examples/onboard.js` in the repository is one onboarding wizard built from
twenty-odd sections. `examples/ONBOARD.md` is what `1state-mermaid` renders it to,
and `examples/onboard.test.js` runs it.

Every export is a self-contained series machine: one state per question, an event
that records the answer as a self-transition, and a `go` guard that leaves once
the answer is on the context.

## A section

```javascript
export const accountName = {
  initial: 'name',
  states: {
    name: {
      on: { answer: { target: 'name', actions: 'patchAccount' } },
      go: [{ target: 'done', cond: (ctx) => !!ctx.account.name }],
    },
    done: { type: 'final' },
  },
}
```

Actions are named, not inline. `patchAccount` is in-memory in the example and a
database write in the application; the definition is the same object either way.

## Chaining

```javascript
export const accountOnboard = {
  initial: 'terms',
  states: {
    terms: {
      on: { agree: { target: 'terms', actions: 'createAccount' } },
      go: [{ target: 'username', cond: (ctx) => !!ctx.account.termsAt }],
    },
    username: { ...accountUsername, onFinal: 'passkey' },
    passkey: { ...accountWebauthnPassKey, onFinal: 'recoveryCodes' },
    recoveryCodes: {
      ...accountRecoveryCodes,
      onFinal: [
        { target: 'securityKey', cond: (ctx) => ctx.mfaRequire },
        { target: 'name' },
      ],
    },
    securityKey: { ...accountWebauthnSecurityKey, onFinal: 'name' },
    name: { ...accountName, onFinal: 'emailAddress' },
    // ...
  },
}
```

Whether the flow asks for a second factor is `mfaRequire`, and it lives on the
transition **into** `securityKey`, not inside it. A section that skipped itself
with an internal guard would still be entered, which would put it on the trail as
a page Back could land on.

Adding the second factor to the flow re-opens finished accounts, which is how an
admin turning `mfaRequire` on reaches existing members. That is forward migration
doing its job.

## Presence, not truthiness

```javascript
export const organizationRetention = {
  initial: 'retention',
  states: {
    retention: {
      on: { answer: { target: 'retention', actions: 'patchOrganization' } },
      go: [{ target: 'done', cond: (ctx) => 'retention' in ctx.organization }],
    },
    done: { type: 'final' },
  },
}
```

Every option — including "none" and the platform default — is a real choice, so
presence decides, not the value. Answers that genuinely cannot be told apart from
their default get an `At` marker instead, and the guard reads that.

## A list sub-flow

`listFlow(key, { min, max })` builds the three pages every list question needs:
"add one?", the row, and review — looping until the user says no more or the list
is full.

```javascript
export const organizationBillingEmail = listFlow('billingEmail', { min: 1, max: 8 })
export const organizationPromoCode = listFlow('promoCode', { max: 10 })
export const organizationCollaborator = listFlow('collaborator', { max: 128 })
```

`<key>Wanted` is how many rows the user has **asked** to enter; the add page rests
until the list catches up. At rest the loop edge is closed, which is what keeps the
trail replayable: Back walks the section in a straight line. Inside the loop it can
only reach back to the first page, which is the honest answer — a repeated page has
no single predecessor.

`min > 0` drops the "add one?" page entirely rather than guarding it away, because
a skipped page would leave a phantom step on the trail for Back to link to.

## The events are a trust boundary

```javascript
const merge = (target, patch = {}) => {
  for (const key of Object.keys(patch))
    if (key !== '__proto__') target[key] = patch[key]
  return target
}
```

`event.patch` is whatever the form posted. `Object.assign` would apply a
`__proto__` key through its setter, replacing the target's prototype instead of
adding a property — and since every guard here asks `"answer" in config`, a
request could then satisfy a question it never answered, with `Object.keys` still
showing nothing.

Own keys only, and never that one. Presence guards make this the one place in the
flow where input sanitising is not optional.

## A terminal state that waits

```javascript
reportOnly: {
  on: { scan: { target: 'reportOnly', actions: 'patchFqdn' } },
  go: [{ target: 'done', cond: (ctx) => !!ctx.fqdnConfig.setupComplete }],
},
```

Blocking on purpose: nothing the user clicks satisfies it. The flow waits for an
external scan to observe the deployed configuration, and the guard reads what the
scan wrote. No scheduler, no polling inside the machine — the next `send` comes
from whatever observed the world.

## Two entry points

```javascript
createMachine(onboard, { scripts, context: initialContext() })     // the wizard
createMachine(accountName, { scripts, context: loadedContext })    // /settings/name
```

No sub-machine names its successor, so the same definitions drive both. Only the
starting context and the script registry differ.

`initialContext` is a factory, not a literal: the machine mutates it, and the
nested objects would otherwise be shared between every machine built from the
definition.
