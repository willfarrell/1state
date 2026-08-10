---
title: Quick Start
description: Install 1state, write a two-question flow, and resume it from a stored row.
---

## Install

```bash
npm install @1state/core
npm install --save-dev @1state/validate @1state/mermaid
```

Node 20+. ESM only — there is no CommonJS build.

## A flow is an object

One state per question. An event records the answer as a self-transition, and a
`go` guard leaves once the answer is on the context.

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
```

`answer` targets the state it fires in. The state exits and re-enters, so its
`go` guards run again against the answer that was just recorded.

## Run it

```javascript
const machine = createMachine(signup)

await machine.start()
// { value: "email", context: { email: null, password: null }, done: false }

await machine.send('answer', { value: 'a@example.org' })
// { value: "password", ... }

await machine.path()
// ["email", "password"]

await machine.send('answer', { value: 'hunter2' })
// { value: "done", done: true }
```

`start()` enters `email`, retries its `go` transitions, finds the guard closed,
and stops. That is where the user is.

## Resume it

Load the stored answers into `context` and start. Nothing else.

```javascript
const resumed = createMachine(signup, { context: { email: 'a@example.org' } })
await resumed.start() // value: "password"
```

There was no cursor to load. `start()` entered `email`, found its guard open,
moved to `password`, found that guard closed, and stopped.

## Write through named scripts

Inline functions are fine in a test. In an application, name the actions in the
definition and point them at your database through `options.scripts`, so the
definition does not change between the two.

```javascript
const machine = createMachine(signup, {
  scripts: {
    saveEmail: (ctx, e) => db.account.update(ctx.id, { email: e.value }),
  },
  context: await load(accountId),
})
```

A script is a function `(context, event)` — sync or async — or the name of one in
`options.scripts`.

## Check it

```bash
npx 1state-validate signup.js
npx 1state-mermaid --title 'Signup' signup.js > SIGNUP.md
```

`1state-validate` runs a JSON Schema pass, a reachability pass and a compile
through the engine, and reports everything at once. `1state-mermaid --check` fails
when a committed diagram no longer matches its machine, which is what makes it a
CI job.

## Next

Read [Derived position](/docs/concepts/derived-position). It is one page, it is
the whole model, and the rule at the bottom of it is the one mistake worth
avoiding.
