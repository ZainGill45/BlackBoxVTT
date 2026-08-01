import { describe, expect, it } from 'vitest';
import { applySceneTransformPreview } from '../../../../../features/play/canvas/sceneTransformPreview';
import { makeScene, testCampaignId } from '../../../../support/scenes';

const image = {
  assetId: '22222222-2222-4222-8222-222222222222',
  height: 100,
  id: '33333333-3333-4333-8333-333333333333',
  rotation: 0,
  width: 100,
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
});
