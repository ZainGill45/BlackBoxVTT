import {
  MAX_FOG_OPERATION_POINTS,
  MAX_SCENE_FOG_POINTS,
} from './sceneConstants';
import type { SceneFogOperation, SceneFogPoint } from './sceneSchema';

const MAX_BASE_PATH_ERROR = 0.5;
const MIN_BASE_PATH_ERROR = 0.125;
const MAX_SIMPLIFICATION_PASSES = 24;

function pointSegmentDistanceSquared(
  point: SceneFogPoint,
  start: SceneFogPoint,
  end: SceneFogPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx ** 2 + dy ** 2),
    ),
  );
  const nearestX = start.x + amount * dx;
  const nearestY = start.y + amount * dy;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function simplifyPath(
  points: readonly SceneFogPoint[],
  tolerance: number,
): SceneFogPoint[] {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  const threshold = tolerance ** 2;
  while (ranges.length > 0) {
    const [first, last] = ranges.pop()!;
    let furthest = -1;
    let furthestDistance = threshold;
    for (let index = first + 1; index < last; index += 1) {
      const distance = pointSegmentDistanceSquared(
        points[index],
        points[first],
        points[last],
      );
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      ranges.push([first, furthest], [furthest, last]);
    }
  }
  return points
    .filter((_point, index) => keep[index] === 1)
    .map((point) => ({ ...point }));
}

function evenlySpacedPoints(
  points: readonly SceneFogPoint[],
  maximumPoints: number,
): SceneFogPoint[] {
  if (maximumPoints <= 1) {
    return [{ ...points[0] }];
  }
  const step = (points.length - 1) / (maximumPoints - 1);
  return Array.from({ length: maximumPoints }, (_value, index) => ({
    ...points[Math.min(points.length - 1, Math.round(index * step))],
  }));
}

/**
 * Removes redundant brush samples while keeping the centerline error below
 * one eighth of a thin stroke and at most half a scene unit for wider strokes.
 */
export function compactFogBrushPoints(
  points: readonly SceneFogPoint[],
  width: number,
  maximumPoints = MAX_FOG_OPERATION_POINTS,
): SceneFogPoint[] {
  if (points.length === 0) {
    return [];
  }
  const limit = Math.max(
    points.length > 1 ? 2 : 1,
    Math.floor(maximumPoints),
  );
  let tolerance = Math.min(
    MAX_BASE_PATH_ERROR,
    Math.max(MIN_BASE_PATH_ERROR, width / 8),
  );
  for (let pass = 0; pass < MAX_SIMPLIFICATION_PASSES; pass += 1) {
    const simplified = simplifyPath(points, tolerance);
    if (simplified.length <= limit) {
      return simplified;
    }
    tolerance *= 2;
  }
  return evenlySpacedPoints(points, limit);
}

function fogPointCount(operations: readonly SceneFogOperation[]): number {
  return operations.reduce(
    (total, operation) =>
      total + (operation.kind === 'brush' ? operation.points.length : 0),
    0,
  );
}

/**
 * Keeps accumulated vector fog below its durable safety limit. Old paths are
 * simplified geometrically instead of rejecting every later brush stroke.
 */
export function compactFogOperations(
  operations: readonly SceneFogOperation[],
  maximumPoints = MAX_SCENE_FOG_POINTS,
): SceneFogOperation[] {
  const compacted = operations.map((operation) =>
    operation.kind === 'brush'
      ? {
          ...operation,
          points: compactFogBrushPoints(operation.points, operation.width),
        }
      : { ...operation },
  );
  if (fogPointCount(compacted) <= maximumPoints) {
    return compacted;
  }

  const brushes = compacted.flatMap((operation, index) =>
    operation.kind === 'brush'
      ? [{ index, minimum: operation.points.length > 1 ? 2 : 1, operation }]
      : [],
  );
  const minimumTotal = brushes.reduce(
    (total, brush) => total + brush.minimum,
    0,
  );
  const available = Math.max(0, maximumPoints - minimumTotal);
  const totalCapacity = brushes.reduce(
    (total, brush) => total + brush.operation.points.length - brush.minimum,
    0,
  );
  const allocations = brushes.map((brush) => {
    const exact = totalCapacity === 0
      ? 0
      : available *
        (brush.operation.points.length - brush.minimum) /
        totalCapacity;
    return {
      budget: brush.minimum + Math.floor(exact),
      index: brush.index,
      remainder: exact - Math.floor(exact),
    };
  });
  let unallocated = maximumPoints - allocations.reduce(
    (total, allocation) => total + allocation.budget,
    0,
  );
  for (const allocation of [...allocations].sort(
    (left, right) => right.remainder - left.remainder,
  )) {
    if (unallocated <= 0) {
      break;
    }
    allocation.budget += 1;
    unallocated -= 1;
  }
  const budgets = new Map(
    allocations.map((allocation) => [allocation.index, allocation.budget]),
  );
  return compacted.map((operation, index) =>
    operation.kind === 'brush'
      ? {
          ...operation,
          points: compactFogBrushPoints(
            operation.points,
            operation.width,
            budgets.get(index),
          ),
        }
      : operation,
  );
}
