# Contributing

In the spirit of Open Source Software, everyone is very welcome to contribute to this repository. Feel free to [raise issues](https://github.com/willfarrell/1state/issues) or to [submit Pull Requests](https://github.com/willfarrell/1state/pulls).

Before contributing to the project, make sure to have a look at our [Code of Conduct](/.github/CODE_OF_CONDUCT.md).


## Development Setup

### Prerequisites

- Node.js >= 20
- npm (comes with Node.js)

### Getting Started

```bash
git clone https://github.com/willfarrell/1state.git
cd 1state
npm install
```

This installs all dependencies across all workspaces (`packages/*`, `websites/*`, `.github`).


## Project Structure

```
packages/       # npm packages (core, validate, mermaid)
websites/       # documentation website (1state.js.org)
examples/       # runnable examples, used as tests
.github/        # CI workflows, workflow-specific dependencies
```

`@1state/core` is the engine, `@1state/validate` runs static checks over a
definition, and `@1state/mermaid` renders one as a diagram. The latter two also
ship a CLI.


## Testing

```bash
# Run all checks (lint, unit, mutation, types, perf, sast)
npm test

# Run specific test suites
npm run test:lint          # Biome linting
npm run test:unit          # Unit tests
npm run test:types         # TypeScript type checking (tstyche)
npm run test:mutation      # Mutation tests (Stryker)
npm run test:perf          # Performance benchmarks (tinybench)
npm run test:sast          # Static analysis, secrets, licences, lockfile

# Run tests for a single package
node --test ./packages/core
```

Unit tests use Node.js built-in `node:test`. The examples in `examples/` are
executed as tests, so they cannot rot.


## Documentation

```bash
npm run docs         # regenerate examples/ONBOARD.md from examples/onboard.js
npm run docs:check   # fail if it is out of date
```


## Code Style

- Formatting and linting are handled by [Biome](https://biomejs.dev/) (`biome.json`)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint
- Husky pre-commit hooks run linting and tests automatically


## Licence

Licensed under [MIT Licence](LICENSE). Copyright (c) 2026 [will Farrell](https://github.com/willfarrell), and the [1state team](https://github.com/willfarrell/1state/graphs/contributors).
