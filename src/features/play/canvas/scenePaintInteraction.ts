import {
  MAX_DRAWING_POINTS,
  type SceneDrawing,
  type SceneDrawingPoint,
  type SceneDrawingStyle,
} from '../../../shared/scenes';

export function appendFreeformPoint(
  points: SceneDrawingPoint[],
  point: SceneDrawingPoint,
  zoom: number,
  minimumScreenDistance = 0.25,
): boolean {
  const previous = points.at(-1);
  if (
    !previous ||
    Math.hypot(point.x - previous.x, point.y - previous.y) <
      minimumScreenDistance / zoom
  ) {
    return false;
  }
  points.push(point);
  return true;
}

export function advancePolyline(
  points: SceneDrawingPoint[],
  point: SceneDrawingPoint,
  detail: number,
  zoom: number,
): 'close' | 'finish' | 'full' | 'point-added' {
  const first = points[0];
  if (
    points.length >= 3 &&
    Math.hypot(point.x - first.x, point.y - first.y) * zoom <= 10
  ) {
    return 'close';
  }
  if (detail >= 2) {
    return 'finish';
  }
  if (points.length >= MAX_DRAWING_POINTS) {
    return 'full';
  }
  points.push(point);
  return 'point-added';
}

export function simplifyFreeform(
  points: SceneDrawingPoint[],
): SceneDrawingPoint[] {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }
  const simplified = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const point = points[index];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5) {
      simplified.push(point);
    }
  }
  simplified.push(points[points.length - 1]);
  if (simplified.length <= MAX_DRAWING_POINTS) {
    return simplified.map((point) => ({ ...point }));
  }
  const step = (simplified.length - 1) / (MAX_DRAWING_POINTS - 1);
  return Array.from({ length: MAX_DRAWING_POINTS }, (_, index) => ({
    ...simplified[
      Math.min(simplified.length - 1, Math.round(index * step))
    ],
  }));
}

export function createSceneDrawing(
  points: SceneDrawingPoint[],
  kind: SceneDrawing['kind'],
  style: SceneDrawingStyle,
  closed: boolean,
  id: string,
  ownerId: string | null,
): SceneDrawing {
  const normalized = kind === 'freeform' ? simplifyFreeform(points) : points;
  const minX = Math.min(...normalized.map((point) => point.x));
  const maxX = Math.max(...normalized.map((point) => point.x));
  const minY = Math.min(...normalized.map((point) => point.y));
  const maxY = Math.max(...normalized.map((point) => point.y));
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  return {
    closed,
    id,
    kind,
    ownerId,
    points: normalized.map((point) => ({
      x: point.x - x,
      y: point.y - y,
    })),
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style: {
      ...structuredClone(style),
      fillEnabled: kind === 'polyline' && closed && style.fillEnabled,
    },
    x,
    y,
  };
}

export function compactPreviewPoints(
  points: SceneDrawingPoint[],
  maximum: number,
): SceneDrawingPoint[] {
  if (points.length <= maximum) {
    return points.map((point) => ({ ...point }));
  }
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (maximum - 1),
    );
    return { ...points[sourceIndex] };
  });
}
