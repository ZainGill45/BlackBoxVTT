import { describe, expect, it } from 'vitest';
import {
  compactFogBrushPoints,
  compactFogOperations,
} from '../../shared/sceneFogGeometry';
import type { SceneFogOperation } from '../../shared/scenes';

describe('scene fog geometry', () => {
  it('reduces a densely sampled straight stroke to its endpoints', () => {
    const points = Array.from({ length: 2_001 }, (_value, index) => ({
      x: index / 10,
      y: 50,
    }));

    expect(compactFogBrushPoints(points, 70)).toEqual([
      points[0],
      points.at(-1),
    ]);
  });

  it('preserves corners that materially change the brush path', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    expect(compactFogBrushPoints(points, 70)).toEqual(points);
  });

  it('keeps accumulated operations and endpoints within a total point budget', () => {
    const operations: SceneFogOperation[] = Array.from(
      { length: 6 },
      (_value, operationIndex) => ({
        hardness: 1,
        id: `${operationIndex}0000000-0000-4000-8000-000000000000`,
        kind: 'brush',
        mode: operationIndex % 2 === 0 ? 'hide' : 'reveal',
        points: Array.from({ length: 4_000 }, (_point, pointIndex) => ({
          x: pointIndex * 0.4,
          y: 100 + (pointIndex % 2),
        })),
        width: 1,
      }),
    );

    const compacted = compactFogOperations(operations, 10_000);
    const pointCount = compacted.reduce(
      (total, operation) =>
        total + (operation.kind === 'brush' ? operation.points.length : 0),
      0,
    );

    expect(pointCount).toBeLessThanOrEqual(10_000);
    expect(compacted.map((operation) => operation.id)).toEqual(
      operations.map((operation) => operation.id),
    );
    for (let index = 0; index < compacted.length; index += 1) {
      const before = operations[index];
      const after = compacted[index];
      if (before.kind !== 'brush' || after.kind !== 'brush') {
        throw new Error('brush operation expected');
      }
      expect(after.points[0]).toEqual(before.points[0]);
      expect(after.points.at(-1)).toEqual(before.points.at(-1));
    }
  });
});
