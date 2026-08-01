import { describe, expect, it } from 'vitest';
import {
  activeMeasurementUpdate,
  addMeasurementPivot,
  beginMeasurement,
  inactiveMeasurementUpdate,
  measurementGesturePoints,
  moveMeasurement,
} from '../../../../../features/play/canvas/sceneMeasurementInteraction';
import { makeScene } from '../../../../support/scenes';

describe('scene measurement interaction', () => {
  it('owns measurement pivots and endpoint movement', () => {
    const scene = makeScene();
    const measurement = beginMeasurement(scene, { x: 10, y: 10 }, 1, 'id');

    moveMeasurement(measurement, scene, { x: 100, y: 100 });
    addMeasurementPivot(measurement, scene, { x: 100, y: 100 }, 8);

    expect(measurement.fixedPoints).toHaveLength(2);
    expect(measurementGesturePoints(measurement)).toHaveLength(2);
  });

  it('throttles active snapshots and produces a terminal snapshot', () => {
    const measurement = beginMeasurement(
      makeScene(),
      { x: 10, y: 10 },
      1,
      'id',
    );

    expect(activeMeasurementUpdate(measurement, 1, 100, 20)).toMatchObject({
      active: true,
      updateSequence: 1,
    });
    expect(activeMeasurementUpdate(measurement, 2, 110, 20)).toBeNull();
    expect(inactiveMeasurementUpdate(measurement, 2)).toEqual({
      active: false,
      measurementId: 'id',
      points: [],
      sceneId: makeScene().id,
      updateSequence: 2,
    });
  });
});
