import { describe, expect, it, vi } from 'vitest';
import {
  committedFogTextureResolution,
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
      scene,
      viewport: { height: 600, width: 800 },
    };

    renderer.render({ ...input, isGameMaster: false });
    expect(renderer.sprite.alpha).toBe(1);
    renderer.render({ ...input, isGameMaster: true });
    expect(renderer.sprite.alpha).toBe(0.2);
    renderer.destroy();
  });

  it('retains committed fog and appends only the new local brush segment', () => {
    const renderer = new SceneFogRenderer();
    const render = vi.fn();
    renderer.attach({ render } as never);
    const committed = Array.from({ length: 200 }, (_, index) => ({
      ...hiddenBox,
      id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      x: index,
    }));
    const scene = makeScene({
      fog: { base: 'clear', color: '#123456', operations: committed },
    });
    const input = {
      camera: { x: scene.width / 2, y: scene.height / 2, zoom: 1 },
      gmOpacity: 0.2,
      isGameMaster: true,
      scene,
      viewport: { height: 600, width: 800 },
    };

    renderer.render(input);
    expect(render).toHaveBeenCalledTimes(1);
    render.mockClear();

    renderer.render({
      ...input,
      camera: { ...input.camera, x: input.camera.x + 50, zoom: 1.5 },
    });
    expect(render).not.toHaveBeenCalled();
    expect(renderer.sprite.scale.x).toBe(1.5);

    const operation = {
      hardness: 0.4,
      id: '99999999-9999-4999-8999-999999999999',
      kind: 'brush' as const,
      mode: 'hide' as const,
      points: [{ x: 100, y: 100 }, { x: 120, y: 120 }],
      width: 80,
    };
    renderer.render({ ...input, localOperation: operation });
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0][0]).toMatchObject({ clear: true });
    render.mockClear();

    operation.points.push({ x: 140, y: 140 }, { x: 160, y: 160 });
    renderer.render({ ...input, localOperation: operation });
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0][0]).toMatchObject({ clear: false });

    renderer.destroy();
  });

  it('appends a committed operation without replaying committed history', () => {
    const renderer = new SceneFogRenderer();
    const renderedChildren: number[] = [];
    renderer.attach({
      render: vi.fn(({ container }: { container: { children: unknown[] } }) => {
        renderedChildren.push(container.children.length);
      }),
    } as never);
    const committed = Array.from({ length: 200 }, (_, index) => ({
      ...hiddenBox,
      id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      x: index,
    }));
    const scene = makeScene({
      fog: { base: 'clear', color: '#123456', operations: committed },
    });
    const input = {
      camera: { x: scene.width / 2, y: scene.height / 2, zoom: 1 },
      gmOpacity: 0.2,
      isGameMaster: true,
      scene,
      viewport: { height: 600, width: 800 },
    };

    renderer.render(input);
    expect(renderedChildren).toEqual([200]);
    renderedChildren.length = 0;

    renderer.render({
      ...input,
      scene: {
        ...scene,
        fog: {
          ...scene.fog,
          operations: [
            ...scene.fog.operations,
            {
              ...hiddenBox,
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              x: 300,
            },
          ],
        },
      },
    });
    expect(renderedChildren).toEqual([1]);
    renderer.destroy();
  });

  it('caps the backing texture while retaining logical scene dimensions', () => {
    expect(committedFogTextureResolution({ height: 20_000, width: 20_000 }))
      .toBeCloseTo(4_096 / 20_000);
    expect(committedFogTextureResolution({ height: 1_000, width: 2_000 }))
      .toBe(1);
  });
});
