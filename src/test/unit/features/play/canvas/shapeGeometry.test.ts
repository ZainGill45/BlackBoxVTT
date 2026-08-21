import { describe, expect, it } from 'vitest';
import {
  containsShapePoint,
  createShapeFromDrag,
  editShapeWithSemanticHandle,
  semanticShapeHandles,
  shapeDistance,
} from '../../../../../features/play/canvas/shapeGeometry';
import { DEFAULT_SHAPE_SETTINGS } from '../../../../../features/play/shapeSettings';
import { createDefaultGrid, type SceneShape } from '../../../../../shared/scenes';

const id = '11111111-1111-4111-8111-111111111111';
const scene = (type: 'gridless' | 'square' = 'square') => ({
  distance: 5,
  grid: { ...createDefaultGrid(), offsetX: 10, offsetY: 20, size: 50, type },
  pixelScale: 100,
});

function drag(
  kind: 'cone' | 'sphere' | 'square',
  modifiers: { altKey?: boolean; ctrlKey?: boolean } = {},
) {
  return createShapeFromDrag({
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    end: { x: 122, y: 178 },
    id,
    kind,
    ownerId: null,
    scene: scene(),
    start: { x: 17, y: 26 },
    style: DEFAULT_SHAPE_SETTINGS,
  });
}

describe('shape creation geometry', () => {
  it('implements every quantized and proportional modifier combination', () => {
    const proportional = drag('sphere');
    const ctrlOnly = drag('sphere', { ctrlKey: true });
    const nonProportional = drag('sphere', { altKey: true });
    const freeform = drag('sphere', { altKey: true, ctrlKey: true });

    expect(proportional).toMatchObject({
      height: 400,
      width: 400,
      x: 17,
      y: 26,
    });
    expect(ctrlOnly).toEqual(proportional);
    expect(nonProportional).toMatchObject({
      height: 300,
      width: 200,
      x: 17,
      y: 26,
    });
    expect(freeform).toMatchObject({
      height: 304,
      width: 210,
      x: 17,
      y: 26,
    });
  });

  it('uses dominant square sides and independent Alt dimensions', () => {
    expect(drag('square')).toMatchObject({ height: 150, width: 150 });
    expect(drag('square', { altKey: true })).toMatchObject({
      height: 150,
      width: 100,
    });
  });

  it('fits cones to quantized and freeform bounds with the visible spread', () => {
    expect(drag('cone')).toMatchObject({ kind: 'cone', spread: 53.13 });
    const quantized = drag('cone', { altKey: true });
    expect(quantized).toMatchObject({
      height: 300,
      kind: 'cone',
      width: 100,
    });
    expect(quantized?.kind === 'cone' ? quantized.spread : 0).toBeGreaterThan(53.13);
    expect(drag('cone', { altKey: true, ctrlKey: true })).toMatchObject({
      height: 304,
      width: 105,
    });
  });

  it('behaves identically with or without a visible grid and rejects zero-size gestures', () => {
    expect({ ...drag('square') }).toEqual({
      ...createShapeFromDrag({
        altKey: false,
        ctrlKey: false,
        end: { x: 122, y: 178 },
        id,
        kind: 'square',
        ownerId: null,
        scene: scene('gridless'),
        start: { x: 17, y: 26 },
        style: DEFAULT_SHAPE_SETTINGS,
      }),
    });
    expect(createShapeFromDrag({
      altKey: true,
      ctrlKey: true,
      end: { x: 10, y: 20 },
      id,
      kind: 'sphere',
      ownerId: null,
      scene: scene('gridless'),
      start: { x: 10, y: 20 },
      style: DEFAULT_SHAPE_SETTINGS,
    })).toBeNull();
  });
});

describe('shape hit testing and semantic handles', () => {
  const cone: SceneShape = {
    height: 90,
    id,
    kind: 'cone',
    ownerId: null,
    revision: 0,
    rotation: 0,
    spread: 60,
    style: DEFAULT_SHAPE_SETTINGS,
    width: 100,
    x: 50,
    y: 50,
  };

  it('uses analytic hit testing instead of only bounds', () => {
    expect(containsShapePoint(cone, { x: 10, y: 50 })).toBe(true);
    expect(containsShapePoint(cone, { x: 10, y: 5 })).toBe(false);
  });

  it('preserves cone aspect and apex while changing reach', () => {
    const next = editShapeWithSemanticHandle(cone, 'reach', { x: 250, y: 50 });
    expect(next).toMatchObject({ height: 225, rotation: 0, width: 250 });
    expect(next?.x).toBe(125);
  });

  it('changes spread symmetrically while preserving reach and ellipticity', () => {
    const spreadHandle = semanticShapeHandles(cone).find(
      (handle) => handle.kind === 'spread',
    );
    expect(spreadHandle).toBeDefined();
    const next = editShapeWithSemanticHandle(cone, 'spread', { x: 50, y: 140 });
    expect(next?.kind).toBe('cone');
    if (next?.kind === 'cone') {
      expect(next.spread).toBeGreaterThan(60);
      expect(next.spread).toBeLessThanOrEqual(179);
      expect(next.width).toBe(cone.width);
    }
  });

  it('reuses scene scale for labels', () => {
    expect(shapeDistance({ distance: 5, pixelScale: 100 }, 300)).toBe(15);
  });
});
