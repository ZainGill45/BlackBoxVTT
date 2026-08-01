import { Container } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSceneTextFontsLoaded,
  SceneTextRenderer,
} from '../../../../../features/play/canvas/sceneTextRenderer';
import {
  createEmptyTextLayers,
  type SceneText,
} from '../../../../../shared/scenes';

function text(overrides: Partial<SceneText> = {}): SceneText {
  return {
    content: 'First\nSecond',
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: null,
    revision: 0,
    rotation: 15,
    scaleX: 2,
    scaleY: 3,
    style: {
      fontFamily: 'lora',
      fontSize: 32,
      fontWeight: 700,
      primaryColor: '#abcdef',
      strokeColor: '#123456',
      strokeWidth: 4,
    },
    x: 100,
    y: 200,
    ...overrides,
  };
}

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  if (originalFonts) {
    Object.defineProperty(document, 'fonts', originalFonts);
  } else {
    Reflect.deleteProperty(document, 'fonts');
  }
});

describe('SceneTextRenderer', () => {
  it('waits for every bundled family, supported weight, and fallback', async () => {
    const load = vi.fn(async () => []);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });

    await ensureSceneTextFontsLoaded();

    expect(load).toHaveBeenCalledTimes(19);
    expect(load).toHaveBeenCalledWith(
      '400 16px "Inter Variable"',
      'BlackBox VTT',
    );
    expect(load).toHaveBeenCalledWith(
      '700 16px "Cinzel Variable"',
      'BlackBox VTT',
    );
    expect(load).toHaveBeenCalledWith(
      '400 16px "Unifont"',
      'BlackBox VTT',
    );
  });

  it('measures multiline stroke bounds and reconciles instances by ID', () => {
    const renderer = new SceneTextRenderer();
    const containers = {
      gm: new Container(),
      map: new Container(),
      token: new Container(),
    };
    const layers = createEmptyTextLayers();
    layers.token.push(text());

    renderer.render(layers, containers);
    const first = containers.token.children[0];
    const firstStyle = (first as unknown as { style: unknown }).style;
    const bounds = renderer.bounds(text().id);
    expect(bounds?.width).toBeGreaterThan(100);
    expect(bounds?.height).toBeGreaterThan(64);
    expect(first.position).toMatchObject({ x: 100, y: 200 });
    expect(first.scale).toMatchObject({ x: 2, y: 3 });
    expect(first.zIndex).toBeGreaterThan(1_000_000);

    layers.token[0] = text({ x: 150 });
    renderer.render(layers, containers);
    expect(containers.token.children[0]).toBe(first);
    expect(first.position.x).toBe(150);
    expect((first as unknown as { style: unknown }).style).toBe(firstStyle);

    layers.token[0] = text({ content: 'Changed', x: 150 });
    renderer.render(layers, containers);
    expect((first as unknown as { style: unknown }).style).not.toBe(firstStyle);

    renderer.render(createEmptyTextLayers(), containers);
    expect(containers.token.children).toEqual([]);
    expect(renderer.bounds(text().id)).toBeNull();
  });

  it('uses a local Pixi instance for editor previews and hides the original', () => {
    const renderer = new SceneTextRenderer();
    const containers = {
      gm: new Container(),
      map: new Container(),
      token: new Container(),
    };
    const layers = createEmptyTextLayers();
    const original = text();
    layers.token.push(original);
    renderer.render(layers, containers);
    const committed = containers.token.children[0];

    const bounds = renderer.renderPreview(
      {
        hiddenTextId: original.id,
        layer: 'token',
        text: text({ content: 'eee' }),
      },
      containers,
    );

    const preview = containers.token.children.find(
      (child) => child !== committed,
    ) as unknown as {
      style: { stroke?: { color: string; width: number } };
      text: string;
      zIndex: number;
    };
    expect(committed.visible).toBe(false);
    expect(preview.text).toBe('eee');
    expect(preview.style.stroke).toEqual({ color: '#123456', width: 4 });
    expect(preview.zIndex).toBeGreaterThan(committed.zIndex);
    expect(bounds?.width).toBeGreaterThan(0);

    renderer.clearPreview();
    expect(committed.visible).toBe(true);
    expect(containers.token.children).toEqual([committed]);
  });
});
