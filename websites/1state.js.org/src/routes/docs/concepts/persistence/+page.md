---
title: Persistence
description: There is no persistence adapter, deliberately. There is no machine state to persist — the answers are your row.
---

## There is no persistence adapter

Deliberately. There is no machine state to persist.

The position is derived from the answers, and the answers are your row. Persist
the row — which you were going to do anyway — and you are done. To resume, build
the machine with `context` loaded from it and call `start()`.

```javascript
const machine = createMachine(onboard, { scripts, context: await load(accountId) })
await machine.start() // exactly where they left off
```

## Writes belong in actions

Name them in the definition and point them at your database through
`options.scripts`; the definition does not change between an in-memory test and
production.

```javascript
createMachine(onboard, {
  scripts: { patchAccount: (ctx, e) => db.account.update(ctx.id, e.patch) },
  context,
})
```

A script is a function `(context, event)` — sync or async — or the name of one in
`options.scripts`. The engine awaits the result.

## Why a snapshot would be worse

An adapter that snapshotted the machine would be strictly worse:

- the snapshot can disagree with the row,
- it goes stale the moment an answer changes,
- and it pins users to the version of the flow that was live when they started —
  which is exactly the forward migration you wanted.

## options.state

`options.state` does exist, for genuinely non-derivable positions. It lands on the
stored value without running entry actions and without settling, so a resume
cannot re-fire an `invoke`.

Do not reach for it to make a wizard resume; that is free.

```javascript
// only for a position the answers cannot reproduce
createMachine(flow, { state: { region: 'step' } })
```

## Context is mutated, and merged shallowly

`options.context` is merged over `definition.context`, shallowly, and the machine
mutates its context.

If `definition.context` holds nested objects, build it with a factory instead —
otherwise every machine compiled from that definition shares them.

```javascript
export const initialContext = () => ({
  account: {},
  passkey: [],
  emailCount: 0,
})
```
