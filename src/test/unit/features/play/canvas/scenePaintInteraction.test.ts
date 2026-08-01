import { describe, expect, it } from 'vitest';
import {
  advancePolyline,
  appendFreeformPoint,
  compactPreviewPoints,
  createSceneDrawing,
} from '../../../../../features/play/canvas/scenePaintInteraction';
import type { SceneDrawingStyle } from '../../../../../shared/scenes';

const style: SceneDrawingStyle = {
  edge: 'hard',
  fillColor: '#ffffff',
  fillEnabled: true,
  fillOpacity: 0.25,
  hardness: 1,
  strokeColor: '#ffffff',
  strokeOpacity: 1,
  strokeWidth: 8,
};

describe('scene paint interaction', () => {
  it('samples freeform movement in screen-space resolution', () => {
    const points = [{ x: 0, y: 0 }];
    expect(appendFreeformPoint(points, { x: 0.1, y: 0 }, 1)).toBe(false);
    expect(appendFreeformPoint(points, { x: 0.3, y: 0 }, 1)).toBe(true);
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 0.3, y: 0 }]);
  });

  it('closes near the first polyline point before considering double-click', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    expect(advancePolyline(points, { x: 2, y: 1 }, 2, 1)).toBe('close');
    expect(points).toHaveLength(3);
    expect(advancePolyline(points, { x: 100, y: 100 }, 2, 1)).toBe(
      'finish',
    );
  });

  it('normalizes committed drawings around their center', () => {
    const drawing = createSceneDrawing(
      [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      'polyline',
      style,
      true,
      'drawing-id',
      'player-id',
    );

    expect(drawing).toMatchObject({
      closed: true,
      id: 'drawing-id',
      ownerId: 'player-id',
      x: 20,
      y: 30,
    });
    expect(drawing.points).toEqual([{ x: -10, y: -10 }, { x: 10, y: 10 }]);
    expect(drawing.style.fillEnabled).toBe(true);
  });

  it('compacts previews while preserving both endpoints', () => {
    const points = Array.from({ length: 20 }, (_, x) => ({ x, y: x * 2 }));
    const compacted = compactPreviewPoints(points, 5);
    expect(compacted).toHaveLength(5);
    expect(compacted[0]).toEqual(points[0]);
    expect(compacted.at(-1)).toEqual(points.at(-1));
  });
});
