import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  createCamera,
  fitToScene,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  sceneToScreen,
  screenToScene,
  visibleBounds,
  zoomAt,
} from './camera';

const viewport = { height: 600, width: 800 };

describe('camera', () => {
  it('clamps zoom into the supported range', () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });

  it('centres the scene and fits its longest axis', () => {
    const camera = fitToScene({ height: 1080, width: 1920 }, viewport);

    expect(camera.x).toBe(960);
    expect(camera.y).toBe(540);
    // Width is the binding axis here: 800 / 1920, less the fit padding.
    expect(camera.zoom).toBeCloseTo((800 / 1920) * 0.94, 6);

    const topLeft = sceneToScreen(camera, viewport, { x: 0, y: 0 });
    const bottomRight = sceneToScreen(camera, viewport, {
      x: 1920,
      y: 1080,
    });
    expect(topLeft.x).toBeGreaterThan(0);
    expect(topLeft.y).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(viewport.width);
    expect(bottomRight.y).toBeLessThan(viewport.height);
  });

  it('survives a degenerate viewport', () => {
    expect(
      fitToScene({ height: 1080, width: 1920 }, { height: 0, width: 0 }),
    ).toEqual({ x: 960, y: 540, zoom: 1 });
  });

  it('round-trips between screen and scene space', () => {
    const camera = { x: 400, y: 300, zoom: 1.75 };
    const point = { x: 123.5, y: 456.25 };

    const back = screenToScene(
      camera,
      viewport,
      sceneToScreen(camera, viewport, point),
    );

    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('pans by a screen delta regardless of zoom', () => {
    const camera = { x: 100, y: 100, zoom: 2 };

    // Dragging right by 40 screen pixels moves the camera left by 20 scene units.
    expect(pan(camera, 40, -20)).toEqual({ x: 80, y: 110, zoom: 2 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const camera = createCamera();
    const anchor = { x: 720, y: 90 };
    const before = screenToScene(camera, viewport, anchor);

    const zoomed = zoomAt(camera, viewport, anchor, 2);
    const after = screenToScene(zoomed, viewport, anchor);

    expect(zoomed.zoom).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('leaves the camera untouched once zoom is pinned at a limit', () => {
    const camera = { x: 5, y: 6, zoom: MAX_ZOOM };

    expect(zoomAt(camera, viewport, { x: 0, y: 0 }, 4)).toBe(camera);
  });

  it('reports the scene rectangle on screen', () => {
    const bounds = visibleBounds({ x: 0, y: 0, zoom: 2 }, viewport);

    expect(bounds).toEqual({ maxX: 200, maxY: 150, minX: -200, minY: -150 });
  });
});
