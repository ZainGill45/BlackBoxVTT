# Pixi Zoom

## Responsibility

Pixi zoom changes tabletop scale while keeping the world point beneath the pointer stationary on screen.

## How It Works

Wheel input is handled by the tabletop container. Before scaling, the global pointer position is converted to a local world point. A negative wheel delta multiplies scale by `1.1`; a positive delta multiplies it by `1 / 1.1`. Scale is clamped between `0.2` and `2.5`.

After scaling, the saved local point is converted back to global space. The difference from the pointer position is applied to container position, preserving pointer anchoring. The camera then reports the new scale so screen-thickness graphics can rebuild.

## Invariants

- Zoom uses one uniform scale for both axes.
- Opposite wheel steps use reciprocal multipliers.
- Scale remains within the configured limits.
- A zero-delta wheel event leaves the camera unchanged.
- The pointer's world position remains anchored unless a scale limit prevents further movement.
- Scale-dependent drawing occurs after the new transform is established.

## Why

Pointer anchoring makes navigation spatially predictable. Reciprocal multipliers prevent an in-and-out pair from slowly changing the scale, and a callback keeps the camera independent from the rendering details that react to scale.

## Gotchas

- Wheel magnitude is intentionally not represented by the current implementation; every non-zero event applies one fixed step.
- At a clamp boundary, an opposite pair is not reversible because one direction may have been clamped.
- Zoom is registered on the tabletop container, so the pointer must be over its interactive area.
- Updating scale without the position correction makes the world zoom around its pivot instead of the pointer.

## Change Surface

- `src/renderer/pixiCamera.ts`
- `src/renderer/pixiController.ts`
- `docs/pixi-coordinate-spaces.md`
- `docs/pixi-grid.md`

## Verification

At several pointer positions, zoom in once and out once and confirm scale and position return to their starting values away from clamp limits. Repeat at both limits and verify the camera never exceeds them.
