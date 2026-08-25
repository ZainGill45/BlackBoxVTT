import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TokenHealthRenderer } from '../../../../../features/play/canvas/tokenHealthRenderer';
import {
  createEmptyImageLayers,
  type SceneToken,
  type SceneTokenHealthPresentation,
} from '../../../../../shared/scenes';
import { makeScene } from '../../../../support/scenes';
import type { Camera, Viewport } from '../../../../../features/play/canvas/camera';
import { sceneObjectZIndex } from '../../../../../features/play/canvas/sceneObjectOrder';

const tokenId = '44444444-4444-4444-8444-444444444444';
const viewport: Viewport = { height: 600, width: 800 };

function camera(overrides: Partial<Camera> = {}): Camera {
  return { x: 0, y: 0, zoom: 1, ...overrides };
}

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

function sceneWithToken() {
  const images = createEmptyImageLayers();
  images.token.push(token());
  return makeScene({ images });
}

function health(
  overrides: Partial<SceneTokenHealthPresentation> = {},
): SceneTokenHealthPresentation {
  return {
    currentHundredths: 1_750,
    down: false,
    editable: true,
    maximumHundredths: 2_000,
    ratio: 0.875,
    tokenId,
    ...overrides,
  };
}

function createRenderer(): TokenHealthRenderer {
  return new TokenHealthRenderer({
    gm: new Container(),
    map: new Container(),
    token: new Container(),
  });
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

  it('reports the bar where the camera currently puts it, not where it opened', () => {
    const renderer = createRenderer();
    const scene = sceneWithToken();
    renderer.setHealth([health()]);

    const opened = renderer.screenRectFor(scene, camera(), viewport, tokenId);
    expect(opened).not.toBeNull();

    // Pan right and zoom in: an editor frozen at the opening rect would now be
    // sitting somewhere the bar no longer is.
    const panned = renderer.screenRectFor(
      scene,
      camera({ x: 100, zoom: 2 }),
      viewport,
      tokenId,
    );
    expect(panned).not.toBeNull();
    expect(panned!.x).not.toBeCloseTo(opened!.x);
    expect(panned!.width).toBeCloseTo(opened!.width * 2);
    expect(panned!.height).toBeCloseTo(opened!.height * 2);
  });

  it('keeps edited geometry stable and scales it with zoom', () => {
    const renderer = createRenderer();
    const scene = sceneWithToken();
    renderer.setHealth([health()]);

    const resting = renderer.screenRectFor(scene, camera(), viewport, tokenId)!;
    renderer.setEditing(tokenId);
    const editing = renderer.screenRectFor(scene, camera(), viewport, tokenId)!;

    // Editing changes the paint, not the bar geometry, so the field stays
    // attached to exactly the rectangle the player clicked.
    expect(editing.height).toBeCloseTo(resting.height);
    expect(editing.y).toBeCloseTo(resting.y);
    expect(editing.width).toBeCloseTo(resting.width);

    const zoomed = renderer.screenRectFor(
      scene,
      camera({ zoom: 2 }),
      viewport,
      tokenId,
    )!;
    expect(zoomed.height).toBeCloseTo(editing.height * 2);
  });

  it('keeps hit testing on the same bar while it is being edited', () => {
    const renderer = createRenderer();
    const scene = sceneWithToken();
    renderer.setHealth([health()]);

    const resting = renderer.screenRectFor(scene, camera(), viewport, tokenId)!;
    const outside = { x: resting.x + resting.width / 2, y: resting.y - 4 };
    const inside = {
      x: resting.x + resting.width / 2,
      y: resting.y + resting.height / 2,
    };
    expect(renderer.editableTokenAt(scene, camera(), viewport, outside)).toBeNull();

    renderer.setEditing(tokenId);
    expect(renderer.editableTokenAt(scene, camera(), viewport, outside)).toBeNull();
    expect(renderer.editableTokenAt(scene, camera(), viewport, inside))
      .toMatchObject({ tokenId });
  });

  it('reports nothing for a token whose health is not editable', () => {
    const renderer = createRenderer();
    const scene = sceneWithToken();
    renderer.setHealth([health({ editable: false })]);

    expect(renderer.screenRectFor(scene, camera(), viewport, tokenId)).toBeNull();
  });
});
