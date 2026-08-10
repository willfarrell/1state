---
title: Limits
description: What 1state does not do — series-only replay, no history states, external transitions only, one-shot invoke, no scheduler.
---

## path() and back() are for series flows

They replay `go` guards and `onFinal` hand-offs forward from the initial state. A
parallel region has no single predecessor, and event-driven jumps and loops are
not replayable.

When the replay cannot reach the current state, `path()` returns just that state
and `back()` stays put.

`toPath`/`toValue` are series-only for the same reason — give each region its own
segments if you need URLs over a parallel state.

## No history states

Re-entering a compound state goes to its `initial`.

## Transitions are always external

Targeting the state you are in exits and re-enters it, running `onExit` then
`onEntry`. There is no internal-transition flag.

This is what makes the self-transition idiom re-run guards, and it means `onEntry`
must be idempotent.

```javascript
codes: {
  // idempotent: the answer self-transition re-enters this state
  onEntry: 'generateRecoveryCodes',
  on: { acknowledge: { target: 'codes', actions: 'patchAccount' } },
  go: [{ target: 'done', cond: (ctx) => !!ctx.account.recoveryCodesAckedAt }],
},
```

## Event names match exactly

No SCXML wildcards, no `error.*` prefixes.

## invoke is a one-shot promise, not a concurrent session

`src` is awaited inline while the machine settles. No actors, no spawning, no
cancellation. It re-runs every time its state is entered.

## No delayed transitions and no scheduler

Nothing happens between calls.

## Non-settling machines throw

A machine whose eventless transitions never settle throws after 1000 microsteps
rather than hanging.
