import { describe, expect, it } from 'vitest';
import {
  activeSceneTargets,
  canCreateSceneImages,
  createTargetAccessor,
  deleteSelectedObjects,
  duplicateSceneImages,
  moveSelectedImagesToLayer,
  reorderSelectedImages,
  selectedSceneTargets,
  selectionFrame,
} from '../../../../../features/play/canvas/sceneSelection';
import { imageStateOf, type SceneDrawing } from '../../../../../shared/scenes';
import { makeScene } from '../../../../support/scenes';

const image = {
  assetId: '22222222-2222-4222-8222-222222222222',
  height: 100,
  id: '33333333-3333-4333-8333-333333333333',
  rotation: 0,
  width: 200,
  x: 300,
  y: 200,
};

function drawing(ownerId: string): SceneDrawing {
  return {
    closed: false,
    id: '44444444-4444-4444-8444-444444444444',
    kind: 'freeform',
    ownerId,
    points: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style: {
      edge: 'hard',
      fillColor: '#ffffff',
      fillEnabled: false,
      fillOpacity: 0,
      hardness: 1,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWidth: 2,
    },
    x: 100,
    y: 100,
  };
}

describe('scene selection model', () => {
  it('filters active and selected targets through actor capabilities', () => {
    const owned = drawing('player-a');
    const foreign = { ...drawing('player-b'), id: 'foreign' };
    const scene = makeScene({
      drawings: { gm: [], map: [], token: [owned, foreign] },
      images: { gm: [], map: [], token: [image] },
    });
    const policy = {
      activeLayer: 'token' as const,
      actorId: 'player-a',
      canEditImages: false,
    };

    expect(activeSceneTargets(scene, policy).map(({ id }) => id)).toEqual([
      owned.id,
    ]);
    expect(
      selectedSceneTargets(
        scene,
        new Set([image.id, owned.id, foreign.id]),
        policy,
      ).map(({ id }) => id),
    ).toEqual([owned.id]);
  });

  it('writes image and drawing transforms through one state accessor', () => {
    const owned = drawing('player-a');
    const state = imageStateOf(
      makeScene({
        drawings: { gm: [], map: [], token: [owned] },
        images: { gm: [], map: [], token: [image] },
      }),
    );
    const targets = createTargetAccessor(state);
    targets.write(image.id, { ...image, x: 500 });
    targets.write(owned.id, { ...targets.read(owned.id)!, height: 20, x: 150 });

    expect(state.images.token[0].x).toBe(500);
    expect(state.drawings.token[0]).toMatchObject({ scaleY: 10, x: 150 });
  });

  it('computes one frame for multi-selection', () => {
    const frame = selectionFrame(
      [
        { id: image.id, image },
        { id: 'second', image: { ...image, id: 'second', x: 600 } },
      ],
      0,
    );
    expect(frame).toMatchObject({ center: { x: 450, y: 200 }, width: 500 });
  });

  it('computes selection commands without renderer state', () => {
    const second = { ...image, id: 'second', x: 600 };
    const scene = makeScene({
      images: { gm: [], map: [], token: [image, second] },
    });
    const selected = new Set([image.id]);
    const before = imageStateOf(scene);

    expect(canCreateSceneImages(scene, 1, 3)).toBe(true);
    expect(
      duplicateSceneImages([image], 20, () => 'copy')[0],
    ).toMatchObject({ id: 'copy', x: 320, y: 220 });
    expect(
      moveSelectedImagesToLayer(before, selected, 'map').images.map,
    ).toHaveLength(1);
    expect(
      reorderSelectedImages(before, selected, 'token', 'front').images.token
        .at(-1)?.id,
    ).toBe(image.id);
    expect(deleteSelectedObjects(before, selected).images.token).toEqual([
      second,
    ]);
  });
});
