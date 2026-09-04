# Dependency Allowlist

## Responsibility

The dependency allowlist makes every direct runtime and development package an explicit project decision.

## How It Works

`allowed-dependencies.json` lists the permitted package names for `dependencies` and `devDependencies`. The dependency check compares those names with the corresponding sections of `package.json`.

The check fails when `package.json` contains an unapproved package or when the allowlist contains a stale package that is no longer declared. Package versions are managed in `package.json` and the lockfile; the allowlist tracks names, not versions.

## Why It Works This Way

Dependencies add installation cost, maintenance obligations, and third-party code to the application. Requiring explicit approval keeps that cost visible. Rejecting stale entries prevents the allowlist from silently becoming broader than the project actually needs.

## Invariants

- Adding, removing, or replacing a dependency requires explicit user approval.
- Approved changes update `package.json` and `allowed-dependencies.json` together.
- Runtime and development dependencies remain in their matching allowlist sections.
- The dependency gate is part of `npm run lint`.

## Gotchas

- Changing only `package.json` or only the allowlist fails the gate.
- The allowlist does not approve a package version; it approves the direct package name.
- Transitive packages in the lockfile are not listed individually.
- Moving a package between runtime and development sections requires the same move in the allowlist.

## Change Surface

- `package.json`
- `package-lock.json`
- `allowed-dependencies.json`
- `scripts/checkAllowedDependencies.mjs`

## Verification

Run `npm run dependencies:check`, then run the complete `npm run lint` gate.
