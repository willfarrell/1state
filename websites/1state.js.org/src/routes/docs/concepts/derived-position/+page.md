---
title: Derived position
description: The position is a pure function of the answers, recomputed on every start(). Guards read the answers, never a stored cursor.
---

Nothing anywhere records "the user is on step 3". The position is a pure function
of the answers, recomputed from the initial state on every `start()`. Guards read
the data.

```javascript
const resumed = createMachine(signup, { context: { email: 'a@example.org' } })
await resumed.start() // value: "password"
```

No cursor was loaded. `start()` entered `email`, found its guard open, moved to
`password`, found that guard closed, and stopped.

## What it buys

That one property buys three things that are otherwise separate features:

- **Resume.** Load the row into `context`, start, land on the first gap.
- **No skip-ahead.** A later state is unreachable until its predecessors' guards
  pass. There is no cursor to forge, because there is no cursor.
- **Forward migration.** Add a state and every already-"complete" record re-opens
  at it. Turning on a policy that inserts a step is how you reach users who
  finished last year.

None of the three is a feature of the engine. They are consequences of settling
from the answers, and they stop being true the moment something stores a
position.

## How settling works

Two rules do all of it.

`on` records an answer as a **self-transition**. The transition targets the state
it fires in, so the state exits and re-enters, and its guards run again against
the answer just written.

`go` is **eventless**. After every step the machine retries the `go` transitions
of whatever is active and keeps going until nothing opens. Where it stops is
where the user is.

So a `start()` on a half-filled context walks the flow from the top, opening
guard after guard, until it reaches the first question whose answer is missing.
That walk is the resume.

## Guards must read the answer

The corollary is that guards must read the **answer**, not a marker of progress:

```javascript
go: [{ target: 'done', cond: (ctx) => 'newsletter' in ctx }] // yes
go: [{ target: 'done', cond: (ctx) => ctx.newsletter }]      // no — "no" reads as unanswered
```

Test for presence (`in`, `=== false`), not truthiness. `false`, `0` and `""` are
answers. A truthiness guard on a boolean question traps every user who answers
"no": the guard stays closed, the flow never leaves, and the page re-asks a
question that was already answered.

Where an answer genuinely cannot be told apart from its default, write a separate
`answeredAt` marker and guard on that.

```javascript
retention: {
  on: { answer: { target: 'retention', actions: 'patchOrganization' } },
  // every option, including the platform default, is a real choice
  go: [{ target: 'done', cond: (ctx) => 'retention' in ctx.organization }],
},
```

## Never restore from the URL

Settling from context is the entire no-skip-ahead guarantee. Feeding
`toValue(segments)` into `options.state` restores a position the user typed, which
walks straight past every guard in front of it. See [URLs](/docs/concepts/urls)
for the supported way to serve a step page.
