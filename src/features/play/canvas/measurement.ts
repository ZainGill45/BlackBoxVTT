import {
  MAX_MEASUREMENT_POINTS,
  type MeasurementPoint,
} from '../../../shared/network';
import type { SceneRecord } from '../../../shared/scenes';

export const MAX_MEASUREMENT_PIVOTS = MAX_MEASUREMENT_POINTS - 2;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function measurementPoint(
  scene: SceneRecord,
  point: MeasurementPoint,
): MeasurementPoint {
  const bounded = {
    x: clamp(point.x, 0, scene.width),
    y: clamp(point.y, 0, scene.height),
  };
  if (scene.grid.type !== 'square') {
    return bounded;
  }
  const center = (value: number, offset: number) =>
    offset +
    (Math.floor((value - offset) / scene.grid.size) + 0.5) *
      scene.grid.size;
  return {
    x: clamp(center(bounded.x, scene.grid.offsetX), 0, scene.width),
    y: clamp(center(bounded.y, scene.grid.offsetY), 0, scene.height),
  };
}

export function sameMeasurementPoint(
  left: MeasurementPoint,
  right: MeasurementPoint,
): boolean {
  return left.x === right.x && left.y === right.y;
}

export function measurementPath(
  fixedPoints: MeasurementPoint[],
  endpoint: MeasurementPoint,
): MeasurementPoint[] {
  const points = fixedPoints.slice(0, MAX_MEASUREMENT_POINTS - 1);
  if (
    points.length === 0 ||
    !sameMeasurementPoint(points[points.length - 1], endpoint)
  ) {
    points.push(endpoint);
  }
  return points;
}

export function cumulativeMeasurementDistances(
  scene: Pick<SceneRecord, 'distance' | 'pixelScale'>,
  points: MeasurementPoint[],
): number[] {
  const distances: number[] = [];
  let pixels = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      pixels += Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
    }
    distances.push((pixels / scene.pixelScale) * scene.distance);
  }
  return distances;
}

export function formatMeasurementDistance(
  value: number,
  unit: string,
): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const label = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(rounded);
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${label} ${trimmedUnit}` : label;
}
