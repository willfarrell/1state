---
title: Composition
description: A section is a machine that ends in final and names no successor. onFinal chains them, and it belongs to the composing flow.
---

A section is a self-contained machine that ends in a `final` state and names no
successor. Chain sections with spread:

```javascript
const section = (key) => ({
  initial: key,
  states: {
    [key]: {
      on: { answer: { target: key, actions: assign({ [key]: (_c, e) => e.value }) } },
      go: [{ target: 'done', cond: (ctx) => ctx[key] !== undefined }],
    },
    done: { type: 'final' },
  },
})

const profile = section('name')
const billing = section('card')

const wizard = {
  initial: 'profile',
  states: {
    profile: { ...profile, onFinal: 'billing' },
    billing: { ...billing, onFinal: 'review' },
    review: { type: 'final' },
  },
}
```

`onFinal` fires when a state's subtree reaches `final`, and it belongs to the
composing flow, not the section.

## Two entry points, one definition

Because no section names its own successor, the same definition drives the wizard
and the standalone page:

```javascript
createMachine(wizard)                              // the wizard
createMachine(billing, { context: loadedFromRow }) // /settings/billing
```

Only the starting context differs — and, once actions are named rather than
inline, the script registry. The settings page closes immediately when the answer
is already on the row, which is the same settling rule doing the same thing at a
different entry point.

## Applicability lives on the transition in

**Applicability lives on the transition into a section, never inside it.**

```javascript
profile: {
  ...profile,
  onFinal: [
    { target: 'billing', cond: (ctx) => ctx.needsBilling },
    { target: 'review' },
  ],
},
```

A section that skipped itself with an internal guard would still be *entered*,
which puts it on the trail as a page Back can land on. Routed around, it is never
visited at all.

It also keeps the section usable standalone — from settings you can open a section
the wizard skipped.

## Transition lists

A transition is `"target"`, `{ target, cond, actions }`, or a list tried in order.
The first whose `cond` passes wins, and no match means stay put. So the list above
reads as: billing if it applies, otherwise review.

A target resolves against the source's siblings, then outward through each
ancestor's children, so `"done"` and `"billing.done"` both work from anywhere.

## A worked example

`examples/onboard.js` in the repository composes twenty-odd sections into one
onboarding wizard, with sections that route around each other, a list sub-flow
used three times, and a terminal state that waits on an external scan. See
[Onboarding wizard](/docs/examples/onboarding).
