import { describe, expect, it } from 'vitest';
import {
  createDefaultGrid,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  type SceneRecord,
} from '../../../../../shared/scenes';
import {
  cumulativeMeasurementDistances,
  formatMeasurementDistance,
  measurementPath,
  measurementPoint,
} from '../../../../../features/play/canvas/measurement';

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return {
    createdAt: '',
    distance: 5,
    grid: createDefaultGrid(),
    height: 300,
    id: '11111111-1111-4111-8111-111111111111',
    drawings: createEmptyDrawingLayers(),
    images: createEmptyImageLayers(),
    mapImage: null,
    name: 'Scene',
    pixelScale: 100,
    revision: 0,
    unit: 'ft',
    updatedAt: '',
    width: 400,
    ...overrides,
  };
}

describe('measurement geometry', () => {
  it('snaps square-grid points to offset cell centers and clamps edges', () => {
    const current = scene({
      grid: {
        ...createDefaultGrid(),
        offsetX: 10,
        offsetY: -20,
        size: 80,
      },
    });
    expect(measurementPoint(current, { x: 120, y: 100 })).toEqual({
      x: 130,
      y: 100,
    });
    expect(measurementPoint(current, { x: -100, y: 1_000 })).toEqual({
      x: 0,
      y: 300,
    });
  });

  it('keeps gridless points freeform while clamping them to the scene', () => {
    const current = scene({
      grid: { ...createDefaultGrid(), type: 'gridless' },
    });
    expect(measurementPoint(current, { x: 12.25, y: 92.5 })).toEqual({
      x: 12.25,
      y: 92.5,
    });
    expect(measurementPoint(current, { x: 500, y: -10 })).toEqual({
      x: 400,
      y: 0,
    });
  });

  it('omits a duplicate endpoint and bounds a complete path', () => {
    const fixed = Array.from({ length: 80 }, (_, index) => ({
      x: index,
      y: index,
    }));
    expect(measurementPath([{ x: 1, y: 2 }], { x: 1, y: 2 })).toEqual([
      { x: 1, y: 2 },
    ]);
    expect(measurementPath(fixed, { x: 100, y: 100 })).toHaveLength(64);
  });

  it('uses unrounded cumulative Euclidean distance and scene pixel scale', () => {
    expect(
      cumulativeMeasurementDistances(
        scene(),
        [
          { x: 0, y: 0 },
          { x: 30, y: 40 },
          { x: 30, y: 140 },
        ],
      ),
    ).toEqual([0, 2.5, 7.5]);
  });

  it('formats at most two decimals and appends only a nonblank unit', () => {
    expect(formatMeasurementDistance(10, 'ft')).toBe('10 ft');
    expect(formatMeasurementDistance(10.256, ' ft ')).toBe('10.26 ft');
    expect(formatMeasurementDistance(1.2, '')).toBe('1.2');
  });
});
