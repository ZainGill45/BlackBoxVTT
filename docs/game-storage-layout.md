# Game Storage Layout

## Responsibility

Game storage maps each campaign to a human-readable directory tree under Electron's application data location.

## Layout

The root is `app.getPath("userData")/userData/Games`. Each Game owns a directory named by its UUID:

```text
Games/
  <game-uuid>/
    game.json
    Scenes/
    Journal/
    Miscellaneous/
    Chat/
    Music/
    Storage/
```

`game.json` contains the `GameSchema` metadata. `Storage` is the canonical on-disk home for assets added through the right-sidebar Storage feature. `Miscellaneous` holds game-scoped data that does not belong to another category, such as JSON files describing available UI themes. The remaining directories own data named by their category.

## Invariants

- Every game directory is named by Game UUID.
- Every game directory contains its own `game.json`.
- Game-scoped assets enter through the Storage feature and live in `Storage`.
- Category directory names form part of the persisted layout.
- `gameSizeBytes` measures the complete UUID directory.

## Why

Local JSON and filesystem storage is human-readable, maps cleanly onto a campaign's file-by-file contents, and is sufficiently performant for the expected workload. Separate category directories keep unrelated data independently inspectable and manageable.

## Gotchas

- Renaming or moving a category is an on-disk compatibility change.
- Human editability does not bypass schema validation; an invalid `game.json` prevents that game from appearing in the list.
- `Miscellaneous` is a fallback for uncategorized game data, not an alternate asset store.
- No settled migration mechanism currently changes an existing layout.

## Change Surface

- `src/main/files.ts`
- `src/shared/schemas/game.ts`
- `docs/game-schema.md`
- `docs/game-creation.md`
- `docs/game-listing.md`
- `docs/game-deletion.md`

## Verification

Create a game, inspect its UUID directory and every required subdirectory, validate `game.json`, and compare `gameSizeBytes` behavior against the complete directory size when size calculation is implemented.
