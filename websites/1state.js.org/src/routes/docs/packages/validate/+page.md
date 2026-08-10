---
title: validate
description: Static checks for a machine definition — JSON Schema, reachability, and a compile through the engine — plus the 1state-validate CLI.
---

Static checks for a definition. Returns every problem it found; an empty list
means valid. Never mutates the definition.

## Install

```bash
npm install --save-dev @1state/validate
```

## CLI

```bash
1state-validate examples/onboard.js
1state-validate --scripts ./ports.js machines/checkout.json
```

```
machines/checkout.js
  ✓ address
  ✗ checkout
      state "orphan" is unreachable: nothing targets it
2 machines, 1 invalid
```

Non-zero exit on failure, so it drops into CI as-is.

| Flag                 | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `--scripts <module>` | module whose default (or `scripts`) export is the registry.          |
| `-h`, `--help`       | usage.                                                               |

A `.js` module is scanned for **every** export that looks like a machine, so one
file of composed sections is one call. A `.json` file is a single machine, and
borrows the file's name. Globs are the shell's job.

Named scripts resolve against the module's own `scripts` export unless
`--scripts` overrides it. A `--scripts` module that will not load, or has no
registry, is fatal rather than a silent fall-through — otherwise the check that
was asked for would report green and never run.

## Three passes

It runs three passes and reports everything at once.

**Schema.** JSON Schema, strict about unknown keys — `onEnter` for `onEntry` is
otherwise a silent no-op. If the shape is wrong it stops here; the other two
passes are only worth running on a definition that parses.

**Reachability.** A state nothing points at is dead weight the engine will never
mention. Targets resolve outward, so a name used in one section can legitimately
reach a state in another: the pass deliberately over-counts rather than calling a
state dead when it isn't. What it catches is the state you added and never routed
to. Parallel regions are entered by their parent, so they are never orphans.

**Compile.** The definition goes through `createMachine`, so targets, script
names and missing `initial`s are answered by the engine itself rather than
reimplemented here.

## Library

```javascript
import validate from '@1state/validate'

const errors = validate(definition, { scripts })
if (errors.length) throw new Error(errors.join('\n'))
```

`options` is the same object `createMachine` takes, and is handed to it. In
practice only `scripts` changes the outcome, since a name with no registry entry
is one of the things reported.

The JSON Schema itself is exported separately:

```javascript
import schema from '@1state/validate/schema'
```
