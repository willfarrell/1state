---
title: mermaid
description: Render a machine definition as a mermaid stateDiagram-v2, plus the 1state-mermaid CLI and its --check mode for CI.
---

Renders a definition as a mermaid `stateDiagram-v2`, fenced in a `mermaid` block
ready to drop into a markdown file.

It reads the definition, not a running machine, so it draws **every** branch —
including the ones current answers would skip.

## Install

```bash
npm install --save-dev @1state/mermaid
```

## CLI

```bash
1state-mermaid --title 'Onboarding flow' examples/onboard.js > examples/ONBOARD.md
1state-mermaid --title 'Onboarding flow' --check examples/ONBOARD.md examples/onboard.js
```

| Flag             | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `--title <text>` | document heading.                                              |
| `--check <file>` | compare against `<file>` instead of writing; non-zero on drift. |
| `-h`, `--help`   | usage.                                                         |

A `.js` module renders every export that looks like a machine, each as its own
section. A `.json` file is a single machine. Export order is definition order,
which reads bottom-up — you meet a section before the flow that nests it.

## --check is the point

`--check` re-renders and compares instead of writing, so a committed diagram that
no longer matches its machine fails CI instead of quietly going stale.

```json
{
  "docs": "1state-mermaid --title 'Onboarding flow' examples/onboard.js > examples/ONBOARD.md",
  "docs:check": "1state-mermaid --title 'Onboarding flow' --check examples/ONBOARD.md examples/onboard.js"
}
```

## What it draws

Nesting is the point: a composed flow is sub-machines chained by `onFinal`, and
each one becomes a mermaid composite state at its own depth.

Inline guards print as written — collapsed to one line, shortened, and stripped of
the characters mermaid parses as syntax. A named script prints its name. Only
named actions get an edge label; an inline closure is plumbing.

```
stateDiagram-v2
  %% accountEmailAddress
  [*] --> address
  state "address<br/>answer → patchAccount, sendEmailCode" as address
  address --> code : !!ctx.account.emailAddress
  state "code<br/>answer → verifyEmailCode<br/>resend → sendEmailCode" as code
  code --> [*] : ctx.emailCount > 0
```

That is one more reason to name actions in the definition rather than inline them:
the diagram then shows which port each page calls.

## Library

```javascript
import mermaid from '@1state/mermaid'

const diagram = mermaid(definition, { title: 'Signup' })
```

`title` is written as a `%%` comment on the first line of the diagram.

The package does not depend on `@1state/core` at runtime — it restates the
definition shape in its own types — so it can be installed on its own.
