import { describe, expect, it } from 'vitest';
import {
  MAX_SCENE_TEXTS,
  MAX_SCENE_TEXT_RASTER_PIXELS,
  MAX_TEXT_CHARACTERS,
  MAX_TEXT_LINES,
  MAX_TEXT_RASTER_PIXELS,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyTextLayers,
  estimateSceneTextRaster,
  type SceneText,
} from '../../shared/scenes';
import {
  persistedSceneRecordSchema,
  sceneObjectStateSchema,
  sceneRecordSchema,
  sceneTextLayersSchema,
  sceneTextSchema,
} from '../../shared/sceneSchema';
import { makeScene } from '../support/scenes';

function id(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function text(
  index = 1,
  overrides: Partial<SceneText> = {},
): SceneText {
  return {
    content: 'The Iron Keep',
    id: id(index),
    ownerId: null,
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style: {
      fontFamily: 'inter',
      fontSize: 32,
      fontWeight: 600,
      primaryColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 2,
    },
    x: 100,
    y: 200,
    ...overrides,
  };
}

describe('scene text schemas', () => {
  it('accepts the supported font, weight, color, stroke, and multiline values', () => {
    const families = ['inter', 'lora', 'roboto-mono', 'cinzel'] as const;
    const weights = [400, 500, 600, 700] as const;

    for (const [index, fontFamily] of families.entries()) {
      expect(
        sceneTextSchema.safeParse(
          text(index + 1, {
            content: '  First line\nSecond line 😀  ',
            style: {
              ...text().style,
              fontFamily,
              fontWeight: weights[index],
              strokeWidth: index === 0 ? 0 : 2,
            },
          }),
        ).success,
      ).toBe(true);
    }
  });

  it('rejects invalid content, style bounds, line counts, and raster dimensions', () => {
    const invalid = [
      text(1, { content: '' }),
      text(2, { content: ' \n\t ' }),
      text(3, { content: 'x'.repeat(MAX_TEXT_CHARACTERS + 1) }),
      text(4, { content: Array(MAX_TEXT_LINES + 1).fill('x').join('\n') }),
      text(5, { content: 'x'.repeat(513), style: { ...text().style, fontSize: 8 } }),
      text(6, { style: { ...text().style, fontSize: 7 } }),
      text(7, { style: { ...text().style, fontWeight: 300 as 400 } }),
      text(8, { style: { ...text().style, primaryColor: '#fff' } }),
      text(9, { style: { ...text().style, strokeWidth: 33 } }),
    ];

    expect(invalid.every((candidate) => !sceneTextSchema.safeParse(candidate).success)).toBe(
      true,
    );
  });

  it('limits physical texture area even when both raster dimensions are safe', () => {
    const candidate = text(1, {
      content: Array.from({ length: 8 }, () => 'x'.repeat(12)).join('\n'),
      style: { ...text().style, fontSize: 256, strokeWidth: 32 },
    });
    const raster = estimateSceneTextRaster(candidate);

    expect(raster.width).toBeLessThanOrEqual(8_192);
    expect(raster.height).toBeLessThanOrEqual(8_192);
    expect(raster.pixels).toBeGreaterThan(MAX_TEXT_RASTER_PIXELS);
    expect(sceneTextSchema.safeParse(candidate).success).toBe(false);
  });

  it('limits aggregate text texture allocation below other scene totals', () => {
    const layers = createEmptyTextLayers();
    layers.map = Array.from({ length: 10 }, (_, index) =>
      text(index + 1, {
        content: 'x'.repeat(12),
        style: { ...text().style, fontSize: 256, strokeWidth: 32 },
      }),
    );
    const rasterPixels = layers.map.reduce(
      (total, candidate) => total + estimateSceneTextRaster(candidate).pixels,
      0,
    );

    expect(rasterPixels).toBeGreaterThan(MAX_SCENE_TEXT_RASTER_PIXELS);
    expect(layers.map.every((candidate) => sceneTextSchema.safeParse(candidate).success)).toBe(
      true,
    );
    expect(sceneTextLayersSchema.safeParse(layers).success).toBe(false);
  });

  it('enforces per-scene object and character totals across all three layers', () => {
    const tooMany = createEmptyTextLayers();
    tooMany.map = Array.from({ length: MAX_SCENE_TEXTS }, (_, index) =>
      text(index + 1, { content: 'x' }),
    );
    tooMany.token.push(text(MAX_SCENE_TEXTS + 1, { content: 'x' }));
    expect(sceneTextLayersSchema.safeParse(tooMany).success).toBe(false);

    const tooLong = createEmptyTextLayers();
    const content = Array.from({ length: 32 }, () => 'x'.repeat(60)).join('\n');
    tooLong.gm = Array.from({ length: 34 }, (_, index) =>
      text(index + 1, {
        content,
        style: { ...text().style, fontSize: 8 },
      }),
    );
    expect(sceneTextLayersSchema.safeParse(tooLong).success).toBe(false);
  });

  it('rejects duplicate IDs within text and across scene object kinds', () => {
    const duplicateTexts = createEmptyTextLayers();
    duplicateTexts.map.push(text(1));
    duplicateTexts.token.push(text(1));
    expect(sceneTextLayersSchema.safeParse(duplicateTexts).success).toBe(false);

    const state = {
      drawings: createEmptyDrawingLayers(),
      images: {
        ...createEmptyImageLayers(),
        token: [
          {
            assetId: id(20),
            height: 10,
            id: id(1),
            rotation: 0,
            width: 10,
            x: 0,
            y: 0,
          },
        ],
      },
      mapImage: null,
      texts: { ...createEmptyTextLayers(), map: [text(1)] },
    };
    expect(sceneObjectStateSchema.safeParse(state).success).toBe(false);
    expect(sceneRecordSchema.safeParse(makeScene(state)).success).toBe(false);
  });

  it('adds empty text layers only when parsing persisted pre-v5 scene records', () => {
    const current = makeScene();
    const legacy = structuredClone(current) as Record<string, unknown>;
    delete legacy.texts;

    expect(sceneRecordSchema.safeParse(legacy).success).toBe(false);
    expect(persistedSceneRecordSchema.parse(legacy).texts).toEqual(
      createEmptyTextLayers(),
    );
  });
});
