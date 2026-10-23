---
title: core
description: The engine. createMachine, assign, toPath, toValue. No dependencies, ESM only, Node 20+.
---

The engine. No dependencies.

## Install

```bash
npm install @1state/core
```

## Exports

| Export                            | What                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `createMachine(definition, opts)` | compiles a definition and returns a machine.            |
| `assign(updates)`                 | builds an action that writes keys onto the context.     |
| `toPath(value)`                   | a state value as URL segments.                          |
| `toValue(segments)`               | the reverse of `toPath`.                                |

Types ship in `index.d.ts`. See [API](/docs/reference/api) for the full surface
and [Definition](/docs/reference/definition) for the shape it compiles.

## createMachine

```javascript
import { createMachine, assign } from '@1state/core'

const machine = createMachine(signup, {
  scripts: { saveEmail: (ctx, e) => db.account.update(ctx.id, { email: e.value }) },
  context: await load(accountId),
})

await machine.start()
```

Compilation is eager: bad targets, missing `initial`s and unknown script names
throw from `createMachine`, not from the first `send()` that reaches them.

## Machine

```javascript
await machine.start(event?)        // enter, settle, resolve to the state
await machine.send(type, payload?) // process an event, settle, resolve
await machine.back(event?)         // previous step on the trail; does not settle
await machine.path()               // ["profile.name", "billing.card"]
await machine.route(segments)      // { target, prev }
machine.state()                    // { value, context, done }, synchronous
```

## assign

```javascript
on: {
  answer: {
    target: 'email',
    actions: assign({ email: (_ctx, event) => event.value }),
  },
},
```

Values may be static or `(context, event)` functions. A function is always
called, so there is no way to assign a function as a value.

## toPath / toValue

```javascript
import { toPath, toValue } from '@1state/core'

toPath({ profile: 'name' })   // ["profile", "name"]
toValue(['profile', 'name'])  // { profile: "name" }
```

Series-only, like `path()` and `back()`. Do not feed `toValue(segments)` into
`options.state` — see [URLs](/docs/concepts/urls).

## Performance

`npm run perf --workspace @1state/core` runs the benchmark suite in
`index.bench.js`.

The test suite is held at 100% line, branch and function coverage by the package's
own `test` script, and the repository runs mutation testing over it with Stryker.
