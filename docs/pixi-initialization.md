# Pixi Initialization

## Responsibility

Pixi initialization creates the renderer, attaches its canvas, establishes the tabletop container, builds scene-base graphics, and registers camera controls.

## How It Works

`initializePixi` finds `#pixi-canvas`, initializes a transparent antialiased `Application`, and appends the generated canvas. WebGPU is the preferred renderer with high-performance power preference; Pixi retains responsibility for fallback when WebGPU is unavailable.

The backing resolution follows `window.devicePixelRatio`, while `autoDensity` keeps layout dimensions in CSS pixels. The application resizes with the window.

The tabletop container is centered in the viewport area left of the right sidebar. Its pivot is the center of the configured grid, its initial scale is `0.5`, and it is the single parent transformed by camera controls. Static scene graphics are built before scale-dependent graphics and camera registration.

## Invariants

- Initialization requires an existing `#pixi-canvas` element.
- WebGPU remains the preferred renderer.
- The stage hit area covers the application screen.
- The tabletop container remains the camera transform boundary.
- Static graphics exist before any camera callback redraws scale-dependent graphics.

## Why

WebGPU is the intended default rendering path. Device-density rendering preserves edge quality, and one transformed world container keeps camera behavior independent from the number of scene objects.

## Gotchas

- The Pixi canvas exists inside the Electron renderer; opening the Vite page outside Electron does not provide the preload API used by the rest of the application.
- `Container.setSize` derives scale from bounds; it does not declare an independent drawing surface.
- Initialization currently has no matching destruction path. Reinitializing it would create another application and another set of event listeners.

## Change Surface

- `src/renderer/pixiController.ts`
- `src/renderer/templates/PixiCanvas.vue`
- `src/renderer/gameInitializationController.ts`
- `docs/pixi-coordinate-spaces.md`
- `docs/pixi-scene-layers.md`

## Verification

Run `npm run lint`, launch through Electron, resize the window, and confirm that the canvas remains sharp and fills the viewport without moving the world underneath the right sidebar.
