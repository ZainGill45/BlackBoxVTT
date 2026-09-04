# Game Schema

## Responsibility

The game schema defines the persisted identity and connection-screen representation of one campaign.

## Meaning

A **Game** is one campaign container for whichever tabletop system is being played. It owns the data for one campaign instance and is loaded from the connection screen. A **GameEntry** is only the UI representation of that same Game; it is not a separate persisted entity.

The current schema fields are:

- `schemaVersion`: currently accepts only literal version `1`.
- `uuid`: the UUID v4 identity used for persistence and UI keys.
- `name`: the user-facing campaign name.
- `gameSizeBytes`: the literal number of bytes occupied by the complete game directory on disk.

Names are trimmed, required, limited to 128 characters, and restricted to word characters, spaces, and underscores.

## Invariants

- UUID, rather than name, is canonical identity.
- Persisted game metadata must pass `GameSchema`.
- The renderer and main process share the schema from `src/shared`.
- `GameEntry` data has the same shape as its Game.
- `gameSizeBytes` describes disk usage, not an estimate or logical asset size.

## Why

One executable Zod schema keeps persistence and process-boundary validation consistent while producing the TypeScript type used by both sides. UUID identity allows names to change or collide without changing storage identity.

## Gotchas

- New games currently initialize `gameSizeBytes` to zero, and no implemented process recalculates it yet.
- No migration behavior is currently settled. `schemaVersion` only enforces acceptance of version `1` today.
- JavaScript `\w` does not accept every Unicode letter even though the validation message says letters are allowed.

## Change Surface

- `src/shared/schemas/game.ts`
- `src/renderer/gameEntryController.ts`
- `src/renderer/templates/GameEntry.vue`
- `src/main/files.ts`
- `docs/game-storage-layout.md`

## Verification

Exercise valid and invalid names, invalid UUIDs, negative byte counts, and unsupported schema versions through both renderer and main-process validation paths.
