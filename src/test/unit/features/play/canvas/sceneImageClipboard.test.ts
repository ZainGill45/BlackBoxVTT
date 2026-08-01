import { describe, expect, it } from 'vitest';
import type { SceneImage } from '../../../../../shared/scenes';
import { SceneImageClipboard } from '../../../../../features/play/canvas/sceneImageClipboard';

function image(id: string, x = 10, y = 20): SceneImage {
  return {
    assetId: '11111111-1111-4111-8111-111111111111',
    height: 10,
    id,
    rotation: 0,
    width: 10,
    x,
    y,
  };
}

describe('SceneImageClipboard', () => {
  it('cascades same-scene pastes only after successful commits', () => {
    let id = 0;
    const clipboard = new SceneImageClipboard(() => `copy-${id += 1}`);
    clipboard.copy('scene-a', [image('source')], 15);

    const first = clipboard.createPaste({
      offset: 20,
      targetSceneId: 'scene-a',
      viewportCenter: { x: 500, y: 500 },
    });
    expect(first).toMatchObject({
      groupRotation: 15,
      images: [{ id: 'copy-1', x: 30, y: 40 }],
    });

    const retried = clipboard.createPaste({
      offset: 20,
      targetSceneId: 'scene-a',
      viewportCenter: { x: 500, y: 500 },
    });
    expect(retried?.images[0]).toMatchObject({ x: 30, y: 40 });
    first?.complete();

    expect(
      clipboard.createPaste({
        offset: 20,
        targetSceneId: 'scene-a',
        viewportCenter: { x: 500, y: 500 },
      })?.images[0],
    ).toMatchObject({ x: 50, y: 60 });
  });

  it('centers the first cross-scene paste then offsets later copies', () => {
    let id = 0;
    const clipboard = new SceneImageClipboard(() => `copy-${id += 1}`);
    clipboard.copy('scene-a', [image('source')], 0);

    const first = clipboard.createPaste({
      offset: 20,
      targetSceneId: 'scene-b',
      viewportCenter: { x: 100, y: 200 },
    });
    expect(first?.images[0]).toMatchObject({ x: 100, y: 200 });
    first?.complete();

    expect(
      clipboard.createPaste({
        offset: 20,
        targetSceneId: 'scene-b',
        viewportCenter: { x: 100, y: 200 },
      })?.images[0],
    ).toMatchObject({ x: 120, y: 220 });
  });
});
