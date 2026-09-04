# Application State

## Responsibility

Application state selects which top-level experience is visible: the connection screen, the loading screen, or the loaded game.

## States and Transitions

- `connection` is the initial state.
- Choosing to load a game moves to `loading`, then to `game` after the current one-second placeholder delay.
- Exiting a game moves to `loading`, then back to `connection` after the current one-second placeholder delay.

The top-level views use `v-show`. They remain mounted while hidden, so their component state and initialized resources persist across transitions. In particular, the Pixi canvas can initialize during application startup rather than every time the game view becomes visible.

## Why It Works This Way

The three values model the presentation states the application currently has. Keeping views mounted avoids destroying and rebuilding expensive or stateful feature trees when the user moves between them.

## Invariants

- Exactly one top-level state is selected at a time.
- State changes go through the game-initialization controller.
- Loading is shown between the connection and game views in either direction.
- Hidden views are still mounted.

## Gotchas

- The one-second waits are temporary stand-ins for real asynchronous loading. Their duration and timer-based implementation are not product behavior to preserve.
- `v-show` does not run unmount cleanup during ordinary state transitions.
- This state does not represent connection health, authentication, or game-loading progress.

## Change Surface

- `src/renderer/gameInitializationController.ts`
- `src/renderer/templates/App.vue`
- `src/renderer/templates/GameContainer.vue`
- `src/renderer/templates/ConnectionPanel.vue`
- `src/renderer/templates/LoadingAnimation.vue`

## Verification

Verify both transition directions, confirm that loading is visible during pending work, and confirm that state owned by a hidden view survives returning to it.
