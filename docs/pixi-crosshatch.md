# Pixi Crosshatch

## Responsibility

The crosshatch gives every grid cell a world-anchored background texture beneath the interior grid lines.

## How It Works

Each 70-unit cell is divided into a four-by-four set of subcells. Two diagonal segments form an X inside every subcell. Across the current 25-by-25 grid, this creates 20,000 line segments in one `Graphics` object.

The crosshatch is built once during Pixi initialization. It uses a two-world-unit stroke at half opacity and scales naturally with the tabletop container. It remains visible throughout the entire supported zoom range.

## Invariants

- The pattern is fixed to world coordinates and moves with the tabletop.
- Every subcell contains both diagonals.
- The crosshatch remains below the interior grid.
- Camera changes transform the existing graphic instead of rebuilding its path.
- Zoom does not fade or hide the crosshatch.

## Why

The pattern describes the tabletop surface rather than the viewport, so it scales with the world. Building its large path once keeps wheel handling inexpensive and prevents repeated tessellation of 20,000 segments.

## Gotchas

- Dense diagonal geometry can exhibit minification aliasing at low zoom. Any future density, visibility, or level-of-detail behavior is a visible product change and requires an explicit decision.
- Making stroke thickness screen-relative would require rebuilding the path or adopting a different rendering representation.
- The subdivision density is independent of the main grid line thickness.

## Change Surface

- `src/renderer/pixiController.ts`
- `src/renderer/dataStore.ts`
- `docs/pixi-scene-layers.md`
- `docs/pixi-zoom.md`

## Verification

Inspect the pattern at the minimum and maximum zoom, confirm it never disappears, and confirm repeated wheel input does not reconstruct the crosshatch graphic.
