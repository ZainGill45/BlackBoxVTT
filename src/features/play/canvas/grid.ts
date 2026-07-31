import type { SceneGrid } from '../../../shared/scenes';

/** Below this on-screen spacing the grid reads as a solid fill, so we skip it. */
export const MIN_SCREEN_SPACING = 4;

interface GridBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface GridLines {
  /** Scene-space x coordinates of the vertical lines. */
  columns: number[];
  /** Scene-space y coordinates of the horizontal lines. */
  rows: number[];
}

const EMPTY: GridLines = { columns: [], rows: [] };

function ticks(from: number, to: number, offset: number, size: number) {
  const values: number[] = [];
  const first = Math.ceil((from - offset) / size) * size + offset;
  for (let value = first; value <= to; value += size) {
    values.push(value);
  }
  return values;
}

/**
 * Grid lines for the part of the scene currently on screen. Culling by the
 * viewport keeps a large scene with a fine grid from generating a line per
 * square across the whole map.
 */
export function computeGridLines(
  scene: { height: number; width: number },
  grid: SceneGrid,
  visible: GridBounds,
  zoom: number,
): GridLines {
  if (grid.type !== 'square' || grid.size <= 0 || grid.opacity <= 0) {
    return EMPTY;
  }
  if (grid.size * zoom < MIN_SCREEN_SPACING) {
    return EMPTY;
  }

  const left = Math.max(0, visible.minX);
  const right = Math.min(scene.width, visible.maxX);
  const top = Math.max(0, visible.minY);
  const bottom = Math.min(scene.height, visible.maxY);
  if (right <= left || bottom <= top) {
    return EMPTY;
  }

  return {
    columns: ticks(left, right, grid.offsetX, grid.size),
    rows: ticks(top, bottom, grid.offsetY, grid.size),
  };
}
