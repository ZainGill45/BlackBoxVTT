import { describe, expect, it } from 'vitest';
import { createDefaultGrid, type SceneGrid } from '../../../../../shared/scenes';
import { computeGridLines, MIN_SCREEN_SPACING } from '../../../../../features/play/canvas/grid';

const scene = { height: 400, width: 400 };
const everything = { maxX: 400, maxY: 400, minX: 0, minY: 0 };

function squareGrid(overrides: Partial<SceneGrid> = {}): SceneGrid {
  return { ...createDefaultGrid(), size: 100, type: 'square', ...overrides };
}

describe('computeGridLines', () => {
  it('produces nothing for a gridless scene', () => {
    expect(
      computeGridLines(scene, squareGrid({ type: 'gridless' }), everything, 1),
    ).toEqual({ columns: [], rows: [] });
  });

  it('lines up on multiples of the grid size', () => {
    expect(computeGridLines(scene, squareGrid(), everything, 1)).toEqual({
      columns: [0, 100, 200, 300, 400],
      rows: [0, 100, 200, 300, 400],
    });
  });

  it('shifts the lattice by the configured offsets', () => {
    expect(
      computeGridLines(
        scene,
        squareGrid({ offsetX: 25, offsetY: -10 }),
        everything,
        1,
      ),
    ).toEqual({
      columns: [25, 125, 225, 325],
      rows: [90, 190, 290, 390],
    });
  });

  it('culls to the visible rectangle and clips to the scene', () => {
    const lines = computeGridLines(
      scene,
      squareGrid(),
      { maxX: 1000, maxY: 250, minX: 150, minY: -1000 },
      1,
    );

    expect(lines).toEqual({ columns: [200, 300, 400], rows: [0, 100, 200] });
  });

  it('drops the grid once the squares are too small to read', () => {
    const zoom = (MIN_SCREEN_SPACING - 1) / 100;

    expect(computeGridLines(scene, squareGrid(), everything, zoom)).toEqual({
      columns: [],
      rows: [],
    });
  });

  it('drops the grid when it is fully transparent', () => {
    expect(
      computeGridLines(scene, squareGrid({ opacity: 0 }), everything, 1),
    ).toEqual({ columns: [], rows: [] });
  });

  it('produces nothing when the scene is entirely off screen', () => {
    expect(
      computeGridLines(
        scene,
        squareGrid(),
        { maxX: 2000, maxY: 2000, minX: 1000, minY: 1000 },
        1,
      ),
    ).toEqual({ columns: [], rows: [] });
  });
});
