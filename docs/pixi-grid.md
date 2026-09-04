# Pixi Grid

## Responsibility

The Pixi grid draws the interior boundaries of the tabletop and converts pointer positions to one-based grid coordinates.

## How It Works

The grid is currently 25 columns by 25 rows with 70 world units per cell. `buildGridGraphic` draws every interior vertical and horizontal boundary as a filled rectangle. The outer perimeter belongs to the border layer.

Grid thickness is configured in screen pixels. Whenever camera scale changes, the controller divides the desired screen thickness by scale, clears the existing grid graphic, rebuilds its local rectangles, and fills them with the grid color. The container transform returns those rectangles to the configured screen thickness.

`getGridCordinate` converts a global point into container-local space and returns one-based cell coordinates. `getGridCordinateLocalPoint` converts those coordinates to the local position of a cell's top-left corner.

## Invariants

- Grid geometry and hit detection use the same `grid` configuration.
- Interior lines remain centered on exact cell boundaries.
- Visual thickness remains adjustable and stable in screen pixels.
- The grid uses regular filled geometry without `roundPixels` or `pixelLine`.
- Cell coordinates exposed by hit detection are one-based.

## Why

Filled rectangles preserve arbitrary thickness without Pixi's fixed one-pixel line mode. Computing local thickness from camera scale prevents thin stroke triangles from collapsing or changing apparent width during zoom.

## Gotchas

- Rebuilding the same local geometry without using camera scale does not change its rasterization.
- `roundPixels` rounds generated rectangle or stroke vertices and can collapse thin geometry.
- `pixelLine` uses Pixi's special one-pixel path and does not represent adjustable thickness.
- Points exactly on an interior boundary currently resolve to the earlier cell because the range checks are inclusive.
- `getGridCordinateLocalPoint` currently accepts coordinate `0` and returns a negative local position even though hit detection produces one-based coordinates.
- The exported function names intentionally retain the existing `Cordinate` spelling; renaming them affects callers.

## Change Surface

- `src/renderer/dataStore.ts`
- `src/renderer/pixiGrid.ts`
- `src/renderer/pixiController.ts`
- `docs/pixi-coordinate-spaces.md`
- `docs/pixi-zoom.md`

## Verification

Check line continuity and thickness at scales `0.2`, `0.5`, a fractional intermediate scale, `1`, and `2.5`. Then pan and verify points near all four cell edges map to the intended coordinate.
