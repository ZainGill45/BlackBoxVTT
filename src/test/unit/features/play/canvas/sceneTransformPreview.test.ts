import { describe, expect, it } from 'vitest';
import { applySceneTransformPreview } from '../../../../../shared/scenes';
import { makeScene, testCampaignId } from '../../../../support/scenes';
import type { SceneText } from '../../../../../shared/scenes';

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

describe('scene transform preview', () => {
  it('applies an absolute single-target preview without mutating its baseline', () => {
    const scene = makeScene({ images: { gm: [], map: [], token: [image] } });
    const preview = applySceneTransformPreview(
      scene,
      {
        campaignId: testCampaignId,
        kind: 'move',
        operationId: '44444444-4444-4444-8444-444444444444',
        pivotX: 100,
        pivotY: 100,
        revision: scene.revision,
        sceneId: scene.id,
        startingTransforms: [{ id: image.id, transform: image }],
        targets: [image.id],
      },
      {
        absolute: { ...image, x: 200, y: 300 },
        campaignId: testCampaignId,
        dx: 100,
        dy: 200,
        operationId: '44444444-4444-4444-8444-444444444444',
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      },
    );

    expect(preview.images.token[0]).toMatchObject({ x: 200, y: 300 });
    expect(scene.images.token[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('applies move, rotate, and scale deltas to text previews', () => {
    const scene = makeScene({
      texts: { gm: [], map: [], token: [text] },
    });
    const preview = applySceneTransformPreview(
      scene,
      {
        campaignId: testCampaignId,
        kind: 'resize',
        operationId: '66666666-6666-4666-8666-666666666666',
        pivotX: 0,
        pivotY: 0,
        revision: scene.revision,
        sceneId: scene.id,
        startingTransforms: [
          {
            id: text.id,
            transform: {
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              x: 100,
              y: 100,
            },
          },
        ],
        targets: [text.id],
      },
      {
        campaignId: testCampaignId,
        dx: 10,
        dy: 20,
        operationId: '66666666-6666-4666-8666-666666666666',
        rotation: 90,
        scaleX: 2,
        scaleY: 3,
      },
    );

    expect(preview.texts.token[0]).toMatchObject({
      rotation: 90,
      scaleX: 2,
      scaleY: 3,
      x: -290,
    });
    expect(preview.texts.token[0].y).toBeCloseTo(220);
    expect(scene.texts.token[0]).toEqual(text);
  });
});
