---
title: Introduction
description: A small finite state machine for JavaScript, shaped after SCXML. No dependencies. ESM only.
slug: /
---

## What is 1state

A small finite state machine for JavaScript, shaped after
[SCXML](https://www.w3.org/TR/scxml/). No dependencies. ESM only.

It exists for multi-step forms: flows where the next question depends on the
answers already given, where the user leaves halfway through, and where the flow
gains a step while they are away.

Three packages:

| Package            | What                                         |
| ------------------ | -------------------------------------------- |
| `@1state/core`     | the engine                                   |
| `@1state/validate` | static checks for a definition, plus a CLI   |
| `@1state/mermaid`  | render a definition as a diagram, plus a CLI |

Node 20+.

## A quick example

```javascript
import { createMachine, assign } from '@1state/core'

const signup = {
  context: { email: null, password: null },
  initial: 'email',
  states: {
    email: {
      on: {
        answer: { target: 'email', actions: assign({ email: (_ctx, e) => e.value }) },
      },
      go: [{ target: 'password', cond: (ctx) => ctx.email !== null }],
    },
    password: {
      on: {
        answer: { target: 'password', actions: assign({ password: (_ctx, e) => e.value }) },
      },
      go: [{ target: 'done', cond: (ctx) => ctx.password !== null }],
    },
    done: { type: 'final' },
  },
}

const machine = createMachine(signup)

await machine.start() // { value: "email", context: {...}, done: false }
await machine.send('answer', { value: 'a@example.org' }) // value: "password"
await machine.path() // ["email", "password"]
await machine.send('answer', { value: 'hunter2' }) // done: true
```

## Two things carry the model

`on` records an answer as a **self-transition**: the state exits and re-enters,
so its guards run again.

`go` is **eventless**: after every step the machine retries the `go` transitions
of whatever is active, and keeps going until nothing opens. Where it stops is
where the user is.

Everything else on the site follows from those two, and from the property they
produce.

## Position is derived, never stored

Nothing anywhere records "the user is on step 3". The position is a pure function
of the answers, recomputed from the initial state on every `start()`. Guards read
the data.

```javascript
const resumed = createMachine(signup, { context: { email: 'a@example.org' } })
await resumed.start() // value: "password"
```

No cursor was loaded. That one property buys resume, no skip-ahead and forward
migration — three features that are otherwise three implementations. See
[Derived position](/docs/concepts/derived-position).

## Next steps

- [Quick Start](/docs/quick-start) — install and write a flow.
- [Derived position](/docs/concepts/derived-position) — the central idea, and the
  rule guards have to follow to keep it.
- [Composition](/docs/concepts/composition) — sections, `onFinal`, and two entry
  points from one definition.
- [URLs](/docs/concepts/urls) — the node id is the path, and `route()` is the
  whole page contract.
- [Limits](/docs/concepts/limits) — what this does not do.
