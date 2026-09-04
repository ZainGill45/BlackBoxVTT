# Game Listing

## Responsibility

Game listing discovers the games available on this computer and converts each valid game's metadata into a `GameEntry` for the connection screen. A `GameEntry` is the UI representation of a game, not a second domain object.

## How It Works

1. The renderer requests the game list through the preload API.
2. The main process reads the directories under the games root.
3. Each directory is inspected independently for a readable `game.json` that satisfies `GameSchema`.
4. Non-directories and invalid or unreadable games are skipped without preventing other games from loading.
5. The main process returns the valid entries.
6. The renderer clears its current game list, validates each returned entry, and adds each valid entry to the reactive list.

The filesystem's enumeration order is preserved. The UI does not currently apply an additional sort.

## Why It Works This Way

Each game is an independent container, so one damaged folder should not make every other campaign unavailable. Validation on both sides of the process boundary keeps the main process from returning malformed data and keeps the renderer from trusting an unexpected IPC result.

## Invariants

- Only directories directly beneath the games root are candidates.
- A candidate must contain a valid `game.json`.
- One candidate's failure does not fail the complete listing operation.
- The list shown by the connection screen is rebuilt from the latest response.

## Gotchas

- Invalid games disappear from the UI rather than appearing in a recoverable-error state.
- Listing does not recalculate `gameSizeBytes`; it returns the value currently recorded in `game.json`.
- Filesystem enumeration order is not a user-facing ordering guarantee.
- The renderer's outer error handling can report a total listing failure, while per-game failures in the main process are only logged and skipped.

## Change Surface

- `src/main/files.ts`
- `src/main/main.ts`
- `src/renderer/preload.ts`
- `src/renderer/gameEntryController.ts`
- `src/renderer/templates/CreateGamePanel.vue`
- `src/renderer/templates/GameEntry.vue`
- `src/shared/schemas/game.ts`

## Verification

Verify listing with multiple valid games, a non-directory entry, a missing `game.json`, invalid JSON, and metadata that fails `GameSchema`. The valid games must remain available in every case.
