import { describe, expect, it } from 'vitest';
import {
  createNudgePreview,
  nudgeSceneState,
  updateSceneEdit,
} from '../../../../../features/play/canvas/sceneEditInteraction';
import {
  sceneObjectStateOf,
  type SceneText,
} from '../../../../../shared/scenes';
import { makeScene } from '../../../../support/scenes';

const image = {
  assetId: '22222222-2222-4222-8222-222222222222',
  height: 100,
  id: '33333333-3333-4333-8333-333333333333',
  rotation: 0,
  width: 100,
  x: 100,
  y: 100,
};

const text: SceneText = {
  content: 'Label',
  id: '55555555-5555-4555-8555-555555555555',
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
  y: 100,
};

describe('scene edit interaction', () => {
  it('computes snapped movement without renderer state', () => {
    const scene = makeScene({
      images: { gm: [], map: [], token: [image] },
    });
    const update = updateSceneEdit({
      currentGroupRotation: 0,
      disableSnapping: false,
      gesture: {
        before: sceneObjectStateOf(scene),
        groupRotationBefore: 0,
        kind: 'edit',
        mode: 'move',
        pointerId: 1,
        previewOperationId: null,
        previewPivot: { x: 0, y: 0 },
        resizeCorner: 0,
        start: { x: 100, y: 100 },
      },
      point: { x: 130, y: 140 },
      preserveAspectRatio: true,
      scene,
      selected: new Set([image.id]),
    });

    expect(update?.state.images.token[0]).toMatchObject({ x: 120, y: 120 });
  });

  it('nudges selected state and creates the matching live preview', () => {
    const scene = makeScene({
      grid: {
        color: '#ffffff',
        lineThickness: 1,
        offsetX: 0,
        offsetY: 0,
        opacity: 1,
        size: 70,
        type: 'square',
      },
      images: { gm: [], map: [], token: [image] },
    });
    const state = nudgeSceneState(scene, new Set([image.id]), 'ArrowRight', false);
    const updated = { ...scene, ...state };
    const preview = createNudgePreview(
      [{ id: image.id, image }],
      updated,
      '44444444-4444-4444-8444-444444444444',
    );

    expect(state.images.token[0].x).toBe(170);
    expect(preview).toMatchObject({ dx: 70, dy: 0, scaleX: 1, scaleY: 1 });
  });

  it('moves and nudges measured text with text-shaped transform previews', () => {
    const scene = makeScene({
      grid: { ...makeScene().grid, type: 'gridless' },
      texts: { gm: [], map: [], token: [text] },
    });
    const bounds = () => ({ height: 40, width: 100 });
    const moved = updateSceneEdit({
      currentGroupRotation: 0,
      disableSnapping: false,
      gesture: {
        before: sceneObjectStateOf(scene),
        groupRotationBefore: 0,
        kind: 'edit',
        mode: 'move',
        pointerId: 1,
        previewOperationId: '66666666-6666-4666-8666-666666666666',
        previewPivot: { x: 100, y: 100 },
        resizeCorner: 0,
        start: { x: 100, y: 100 },
      },
      point: { x: 125, y: 130 },
      preserveAspectRatio: true,
      scene,
      selected: new Set([text.id]),
      textBounds: bounds,
    });
    expect(moved?.state.texts.token[0]).toMatchObject({ x: 125, y: 130 });
    expect(moved?.preview?.absolute).toEqual({
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      x: 125,
      y: 130,
    });

    const nudged = nudgeSceneState(
      scene,
      new Set([text.id]),
      'ArrowDown',
      false,
      bounds,
    );
    const preview = createNudgePreview(
      [{ id: text.id, image: { ...image, height: 40 }, text }],
      { ...scene, ...nudged },
      '77777777-7777-4777-8777-777777777777',
    );
    expect(nudged.texts.token[0].y).toBe(101);
    expect(preview?.absolute).toMatchObject({ scaleX: 1, scaleY: 1, y: 101 });
  });
});
