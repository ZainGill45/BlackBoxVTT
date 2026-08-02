import { describe, expect, it } from 'vitest';
import {
  fogCoversPoint,
  fogOperationContainsPoint,
  SceneFogRenderer,
} from '../../../../../features/play/canvas/sceneFogRenderer';
import { makeScene } from '../../../../support/scenes';

const hiddenBox = {
  height: 100,
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'box' as const,
  mode: 'hide' as const,
  width: 100,
  x: 20,
  y: 30,
};

describe('fog geometry and rendering policy', () => {
  it('replays operations in order from the scene base state', () => {
    const revealedBox = {
      ...hiddenBox,
      id: '22222222-2222-4222-8222-222222222222',
      mode: 'reveal' as const,
      width: 25,
    };
    const fog = {
      base: 'clear' as const,
      color: '#000000',
      operations: [hiddenBox, revealedBox],
    };

    expect(fogCoversPoint(fog, { x: 30, y: 40 })).toBe(false);
    expect(fogCoversPoint(fog, { x: 80, y: 40 })).toBe(true);
    expect(fogCoversPoint(fog, { x: 180, y: 40 })).toBe(false);
  });

  it('uses the complete brush path and radius for point coverage', () => {
    const brush = {
      hardness: 0.25,
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'brush' as const,
      mode: 'hide' as const,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      width: 20,
    };

    expect(fogOperationContainsPoint(brush, { x: 50, y: 9 })).toBe(true);
    expect(fogOperationContainsPoint(brush, { x: 50, y: 11 })).toBe(false);
  });

  it('forces player fog opacity to one while honoring the GM preview setting', () => {
    const renderer = new SceneFogRenderer();
    const scene = makeScene({
      fog: { base: 'covered', color: '#123456', operations: [] },
    });
    const input = {
      camera: { x: scene.width / 2, y: scene.height / 2, zoom: 1 },
      gmOpacity: 0.2,
      operations: [],
      scene,
      viewport: { height: 600, width: 800 },
    };

    renderer.render({ ...input, isGameMaster: false });
    expect(renderer.sprite.alpha).toBe(1);
    renderer.render({ ...input, isGameMaster: true });
    expect(renderer.sprite.alpha).toBe(0.2);
    renderer.destroy();
  });
});
