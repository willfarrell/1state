---
title: Definition
description: Every key a state can carry, how transitions resolve, and what counts as a script.
---

A definition is a plain object. So is every state inside it — which is why
composition is a spread.

## Keys

| Key       | Meaning                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| `type`    | `compound` \| `parallel` \| `atomic` \| `final`. Inferred from `states` if absent. |
| `initial` | a direct child's name, or `{ target, actions }`. Required on compound.             |
| `states`  | child states, keyed by name. The key is the URL segment.                           |
| `context` | root only. `options.context` is merged over it.                                    |
| `on`      | `{ event: transitions }`. Unhandled events bubble to ancestors.                    |
| `go`      | eventless transitions, retried until none opens.                                   |
| `onEntry` | script or list, run on entering.                                                   |
| `onExit`  | script or list, run on leaving.                                                    |
| `onFinal` | transitions taken when this state's subtree reaches `final`.                       |
| `invoke`  | `{ src, onSuccess, onError }`. `src` is awaited on entry.                          |

## Transitions

A transition is `"target"`, `{ target, cond, actions }`, or a list tried in order —
the first whose `cond` passes wins, and no match means stay put.

```javascript
go: 'done'
go: { target: 'done', cond: (ctx) => 'answer' in ctx }
go: [
  { target: 'detail', cond: (ctx) => ctx.wantsDetail === true },
  { target: 'done', cond: (ctx) => ctx.wantsDetail === false },
]
```

A target resolves against the source's siblings, then outward through each
ancestor's children, so `"done"` and `"billing.done"` both work from anywhere.

`actions` run after exiting the source and before entering the target.

## Scripts

A script is a function `(context, event)` — sync or async — or the name of one in
`options.scripts`. The engine awaits the result: an action's is discarded, a
guard's is read for truthiness, and an invoke's arrives as `event.data`.

Naming scripts rather than inlining them is what lets one definition run against
an in-memory registry in a test and a database in production. It is also what
`1state-mermaid` draws as edge labels — an inline closure is plumbing, a named
script is a port.

## invoke

```javascript
lookup: {
  invoke: {
    src: 'fetchProfile',
    onSuccess: { target: 'confirm', actions: assign({ profile: (_c, e) => e.data }) },
    onError: 'manual',
  },
},
```

`src` is awaited inline while the machine settles. `event.data` carries what it
resolved to, `event.error` what it threw. It re-runs every time its state is
entered — see [Limits](/docs/concepts/limits).

## assign

```javascript
assign({
  email: (_ctx, event) => event.value,
  reviewedAt: new Date().toISOString(),
})
```

`assign(updates)` builds an action from an object of values or `(context, event)`
functions. There is no way to assign a function: one is always called.

## Types

`@1state/core` ships `index.d.ts`. `Context` is inferred from
`definition.context`, or failing that from `options.context`, and an explicit
`createMachine<Context>(...)` takes over when neither is a literal.

A definition held in its own `const` needs `satisfies MachineDefinition`, or an
annotation: `type: "final"` widens to `string` otherwise, and `string` is not one
of the four state types.

```typescript
const flow = {
  initial: 'a',
  states: { a: { go: 'done' }, done: { type: 'final' } },
} satisfies MachineDefinition
```
