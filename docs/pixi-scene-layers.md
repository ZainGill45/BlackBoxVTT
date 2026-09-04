# Pixi Scene Layers

## Responsibility

Scene layers define the draw order and rebuild lifecycle of the tabletop base.

## How It Works

The tabletop container enables sortable children. Its current base layers are:

| z-index | Layer               | Lifecycle                         |
| ------: | ------------------- | --------------------------------- |
|       0 | Solid background    | Built once                        |
|       1 | Crosshatch texture  | Built once                        |
|       2 | Interior grid lines | Rebuilt when camera scale changes |
|       4 | Outer border        | Rebuilt when camera scale changes |

The background and crosshatch are world-scaled artwork. The grid and border are scale-dependent because their thickness is defined in screen pixels.

## Invariants

- Layer order is expressed through `zIndex`, not insertion timing.
- Static graphics are created and added once.
- Scale-dependent graphics reuse their existing `Graphics` objects and clear only their geometry.
- DOM overlays are outside this ordering system; Pixi `zIndex` only orders Pixi display objects.

## Why

Separating static and scale-dependent layers avoids rebuilding the crosshatch's large path on every wheel event while allowing grid boundaries to retain stable screen thickness.

## Gotchas

- Re-adding an existing child does not clone it, but it obscures which layers are intended to be static.
- A new layer needs an explicit relationship to both the base graphics and future scene objects. Choosing an unused number alone does not define that relationship.
- Changing a static layer to depend on zoom also changes its redraw cost.

## Change Surface

- `src/renderer/pixiController.ts`
- `docs/pixi-grid.md`
- `docs/pixi-crosshatch.md`

## Verification

Confirm the background, crosshatch, grid, and border remain ordered after initialization and repeated zooming. Profile any change that adds substantial work to the scale-change callback.
