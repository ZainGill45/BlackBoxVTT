import { describe, expect, it } from 'vitest';
import type {
  Container,
  Graphics,
  Text,
  TilingSprite,
} from '../../../../support/pixiStub';
import { SceneShapeRenderer } from '../../../../../features/play/canvas/sceneShapeRenderer';
import { DEFAULT_SHAPE_SETTINGS } from '../../../../../features/play/shapeSettings';
import { createEmptyShapeLayers, type SceneShape } from '../../../../../shared/scenes';
import { makeScene } from '../../../../support/scenes';
import { Container as PixiContainer } from 'pixi.js';

const id = '11111111-1111-4111-8111-111111111111';

function shape(overrides: Partial<SceneShape> = {}): SceneShape {
  return {
    height: 120,
    id,
    kind: 'sphere',
    ownerId: null,
    revision: 0,
    rotation: 0,
    style: DEFAULT_SHAPE_SETTINGS,
    width: 200,
    x: 300,
    y: 250,
    ...overrides,
  } as SceneShape;
}

function setup(
  current: SceneShape,
  zoom: number,
  view?: { maxX: number; maxY: number; minX: number; minY: number },
) {
  const map = new PixiContainer() as unknown as Container;
  const token = new PixiContainer() as unknown as Container;
  const gm = new PixiContainer() as unknown as Container;
  const renderer = new SceneShapeRenderer(
    map as never,
    token as never,
    gm as never,
  );
  const layers = createEmptyShapeLayers();
  layers.token.push(current);
  renderer.render(layers, makeScene(), zoom, view);
  const graphics = token.children
    .filter((child): child is Graphics => 'calls' in child)
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  return {
    graphics,
    hatch: token.children.find((child) => 'tileScale' in child) as
      | TilingSprite
      | undefined,
    labels: token.children.filter((child) => 'text' in child) as Text[],
    renderer,
    token,
  };
}

describe('SceneShapeRenderer', () => {
  it('keeps hatch, outline, and label dimensions stable through zoom', () => {
    const first = setup(shape(), 2);
    expect(first.graphics.calls.filter((call) => call.op === 'fill')).toEqual([]);
    expect(first.hatch?.tileScale.x).toBe(0.5);
    expect(
      first.graphics.calls
        .filter((call) => call.op === 'stroke')
        .map((call) => call.args[0]),
    ).toContainEqual(expect.objectContaining({ width: 1 }));
    expect(first.labels).toHaveLength(2);
    expect(first.labels.map((label) => label.text)).toEqual([
      expect.stringMatching(/^rₓ = /),
      expect.stringMatching(/^rᵧ = /),
    ]);
    expect(first.labels[0].style).toMatchObject({ fontSize: 16 });
    expect(first.labels[0].scale.x).toBe(0.5);

    first.renderer.render(
      { ...createEmptyShapeLayers(), token: [shape()] },
      makeScene(),
      4,
    );
    const label = first.token.children.find((child) => 'text' in child) as Text;
    expect(label.scale.x).toBe(0.25);
    const hatch = first.token.children.find((child) => 'tileScale' in child) as TilingSprite;
    expect(hatch).toBe(first.hatch);
    expect(hatch.tileScale.x).toBe(0.25);
    expect(
      first.graphics.calls
        .filter((call) => call.op === 'stroke')
        .map((call) => call.args[0]),
    ).toContainEqual(expect.objectContaining({ width: 0.5 }));
  });

  it('renders transparent circles without fill or measurement guides while retaining the outline and radius label', () => {
    const result = setup(shape({
      height: 100,
      style: { ...DEFAULT_SHAPE_SETTINGS, backgroundType: 'transparent' },
      width: 100,
    }), 1);
    expect(result.graphics.calls.filter((call) => call.op === 'fill')).toEqual([]);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0].text).toMatch(/^r = /);
    expect(result.labels[0].position).toMatchObject({ x: 300, y: 250 });
    expect(result.graphics.calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });

  it('centers the cone radius and keeps its angle inside the apex', () => {
    const result = setup(shape({
      kind: 'cone',
      spread: 53.13,
    }), 1);
    expect(result.labels.map((label) => label.text)).toEqual([
      expect.stringMatching(/^r = /),
      '53.13°',
    ]);
    expect(result.labels[0].position.x).toBeCloseTo(315, 0);
    expect(result.labels[0].position.y).toBe(250);
    expect(result.labels[1].position).toMatchObject({ x: 250, y: 250 });
    expect(result.graphics.calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });

  it('prefixes rectangle dimensions without measurement guides', () => {
    const result = setup(shape({ kind: 'square' }), 1);
    expect(result.labels.map((label) => label.text)).toEqual([
      expect.stringMatching(/^w = /),
      expect.stringMatching(/^h = /),
    ]);
    expect(result.graphics.calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });

  it('bounds screen-stable patterned work to the visible viewport at high zoom', () => {
    const result = setup(
      shape({
        height: 20_000,
        kind: 'square',
        style: {
          ...DEFAULT_SHAPE_SETTINGS,
          strokeType: 'dashed',
        },
        width: 20_000,
      }),
      8,
      { maxX: 350, maxY: 300, minX: 250, minY: 200 },
    );

    expect(result.hatch).toBeDefined();
    expect(result.graphics.calls.length).toBeLessThan(2_000);
  });

  it('updates cached z-order without geometry changes', () => {
    const first = shape({ width: 100, x: 200 });
    const second = shape({
      id: '22222222-2222-4222-8222-222222222222',
      width: 100,
      x: 400,
    });
    const layers = { ...createEmptyShapeLayers(), token: [first, second] };
    const record = makeScene({
      objectOrder: { gm: [], map: [], token: [first.id, second.id] },
      shapes: layers,
    });
    const map = new PixiContainer() as unknown as Container;
    const token = new PixiContainer() as unknown as Container;
    const gm = new PixiContainer() as unknown as Container;
    const renderer = new SceneShapeRenderer(map as never, token as never, gm as never);
    renderer.render(layers, record, 1);

    renderer.render(layers, {
      ...record,
      objectOrder: { gm: [], map: [], token: [second.id, first.id] },
    }, 1);
    const graphics = token.children.filter(
      (child): child is Graphics => 'calls' in child,
    );
    const firstGraphic = graphics.find((child) => child.position.x === first.x)!;
    const secondGraphic = graphics.find((child) => child.position.x === second.x)!;
    expect(firstGraphic.zIndex).toBeGreaterThan(secondGraphic.zIndex);
  });
});
