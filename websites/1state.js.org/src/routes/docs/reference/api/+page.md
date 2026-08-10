---
title: API
description: createMachine, its options, the six methods a running machine exposes, and the helpers.
---

```javascript
const machine = createMachine(definition, options)
```

## Options

| Option         | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `scripts`      | name → function, for string references in the definition.        |
| `context`      | merged over `definition.context`, shallowly.                     |
| `state`        | a stored value to restore instead of entering and settling.      |
| `onSend`       | `(event)` before an event is processed.                          |
| `onTransition` | `(state)` after `start`, `send` and `back`.                      |
| `onChange`     | `({...context}, event)` after a transition that carried actions. |
| `onFinal`      | `(state)` when the root reaches `final`.                         |

The merge is shallow, and the machine mutates its context. If
`definition.context` holds nested objects, build it with a factory instead —
otherwise every machine compiled from that definition shares them.

## Methods

| Method                 | Returns                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `start(event?)`        | enters the initial state, settles, resolves to the state.              |
| `send(type, payload?)` | processes an event, settles, resolves to the state.                    |
| `back(event?)`         | moves to the previous step on the trail. Deliberately does not settle. |
| `path()`               | the trail as dotted ids, e.g. `["profile.name", "billing.card"]`.      |
| `route(segments)`      | `{ target, prev }`.                                                    |
| `state()`              | `{ value, context, done }`. Synchronous.                               |

Everything except `state()` is async. `start()` is idempotent. `send()` before
`start()` throws.

`back()` does not settle on purpose: settling from the previous step would walk
straight forward again, because the answer that opened the guard is still there.

## State value

A snapshot is `{ value, context, done }`. `value` follows the xstate convention:
`"idle"`, `{ parent: "child" }`, `{ region: { a: "x", b: "y" } }`.

`state()` called before `start()` reports `undefined` for `value`.

## Helpers

### assign(updates)

Builds an action from an object of values or `(context, event)` functions.

```javascript
assign({ email: (_ctx, event) => event.value })
```

### toPath(value) / toValue(segments)

```javascript
toPath({ profile: 'name' })   // ["profile", "name"]
toValue(['profile', 'name'])  // { profile: "name" }
```

Series-only. See [URLs](/docs/concepts/urls).

## Errors

The engine throws rather than degrading, at compile time where it can:

- `target "x" not found from "y"` — a transition points at nothing reachable.
- `state "x" has child states but no initial` — a compound state without an entry.
- `parallel state "x" has no regions`
- `script "x" is not a function` — a name with no `options.scripts` entry.
- `call start() before send()`
- `microstep limit reached: machine has a transition loop` — 1000 microsteps
  without settling.

`@1state/validate` reports the first group of these, plus schema and reachability
problems, without running the flow.
