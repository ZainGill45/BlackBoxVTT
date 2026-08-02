import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE_SETTINGS } from '../../features/play/shapeSettings';
import {
  persistedSceneRecordSchema,
  sceneObjectStateSchema,
  sceneShapeSchema,
} from '../../shared/sceneSchema';
import {
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  createSceneObjectOrder,
  MAX_SCENE_SHAPES,
  sceneObjectStateOf,
  type SceneShape,
} from '../../shared/scenes';
import { makeScene } from '../support/scenes';

function sphere(id = '11111111-1111-4111-8111-111111111111'): SceneShape {
  return {
    height: 100,
    id,
    kind: 'sphere',
    ownerId: null,
    revision: 0,
    rotation: 0,
    style: DEFAULT_SHAPE_SETTINGS,
    width: 100,
    x: 50,
    y: 50,
  };
}

describe('scene shape schema', () => {
  it('validates every shape kind and enforces cone spread bounds', () => {
    expect(sceneShapeSchema.safeParse(sphere()).success).toBe(true);
    expect(sceneShapeSchema.safeParse({ ...sphere(), kind: 'square' }).success).toBe(true);
    expect(sceneShapeSchema.safeParse({ ...sphere(), kind: 'cone', spread: 53.13 }).success).toBe(true);
    expect(sceneShapeSchema.safeParse({ ...sphere(), kind: 'cone', spread: 0 }).success).toBe(false);
    expect(sceneShapeSchema.safeParse({ ...sphere(), kind: 'cone', spread: 180 }).success).toBe(false);
  });

  it('defaults persisted records that predate shape layers', () => {
    const record = structuredClone(makeScene()) as Record<string, unknown>;
    delete record.shapes;
    expect(persistedSceneRecordSchema.parse(record).shapes).toEqual(
      createEmptyShapeLayers(),
    );
  });

  it('removes retired labels and derives shapes below images in persisted fallback order', () => {
    const legacyShape = sphere();
    const legacyRecord = structuredClone(makeScene({
      images: {
        ...createEmptyImageLayers(),
        map: [{
          assetId: '22222222-2222-4222-8222-222222222222',
          height: 10,
          id: '33333333-3333-4333-8333-333333333333',
          rotation: 0,
          width: 10,
          x: 0,
          y: 0,
        }],
      },
      shapes: { ...createEmptyShapeLayers(), map: [legacyShape] },
    })) as Record<string, unknown>;
    delete legacyRecord.objectOrder;
    (legacyRecord.shapes as { map: Array<Record<string, unknown>> })
      .map[0].label = 'Retired label';

    const parsed = persistedSceneRecordSchema.parse(legacyRecord);
    expect('label' in parsed.shapes.map[0]).toBe(false);
    expect(parsed.objectOrder.map).toEqual([
      legacyShape.id,
      '33333333-3333-4333-8333-333333333333',
    ]);
  });

  it('rejects duplicate and wrong-layer ordering entries', () => {
    const state = sceneObjectStateOf(makeScene({
      shapes: { ...createEmptyShapeLayers(), token: [sphere()] },
    }));
    state.objectOrder.token = [sphere().id, sphere().id];
    expect(sceneObjectStateSchema.safeParse(state).success).toBe(false);

    state.objectOrder = createSceneObjectOrder({
      drawings: state.drawings,
      images: state.images,
      shapes: state.shapes,
      texts: state.texts,
    });
    state.objectOrder.token = [];
    state.objectOrder.map = [sphere().id];
    expect(sceneObjectStateSchema.safeParse(state).success).toBe(false);
  });

  it('enforces the shape limit and cross-family UUID uniqueness', () => {
    const shapes = createEmptyShapeLayers();
    shapes.token = Array.from({ length: MAX_SCENE_SHAPES + 1 }, (_, index) =>
      sphere(`00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`),
    );
    expect(sceneObjectStateSchema.safeParse({
      drawings: createEmptyDrawingLayers(),
      images: createEmptyImageLayers(),
      mapImage: null,
      objectOrder: createSceneObjectOrder({
        drawings: createEmptyDrawingLayers(),
        images: createEmptyImageLayers(),
        shapes,
        texts: createEmptyTextLayers(),
      }),
      shapes,
      texts: createEmptyTextLayers(),
    }).success).toBe(false);

    const duplicate = sphere();
    expect(sceneObjectStateSchema.safeParse({
      drawings: createEmptyDrawingLayers(),
      images: {
        ...createEmptyImageLayers(),
        token: [{
          assetId: '22222222-2222-4222-8222-222222222222',
          height: 10,
          id: duplicate.id,
          rotation: 0,
          width: 10,
          x: 0,
          y: 0,
        }],
      },
      mapImage: null,
      objectOrder: {
        gm: [],
        map: [],
        token: [duplicate.id, duplicate.id],
      },
      shapes: { ...createEmptyShapeLayers(), token: [duplicate] },
      texts: createEmptyTextLayers(),
    }).success).toBe(false);
  });
});
