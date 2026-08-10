# 1state

A small finite state machine for JavaScript, shaped after [SCXML](https://www.w3.org/TR/scxml/).
No dependencies. ESM only.

It exists for multi-step forms: flows where the next question depends on the
answers already given, where the user leaves halfway through, and where the flow
gains a step while they are away.

Three packages:

| Package            | What                                            |
| ------------------ | ----------------------------------------------- |
| `@1state/core`     | the engine                                      |
| `@1state/validate` | static checks for a definition, plus a CLI      |
| `@1state/mermaid`  | render a definition as a diagram, plus a CLI    |

## Install

```sh
npm install @1state/core
npm install --save-dev @1state/validate @1state/mermaid
```

Node 20+.

## Example

```js
import { createMachine, assign } from "@1state/core";

const signup = {
  context: { email: null, password: null },
  initial: "email",
  states: {
    email: {
      on: {
        answer: { target: "email", actions: assign({ email: (_ctx, e) => e.value }) },
      },
      go: [{ target: "password", cond: (ctx) => ctx.email !== null }],
    },
    password: {
      on: {
        answer: { target: "password", actions: assign({ password: (_ctx, e) => e.value }) },
      },
      go: [{ target: "done", cond: (ctx) => ctx.password !== null }],
    },
    done: { type: "final" },
  },
};

const machine = createMachine(signup);

await machine.start(); // { value: "email", context: {...}, done: false }
await machine.send("answer", { value: "a@example.org" }); // value: "password"
await machine.path(); // ["email", "password"]
await machine.send("answer", { value: "hunter2" }); // done: true
```

Two things carry the whole model. `on` records an answer as a **self-transition**:
the state exits and re-enters, so its guards run again. `go` is **eventless**: after
every step the machine retries the `go` transitions of whatever is active, and
keeps going until nothing opens. Where it stops is where the user is.

## Position is derived, never stored

Nothing anywhere records "the user is on step 3". The position is a pure function
of the answers, recomputed from the initial state on every `start()`. Guards read
the data.

```js
const resumed = createMachine(signup, { context: { email: "a@example.org" } });
await resumed.start(); // value: "password"
```

No cursor was loaded. `start()` entered `email`, found its guard open, moved to
`password`, found that guard closed, and stopped. That one property buys three
things that are otherwise separate features:

- **Resume.** Load the row into `context`, start, land on the first gap.
- **No skip-ahead.** A later state is unreachable until its predecessors' guards
  pass. There is no cursor to forge, because there is no cursor.
- **Forward migration.** Add a state and every already-"complete" record re-opens
  at it. Turning on a policy that inserts a step is how you reach users who
  finished last year.

The corollary is that guards must read the **answer**, not a marker of progress:

```js
go: [{ target: "done", cond: (ctx) => "newsletter" in ctx }]; // yes
go: [{ target: "done", cond: (ctx) => ctx.newsletter }];      // no — "no" reads as unanswered
```

Test for presence (`in`, `=== false`), not truthiness. `false`, `0` and `""` are
answers. Where an answer genuinely cannot be told apart from its default, write a
separate `answeredAt` marker and guard on that.

## Composition

A section is a self-contained machine that ends in a `final` state and names no
successor. Chain sections with spread:

```js
const section = (key) => ({
  initial: key,
  states: {
    [key]: {
      on: { answer: { target: key, actions: assign({ [key]: (_c, e) => e.value }) } },
      go: [{ target: "done", cond: (ctx) => ctx[key] !== undefined }],
    },
    done: { type: "final" },
  },
});

const profile = section("name");
const billing = section("card");

const wizard = {
  initial: "profile",
  states: {
    profile: { ...profile, onFinal: "billing" },
    billing: { ...billing, onFinal: "review" },
    review: { type: "final" },
  },
};
```

`onFinal` fires when a state's subtree reaches `final`, and it belongs to the
composing flow, not the section. So the same definition drives two entry points:

```js
createMachine(wizard);                              // the wizard
createMachine(billing, { context: loadedFromRow }); // /settings/billing
```

Only the starting context differs — and, once actions are named rather than
inline, the script registry. The settings page closes immediately when the answer
is already on the row.

**Applicability lives on the transition into a section, never inside it.**

```js
profile: {
  ...profile,
  onFinal: [
    { target: "billing", cond: (ctx) => ctx.needsBilling },
    { target: "review" },
  ],
},
```

A section that skipped itself with an internal guard would still be *entered*,
which puts it on the trail as a page Back can land on. Routed around, it is never
visited at all. It also keeps the section usable standalone — from settings you
can open a section the wizard skipped.

## URLs

The node id **is** the URL path. `profile.name` ⇄ `/profile/name`. No route table.

```js
import { toPath, toValue } from "@1state/core";

toPath({ profile: "name" }); // ["profile", "name"]
toValue(["profile", "name"]); // { profile: "name" }
```

`route(segments)` gives a step page everything it needs off one replay of the
trail:

```js
await machine.route(["billing", "card"]); // { target: null, prev: ["profile", "name"] }
await machine.route(["profile", "name"]); // { target: null, prev: null }
await machine.route(["review"]);          // { target: ["billing", "card"], prev: null }
```

- `target` — `null` means allow. Otherwise redirect there. The current step and
  any earlier one are allowed; that is back-navigation and re-editing. Unknown,
  off-flow or ahead bounces to current.
- `prev` — the Back link for the **requested** step, not for the current one.
  Re-editing an earlier answer has to go back to what preceded *it*. `null` on the
  first step, and while redirecting.

Change an earlier answer and both change with it, because both come from the same
replay.

> **Never restore from the URL.** Do not feed `toValue(segments)` into
> `options.state`. Settling from context is the entire no-skip-ahead guarantee; a
> typed URL that restores directly walks straight past it.

## Definition

| Key       | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `type`    | `compound` \| `parallel` \| `atomic` \| `final`. Inferred from `states` if absent. |
| `initial` | a direct child's name, or `{ target, actions }`. Required on compound.        |
| `states`  | child states, keyed by name. The key is the URL segment.                      |
| `context` | root only. `options.context` is merged over it.                               |
| `on`      | `{ event: transitions }`. Unhandled events bubble to ancestors.               |
| `go`      | eventless transitions, retried until none opens.                              |
| `onEntry` | script or list, run on entering.                                              |
| `onExit`  | script or list, run on leaving.                                               |
| `onFinal` | transitions taken when this state's subtree reaches `final`.                  |
| `invoke`  | `{ src, onSuccess, onError }`. `src` is awaited on entry.                     |

A transition is `"target"`, `{ target, cond, actions }`, or a list tried in order —
the first whose `cond` passes wins, and no match means stay put. A target resolves
against the source's siblings, then outward through each ancestor's children, so
`"done"` and `"billing.done"` both work from anywhere.

A script is a function `(context, event)` — sync or async — or the name of one in
`options.scripts`.

## API

```js
const machine = createMachine(definition, options);
```

| Option         | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `scripts`      | name → function, for string references in the definition.                |
| `context`      | merged over `definition.context`, shallowly.                             |
| `state`        | a stored value to restore instead of entering and settling.              |
| `onSend`       | `(event)` before an event is processed.                                  |
| `onTransition` | `(state)` after `start`, `send` and `back`.                              |
| `onChange`     | `({...context}, event)` after a transition that carried actions.         |
| `onFinal`      | `(state)` when the root reaches `final`.                                 |

The merge is shallow, and the machine mutates its context. If `definition.context`
holds nested objects, build it with a factory instead — otherwise every machine
compiled from that definition shares them.

| Method                     | Returns                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `start(event?)`            | enters the initial state, settles, resolves to the state.       |
| `send(type, payload?)`     | processes an event, settles, resolves to the state.             |
| `back(event?)`             | moves to the previous step on the trail. Deliberately does not settle. |
| `path()`                   | the trail as dotted ids, e.g. `["profile.name", "billing.card"]`. |
| `route(segments)`          | `{ target, prev }`.                                             |
| `state()`                  | `{ value, context, done }`. Synchronous.                        |

Everything except `state()` is async. `start()` is idempotent. `send()` before
`start()` throws.

`assign(updates)` builds an action from an object of values or `(context, event)`
functions.

## Tooling

```sh
1state-validate examples/onboard.js
1state-mermaid --title 'Onboarding flow' examples/onboard.js > examples/ONBOARD.md
```

Both take a `.js` module and check or render **every** export that looks like a
machine, so one file of composed sections is one call. A `.json` file is a single
machine. Globs are the shell's job.

`1state-validate` runs three passes and reports everything at once: JSON Schema
(strict about unknown keys — `onEnter` for `onEntry` is otherwise a silent no-op),
reachability, then a compile through the engine itself.

```
machines/checkout.js
  ✓ address
  ✗ checkout
      state "orphan" is unreachable: nothing targets it
2 machines, 1 invalid
```

Non-zero exit on failure. `--scripts <module>` supplies the registry when it does
not live beside the machines.

`1state-mermaid` renders `stateDiagram-v2`. It reads the definition, not a running
machine, so it draws every branch including the ones current answers would skip.
Inline guards print as written. `--check` re-renders and compares instead of
writing, which is what makes it a CI job:

```json
{
  "docs": "1state-mermaid --title 'Onboarding flow' examples/onboard.js > examples/ONBOARD.md",
  "docs:check": "1state-mermaid --title 'Onboarding flow' --check examples/ONBOARD.md examples/onboard.js"
}
```

See [`examples/onboard.js`](examples/onboard.js) for a real composed flow and
[`examples/ONBOARD.md`](examples/ONBOARD.md) for what it renders to.

## There is no persistence adapter

Deliberately. There is no machine state to persist.

The position is derived from the answers, and the answers are your row. Persist
the row — which you were going to do anyway — and you are done. To resume, build
the machine with `context` loaded from it and call `start()`.

```js
const machine = createMachine(onboard, { scripts, context: await load(accountId) });
await machine.start(); // exactly where they left off
```

Writes belong in actions. Name them in the definition and point them at your
database through `options.scripts`; the definition does not change between an
in-memory test and production.

```js
createMachine(onboard, {
  scripts: { patchAccount: (ctx, e) => db.account.update(ctx.id, e.patch) },
  context,
});
```

An adapter that snapshotted the machine would be strictly worse: the snapshot can
disagree with the row, it goes stale the moment an answer changes, and it pins
users to the version of the flow that was live when they started — which is
exactly the forward migration you wanted.

`options.state` does exist, for genuinely non-derivable positions. It lands on the
stored value without running entry actions and without settling, so a resume
cannot re-fire an `invoke`. Do not reach for it to make a wizard resume; that is
free.

## Limits

- **`path()` and `back()` are for series flows.** They replay `go` guards and
  `onFinal` hand-offs forward from the initial state. A parallel region has no
  single predecessor, and event-driven jumps and loops are not replayable. When the
  replay cannot reach the current state, `path()` returns just that state and
  `back()` stays put. `toPath`/`toValue` are series-only for the same reason — give
  each region its own segments if you need URLs over a parallel state.
- **No history states.** Re-entering a compound state goes to its `initial`.
- **Transitions are always external.** Targeting the state you are in exits and
  re-enters it, running `onExit` then `onEntry`. There is no internal-transition
  flag. This is what makes the self-transition idiom re-run guards, and it means
  `onEntry` must be idempotent.
- **Event names match exactly.** No SCXML wildcards, no `error.*` prefixes.
- **`invoke` is a one-shot promise, not a concurrent session.** `src` is awaited
  inline while the machine settles. No actors, no spawning, no cancellation. It
  re-runs every time its state is entered.
- **No delayed transitions and no scheduler.** Nothing happens between calls.
- A machine whose eventless transitions never settle throws after 1000 microsteps
  rather than hanging.

## Licence

MIT
