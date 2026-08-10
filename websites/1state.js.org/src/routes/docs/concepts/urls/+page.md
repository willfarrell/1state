---
title: URLs
description: The node id is the URL path. route(segments) gives a step page its redirect target and its Back link off one replay of the trail.
---

The node id **is** the URL path. `profile.name` ⇄ `/profile/name`. No route table.

```javascript
import { toPath, toValue } from '@1state/core'

toPath({ profile: 'name' })   // ["profile", "name"]
toValue(['profile', 'name'])  // { profile: "name" }
```

## route(segments)

`route(segments)` gives a step page everything it needs off one replay of the
trail:

```javascript
await machine.route(['billing', 'card'])  // { target: null, prev: ["profile", "name"] }
await machine.route(['profile', 'name'])  // { target: null, prev: null }
await machine.route(['review'])           // { target: ["billing", "card"], prev: null }
```

- `target` — `null` means allow. Otherwise redirect there. The current step and
  any earlier one are allowed; that is back-navigation and re-editing. Unknown,
  off-flow or ahead bounces to current.
- `prev` — the Back link for the **requested** step, not for the current one.
  Re-editing an earlier answer has to go back to what preceded *it*. `null` on the
  first step, and while redirecting.

Change an earlier answer and both change with it, because both come from the same
replay.

## A step page

The whole contract for a step page is one call.

```javascript
const machine = createMachine(onboard, { scripts, context: await load(accountId) })
await machine.start()

const { target, prev } = await machine.route(params.segments)
if (target) redirect(302, `/${target.join('/')}`)

render({ step: params.segments, back: prev && `/${prev.join('/')}` })
```

The redirect is not an access check bolted on top. A step ahead of the current one
is unreachable because its predecessors' guards have not passed, and `route()`
reports that rather than enforcing it.

## Never restore from the URL

> **Never restore from the URL.** Do not feed `toValue(segments)` into
> `options.state`. Settling from context is the entire no-skip-ahead guarantee; a
> typed URL that restores directly walks straight past it.

Build from `context`, call `start()`, and ask `route()` what to do with the
requested segments.

## Series only

`toPath` and `toValue` are series-only, for the same reason `path()` and `back()`
are: a parallel region has no single predecessor. Give each region its own
segments if you need URLs over a parallel state. See
[Limits](/docs/concepts/limits).
