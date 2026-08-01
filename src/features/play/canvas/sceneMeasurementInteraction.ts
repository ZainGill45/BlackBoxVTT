import {
  type MeasurementPoint,
  type MeasurementUpdate,
} from '../../../shared/network';
import type { SceneRecord } from '../../../shared/scenes';
import {
  measurementPath,
  measurementPoint,
  sameMeasurementPoint,
} from './measurement';
import type { SceneGesture } from './sceneInteractionEngine';

export type MeasurementGesture = Extract<
  SceneGesture,
  { kind: 'measurement' }
>;
export type MeasurementState = Omit<MeasurementGesture, 'kind'>;

export function beginMeasurement(
  scene: SceneRecord,
  point: { x: number; y: number },
  pointerId: number,
  id: string,
): MeasurementGesture {
  const measured = measurementPoint(scene, point);
  return {
    endpoint: measured,
    fixedPoints: [measured],
    id,
    kind: 'measurement',
    lastSentAt: 0,
    pointerId,
    sceneId: scene.id,
  };
}

export function measurementGesturePoints(
  measurement: MeasurementState | null,
): MeasurementPoint[] {
  return measurement
    ? measurementPath(measurement.fixedPoints, measurement.endpoint)
    : [];
}

export function moveMeasurement(
  measurement: MeasurementState,
  scene: SceneRecord,
  point: { x: number; y: number },
): void {
  measurement.endpoint = measurementPoint(scene, point);
}

export function addMeasurementPivot(
  measurement: MeasurementState,
  scene: SceneRecord,
  point: { x: number; y: number },
  maximumPoints: number,
): void {
  moveMeasurement(measurement, scene, point);
  const last = measurement.fixedPoints.at(-1)!;
  if (
    measurement.fixedPoints.length < maximumPoints - 1 &&
    !sameMeasurementPoint(last, measurement.endpoint)
  ) {
    measurement.fixedPoints.push(measurement.endpoint);
  }
}

export function activeMeasurementUpdate(
  measurement: MeasurementState,
  updateSequence: number,
  now: number,
  minimumInterval: number,
  force = false,
): Omit<MeasurementUpdate, 'campaignId'> | null {
  if (!force && now - measurement.lastSentAt < minimumInterval) {
    return null;
  }
  measurement.lastSentAt = now;
  return {
    active: true,
    measurementId: measurement.id,
    points: measurementGesturePoints(measurement),
    sceneId: measurement.sceneId,
    updateSequence,
  };
}

export function inactiveMeasurementUpdate(
  measurement: MeasurementState,
  updateSequence: number,
): Omit<MeasurementUpdate, 'campaignId'> {
  return {
    active: false,
    measurementId: measurement.id,
    points: [],
    sceneId: measurement.sceneId,
    updateSequence,
  };
}
