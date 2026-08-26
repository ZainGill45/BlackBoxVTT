import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TokenHealthRenderer } from '../../../../../features/play/canvas/tokenHealthRenderer';
import {
  createEmptyImageLayers,
  type SceneToken,
  type SceneTokenHealthPresentation,
} from '../../../../../shared/scenes';
import { makeScene } from '../../../../support/scenes';
import { sceneObjectZIndex } from '../../../../../features/play/canvas/sceneObjectOrder';

const tokenId = '44444444-4444-4444-8444-444444444444';

function token(): SceneToken {
  return {
    assetId: '55555555-5555-4555-8555-555555555555',
    height: 70,
    id: tokenId,
    rotation: 0,
    size: { height: 1, kind: 'default', width: 1 },
    source: { entryId: '66666666-6666-4666-8666-666666666666', kind: 'linked' },
    width: 70,
    x: 0,
    y: 0,
  };
}

function health(
  overrides: Partial<SceneTokenHealthPresentation> = {},
): SceneTokenHealthPresentation {
  return {
    down: false,
    ratio: 0.875,
    tokenId,
    ...overrides,
  };
}

describe('TokenHealthRenderer', () => {
  it('places a health bar above its token but below the next image in z order', () => {
    const containers = {
      gm: new Container(),
      map: new Container(),
      token: new Container(),
    };
    const renderer = new TokenHealthRenderer(containers);
    const sceneToken = token();
    const coveringImage = {
      assetId: '77777777-7777-4777-8777-777777777777',
      height: 70,
      id: '88888888-8888-4888-8888-888888888888',
      rotation: 0,
      width: 70,
      x: 0,
      y: 0,
    };
    const images = createEmptyImageLayers();
    images.token.push(sceneToken, coveringImage);
    const scene = makeScene({ images });
    renderer.setHealth([health()]);

    renderer.render(scene);

    expect(containers.token.children).toHaveLength(1);
    const barZIndex = containers.token.children[0].zIndex;
    expect(barZIndex).toBeGreaterThan(
      sceneObjectZIndex(scene.objectOrder, 'token', sceneToken.id, 0),
    );
    expect(barZIndex).toBeLessThan(
      sceneObjectZIndex(scene.objectOrder, 'token', coveringImage.id, 1),
    );

    scene.objectOrder.token = [coveringImage.id, sceneToken.id];
    renderer.render(scene);

    expect(containers.token.children[0].zIndex).toBeGreaterThan(
      sceneObjectZIndex(scene.objectOrder, 'token', coveringImage.id, 1),
    );
  });
});
