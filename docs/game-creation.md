# Game Creation

## Responsibility

Game creation validates campaign identity, creates its complete filesystem layout, and refreshes the connection-screen list.

## How It Works

The renderer constructs a version-1 Game with a new UUID, the entered name, and an initial disk size of zero. It validates that object before invoking the preload API. The main-process handler verifies the IPC sender and validates the Game again.

The main process recursively creates the UUID root and every required category directory, then writes formatted JSON to `game.json`. After success, the renderer reloads all Game entries. If any filesystem step fails, the main process attempts to delete the incomplete game directory before rejecting the request.

## Invariants

- UUID generation occurs before persistence.
- Both renderer and main process validate creation data.
- A successful creation has the complete standard directory structure and valid `game.json`.
- Failed creation attempts do not intentionally leave a partial game behind.
- The UI list is refreshed only after the main process reports success.

## Why

Early renderer validation gives immediate errors, while main-process validation protects the privileged filesystem boundary. Creating the entire layout up front makes later features operate against predictable directories. Cleanup contains partial-write failures instead of presenting incomplete games.

## Gotchas

- Filesystem creation is recoverable but not transactional; cleanup can also fail and will then log that stale data remains.
- `gameSizeBytes` starts at zero and is not currently recalculated.
- The game name is not used as a directory name.
- The renderer list refresh performs a new filesystem read rather than appending its submitted object optimistically.

## Change Surface

- `src/renderer/templates/CreateGamePanel.vue`
- `src/renderer/gameEntryController.ts`
- `src/renderer/preload.ts`
- `src/main/main.ts`
- `src/main/files.ts`
- `src/shared/schemas/game.ts`
- `docs/game-storage-layout.md`
- `docs/electron-ipc-validation.md`

## Verification

Test a valid game, every name-validation failure, a simulated directory or file-write failure, successful cleanup, failed cleanup, and list refresh after success.
