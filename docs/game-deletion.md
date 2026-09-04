# Game Deletion

## Responsibility

Game deletion permanently removes one game container and everything stored beneath its directory.

## How It Works

The delete control requires two clicks. The first click arms the control for five seconds; a second click during that period requests deletion. The renderer sends the selected `GameEntry` through the preload API.

The main process verifies the IPC sender, scans the directories beneath the games root, and selects the directory whose name exactly matches the requested game's UUID. It then recursively removes that directory. After a successful response, the renderer refreshes the game list.

## Why It Works This Way

The UUID is the game's stable identity, while names are user-editable and need not be unique. The two-step control makes an irreversible action harder to trigger accidentally without introducing a separate confirmation screen.

## Invariants

- A game is selected for deletion by UUID, not by display name or directory position.
- The complete game directory is the deletion boundary.
- The visible list is refreshed only after deletion succeeds.
- The armed state expires after five seconds and is cleared when the control unmounts.

## Gotchas

- Deletion is permanent; there is no trash or undo path.
- The main-process delete handler verifies the sender but does not currently validate the incoming game payload with `GameSchema`.
- Recursive removal uses the force option, but requesting an unknown UUID still fails because no matching directory can be found first.
- The second click must occur on the same mounted delete control before its timeout expires.

## Change Surface

- `src/renderer/templates/DeleteIconButton.vue`
- `src/renderer/templates/GameEntry.vue`
- `src/renderer/gameEntryController.ts`
- `src/renderer/preload.ts`
- `src/main/main.ts`
- `src/main/files.ts`

## Verification

Verify the arming timeout, a successful second click, an unknown UUID, and deletion of a game containing nested files. Confirm that no sibling game directory is changed.
