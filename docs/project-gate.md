# Project Gate

## Responsibility

`npm run lint` is the single completion gate for code changes. A code change is not complete until this command passes.

## What It Runs

The gate runs these checks in sequence:

1. dprint writes the repository's supported file types into canonical formatting.
2. dprint verifies that formatting is clean.
3. The dependency allowlist is checked.
4. ESLint runs with zero warnings allowed.
5. The source dependency graph is checked for circular imports.
6. Vue and TypeScript types are checked without emitting files.

The production build also runs this gate before packaging renderer output.

## Why It Works This Way

One command gives contributors and agents the same definition of a complete change. Formatting, dependency policy, static correctness, module structure, and types fail together at the repository boundary instead of relying on each contributor to remember separate commands.

## Invariants

- `npm run lint` is run after every code change.
- Warnings fail the ESLint stage.
- Formatting is both applied and verified.
- Circular source imports fail the gate.
- Type checking does not emit build artifacts.

## Gotchas

- The first formatting step mutates files. Always inspect the worktree afterward so unrelated user changes are not mistaken for changes produced by the current task.
- Passing the gate does not prove runtime behavior; the current gate does not run browser, Electron, or feature-level runtime tests.
- Generated `.vite` output is excluded from linting.
- A later stage does not run when an earlier stage fails.

## Change Surface

- `package.json`
- `eslint.config.mjs`
- `dprint.json`
- `tsconfig.json`
- `scripts/checkAllowedDependencies.mjs`

## Verification

Run `npm run lint` from the repository root and require a zero exit code from the complete sequence.
