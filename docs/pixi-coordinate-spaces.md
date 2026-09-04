# Pixi Coordinate Spaces

## Responsibility

This document defines the coordinate spaces shared by Pixi grid drawing, hit detection, zoom, and pan. Read it before moving values between pointer events and scene geometry.

## How It Works

- **World coordinates** are positions inside the tabletop. Grid cells, the crosshatch, and the border use this space. One grid cell is `grid.cellSize` world units.
- **Container-local coordinates** are world coordinates relative to the tabletop container. The current tabletop has no rotation, so they correspond directly to world coordinates.
- **Global coordinates** are Pixi stage positions. Pointer events provide `event.global`, and `Container.toLocal` and `Container.toGlobal` cross the camera transform.
- **Screen pixels** describe visual sizes that should remain stable while the world zooms. Grid and border thickness use this space.
- **Device pixels** are the renderer backing pixels. The application uses `window.devicePixelRatio` with `autoDensity` so CSS-sized visuals retain display resolution.

## Invariants

- Persisted and interactive scene positions belong to world space.
- Camera movement changes the tabletop container transform, not the coordinates of every scene object.
- A screen-space thickness is divided by camera scale before being used as local geometry.
- Pointer anchoring converts global to local before zoom and local back to global after zoom.

## Why

Keeping game data in world space makes it independent of the current viewport. Keeping UI-like line thickness in screen space prevents important boundaries from disappearing when the world is zoomed out.

## Gotchas

- An integer world coordinate usually becomes fractional after scaling and translation.
- Rounding a complete Graphics object rounds generated vertices, not the conceptual center of each line.
- Mixing global pointer positions with local grid positions without conversion produces scale-dependent selection errors.

## Change Surface

- `src/renderer/pixiCamera.ts`
- `src/renderer/pixiController.ts`
- `src/renderer/pixiGrid.ts`
- `docs/pixi-grid.md`
- `docs/pixi-zoom.md`
- `docs/pixi-pan.md`

## Verification

Verify coordinate conversion at the minimum, initial, unit, fractional, and maximum camera scales. Grid hit detection must identify the same world cell after both pan and zoom.
