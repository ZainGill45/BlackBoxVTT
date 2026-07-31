export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Scene edges are never flush against the viewport after a fit. */
const FIT_PADDING = 0.94;

export interface Camera {
  /** Scene-space coordinate drawn at the centre of the viewport. */
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  height: number;
  width: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

export function fitToScene(
  scene: { height: number; width: number },
  viewport: Viewport,
): Camera {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    scene.width <= 0 ||
    scene.height <= 0
  ) {
    return { x: scene.width / 2, y: scene.height / 2, zoom: 1 };
  }
  const zoom = clampZoom(
    Math.min(viewport.width / scene.width, viewport.height / scene.height) *
      FIT_PADDING,
  );
  return { x: scene.width / 2, y: scene.height / 2, zoom };
}

export function sceneToScreen(
  camera: Camera,
  viewport: Viewport,
  point: Point,
): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function screenToScene(
  camera: Camera,
  viewport: Viewport,
  point: Point,
): Point {
  return {
    x: (point.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (point.y - viewport.height / 2) / camera.zoom + camera.y,
  };
}

/** Pans by a screen-space delta, so dragging tracks the pointer at any zoom. */
export function pan(camera: Camera, deltaX: number, deltaY: number): Camera {
  return {
    ...camera,
    x: camera.x - deltaX / camera.zoom,
    y: camera.y - deltaY / camera.zoom,
  };
}

/** Zooms so the scene point under `anchor` stays under `anchor`. */
export function zoomAt(
  camera: Camera,
  viewport: Viewport,
  anchor: Point,
  factor: number,
): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) {
    return camera;
  }
  const target = screenToScene(camera, viewport, anchor);
  const next = { ...camera, zoom };
  const after = screenToScene(next, viewport, anchor);
  return {
    x: next.x + (target.x - after.x),
    y: next.y + (target.y - after.y),
    zoom,
  };
}

/** The scene-space rectangle currently on screen. */
export function visibleBounds(
  camera: Camera,
  viewport: Viewport,
): { maxX: number; maxY: number; minX: number; minY: number } {
  const topLeft = screenToScene(camera, viewport, { x: 0, y: 0 });
  const bottomRight = screenToScene(camera, viewport, {
    x: viewport.width,
    y: viewport.height,
  });
  return {
    maxX: bottomRight.x,
    maxY: bottomRight.y,
    minX: topLeft.x,
    minY: topLeft.y,
  };
}
