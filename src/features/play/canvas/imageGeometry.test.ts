import { describe, expect, it } from 'vitest';
import type { SceneImage } from '../../../shared/scenes';
import {
  containsPoint,
  moveBetweenLayers,
  rectangleCoverage,
  reorderSelected,
  roundTransform,
  snapMove,
  snappingActive,
} from './imageGeometry';

const image = (id: string, x = 0): SceneImage => ({
  assetId: '11111111-1111-4111-8111-111111111111',
  height: 20,
  id,
  rotation: 0,
  width: 40,
  x,
  y: 0,
});

describe('image geometry', () => {
  it('hits in rotated local space including transparent bounding-box pixels', () => {
    const rotated = { ...image('a'), rotation: 45 };

    expect(containsPoint(rotated, { x: 7, y: 7 })).toBe(true);
    expect(containsPoint(rotated, { x: 30, y: 30 })).toBe(false);
  });

  it('measures exact marquee coverage of a rotated rectangle', () => {
    const rotated = { ...image('a'), rotation: 45 };

    expect(
      rectangleCoverage(rotated, {
        maxX: 100,
        maxY: 100,
        minX: 0,
        minY: -100,
      }),
    ).toBeCloseTo(0.5, 5);
  });

  it('snaps the rotated local top-left corner using stored offsets', () => {
    const moved = snapMove(
      { ...image('a'), rotation: 90, x: 41, y: 46 },
      {
        color: '#ffffff',
        lineThickness: 1,
        offsetX: 5,
        offsetY: 10,
        opacity: 0,
        size: 25,
        type: 'square',
      },
    );

    expect(moved).toMatchObject({ x: 45, y: 55 });
  });

  it('inverts the snap default only for Left Alt state', () => {
    const square = {
      color: '#ffffff',
      lineThickness: 1,
      offsetX: 0,
      offsetY: 0,
      opacity: 0,
      size: 25,
      type: 'square' as const,
    };

    expect(snappingActive(square, false)).toBe(true);
    expect(snappingActive(square, true)).toBe(false);
    expect(snappingActive({ ...square, type: 'gridless' }, false)).toBe(false);
    expect(snappingActive({ ...square, type: 'gridless' }, true)).toBe(true);
  });

  it('moves selected runs one unselected neighbor while preserving order', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => image(id));
    const selected = new Set(['b', 'c', 'e']);

    expect(
      reorderSelected(items, selected, 'forward').map((item) => item.id),
    ).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(
      reorderSelected(items, selected, 'backward').map((item) => item.id),
    ).toEqual(['b', 'c', 'a', 'e', 'd']);
  });

  it('moves a group to the destination top and normalizes transforms', () => {
    const layers = {
      gm: [image('g')],
      map: [image('a'), image('b')],
      token: [image('t')],
    };
    const moved = moveBetweenLayers(layers, 'map', 'token', new Set(['a', 'b']));
    const rounded = roundTransform({
      ...image('r'),
      height: 0.2,
      rotation: -15,
      width: 0.1,
      x: 1.23456,
    });

    expect(moved.map).toEqual([]);
    expect(moved.token.map((item) => item.id)).toEqual(['t', 'a', 'b']);
    expect(rounded).toMatchObject({
      height: 1,
      rotation: 345,
      width: 1,
      x: 1.2346,
    });
  });
});
