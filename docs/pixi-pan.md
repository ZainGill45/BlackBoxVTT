# Pixi Pan

## Responsibility

Pixi pan translates the entire tabletop in response to middle-button dragging.

## How It Works

Middle-button press on the stage starts panning and stores the pointer's global position. Each stage mouse-move calculates the delta from the previous global position and subtracts it from the tabletop container position. The stored position advances after every move. Middle-button release stops panning and restores the default cursor.

Both the stage and tabletop container show a grab cursor while panning. Pan changes only container position; it does not modify scale, grid geometry, or scene-object coordinates.

## Invariants

- Panning is activated only by mouse button `1`.
- Movement uses global pointer deltas.
- The entire world moves through one container transform.
- Pan never redraws scale-dependent graphics because translation does not change their thickness.
- There are currently no pan bounds.

## Why

Moving one world container keeps every scene object spatially consistent and makes pan cost independent of scene size. Middle-button input leaves primary-button interaction available for tabletop tools.

## Gotchas

- Mouse release is handled on the stage. A release that is not delivered to the stage can leave `panningActive` set until another recognized release occurs.
- Cursor state is assigned separately to the stage and container.
- Introducing pan bounds must operate on the camera transform and account for viewport size, grid size, pivot, and scale together.

## Change Surface

- `src/renderer/pixiCamera.ts`
- `docs/pixi-coordinate-spaces.md`
- `docs/pixi-zoom.md`

## Verification

Drag in every direction at multiple zoom levels. Confirm world points maintain their relative positions, scale remains unchanged, and the cursor resets after release.
