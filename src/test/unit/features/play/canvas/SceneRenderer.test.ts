import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The stub's own types, since vitest aliases `pixi.js` to it at runtime.
import type {
  Container,
  Graphics,
  Sprite,
  Text,
  TilingSprite,
} from '../../../../support/pixiStub';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  createSceneObjectOrder,
  MAX_SCENE_IMAGES,
  type SceneDrawing,
  type SceneDrawingStyle,
  type SceneFogMutation,
  type SceneImage,
  type SceneObjectState,
  type SceneRecord,
  type SceneShape,
  type SceneText,
} from '../../../../../shared/scenes';
import {
  sceneToScreen,
  type Camera,
  type Viewport,
} from '../../../../../features/play/canvas/camera';
import { CANONICAL_MAP_ID } from '../../../../../shared/scenes';
import { SceneRenderer } from '../../../../../features/play/canvas/SceneRenderer';
import { DEFAULT_SHAPE_SETTINGS } from '../../../../../features/play/shapeSettings';
import { strokeDrawingPath } from '../../../../../features/play/canvas/sceneDrawingRenderer';
import { selectedSceneTargets } from '../../../../../features/play/canvas/sceneSelection';
import {
  rotationHandle,
  selectionScreenCorners,
} from '../../../../../features/play/canvas/sceneSelectionOverlay';

const MAP_URL = 'blackbox-asset://token/22222222-2222-4222-8222-222222222222';

const requestedUrls: string[] = [];
let failNextLoad = false;
let gifNextLoad = false;

/**
 * jsdom has neither `fetch` for custom protocols nor `createImageBitmap`, so
 * these stand in for the browser and report the size a real decode would.
 */
const stubFetch = ((url: string) => {
  requestedUrls.push(url);
  return Promise.resolve({
    blob: () =>
      Promise.resolve(
        gifNextLoad
          ? ({
              arrayBuffer: async () =>
                new TextEncoder().encode('GIF89a').buffer,
              type: 'image/gif',
            } as Blob)
          : new Blob([], { type: 'image/png' }),
      ),
    ok: !failNextLoad,
    status: failNextLoad ? 404 : 200,
  } as unknown as Response);
}) as unknown as typeof fetch;

const stubCreateImageBitmap = (() =>
  Promise.resolve({
    close: () => undefined,
    height: 1536,
    width: 2048,
  } as unknown as ImageBitmap)) as unknown as typeof createImageBitmap;

function scene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  const drawings = overrides.drawings ?? createEmptyDrawingLayers();
  const fog = overrides.fog ?? createDefaultFog();
  const images = overrides.images ?? createEmptyImageLayers();
  const shapes = overrides.shapes ?? createEmptyShapeLayers();
  const texts = overrides.texts ?? createEmptyTextLayers();
  return {
    createdAt: '2026-07-28T00:00:00.000Z',
    distance: 5,
    grid: createDefaultGrid(),
    height: 1080,
    id: '11111111-1111-4111-8111-111111111111',
    mapImage: null,
    name: 'Iron Keep',
    objectOrder: overrides.objectOrder ?? createSceneObjectOrder({
      drawings,
      images,
      shapes,
      texts,
    }),
    pixelScale: 70,
    revision: 0,
    unit: 'ft',
    updatedAt: '2026-07-28T00:00:00.000Z',
    width: 1920,
    ...overrides,
    drawings,
    fog,
    images,
    shapes,
    texts,
  };
}

const placement = {
  assetId: '22222222-2222-4222-8222-222222222222',
  height: 1536,
  rotation: 0,
  width: 2048,
  x: 0,
  y: 0,
};

function drawing(
  id: string,
  ownerId: string | null,
  overrides: Partial<SceneDrawing> = {},
): SceneDrawing {
  return {
    closed: false,
    id,
    kind: 'freeform',
    ownerId,
    points: [{ x: -20, y: 0 }, { x: 20, y: 0 }],
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style: {
      edge: 'hard',
      fillColor: '#ffffff',
      fillEnabled: false,
      fillOpacity: 0.25,
      hardness: 1,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWidth: 12,
    },
    x: 960,
    y: 540,
    ...overrides,
  };
}

function sceneText(overrides: Partial<SceneText> = {}): SceneText {
  return {
    content: 'Old label',
    id: '77777777-7777-4777-8777-777777777777',
    ownerId: null,
    revision: 0,
    rotation: 25,
    scaleX: 1.5,
    scaleY: 0.75,
    style: {
      fontFamily: 'inter',
      fontSize: 32,
      fontWeight: 600,
      primaryColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 2,
    },
    x: 960,
    y: 540,
    ...overrides,
  };
}

function sceneShape(overrides: Partial<SceneShape> = {}): SceneShape {
  return {
    height: 240,
    id: '66666666-6666-4666-8666-666666666666',
    kind: 'sphere',
    ownerId: null,
    revision: 0,
    rotation: 0,
    style: DEFAULT_SHAPE_SETTINGS,
    width: 240,
    x: 960,
    y: 540,
    ...overrides,
  } as SceneShape;
}

function spriteOf(renderer: SceneRenderer): Sprite | undefined {
  return (renderer as unknown as { mapSprite: Sprite | null }).mapSprite ??
    undefined;
}

function gridOf(renderer: SceneRenderer): Graphics {
  return (renderer as unknown as { grid: Graphics }).grid;
}

function hatchOf(renderer: SceneRenderer): TilingSprite | null {
  return (renderer as unknown as { hatch: TilingSprite | null }).hatch;
}

function textPreviewOf(renderer: SceneRenderer): Text | null {
  return (
    renderer as unknown as {
      textRenderer: { previewInstance: Text | null };
    }
  ).textRenderer.previewInstance;
}

/** Lets the image load microtask and the texture swap settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** jsdom has no PointerEvent, so a MouseEvent carries the pointer fields. */
function pointerEvent(
  type: string,
  init: {
    altKey?: boolean;
    button: number;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    detail?: number;
    pointerId?: number;
    pointerType?: string;
    shiftKey?: boolean;
  },
): Event {
  const event = new MouseEvent(type, {
    altKey: init.altKey,
    bubbles: true,
    button: init.button,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    ctrlKey: init.ctrlKey,
    detail: init.detail,
    shiftKey: init.shiftKey,
  });
  Object.defineProperty(event, 'pointerId', {
    value: init.pointerId ?? 1,
  });
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'mouse',
  });
  return event;
}

function shortcutEvent(
  key: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: true,
    key,
    ...init,
  });
}

let element: HTMLElement;
let renderer: SceneRenderer;

function rendererSelectionCorners(): Array<{ x: number; y: number }> {
  const state = renderer as unknown as {
    camera: Camera;
    groupSelectionRotation: number;
    scene: SceneRecord;
    selected: Set<string>;
    viewport: Viewport;
  };
  return selectionScreenCorners({
    camera: state.camera,
    groupRotation: state.groupSelectionRotation,
    targets: selectedSceneTargets(state.scene, state.selected, {
      actorId: null,
      canEditImages: true,
    }),
    viewport: state.viewport,
  });
}

beforeEach(async () => {
  requestedUrls.length = 0;
  failNextLoad = false;
  gifNextLoad = false;
  globalThis.fetch = stubFetch;
  globalThis.createImageBitmap = stubCreateImageBitmap;
  element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  // jsdom does not implement pointer capture.
  element.setPointerCapture = () => undefined;
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  document.body.append(element);
  renderer = new SceneRenderer();
  await renderer.mount(element);
});

afterEach(() => {
  renderer.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  element.remove();
});

describe('SceneRenderer', () => {
  // Canvas transparency is a property of the real GL context, which the Pixi
  // stub cannot represent. It is asserted against actual pixels in
  // src/test/e2e/rendering.spec.ts instead.

  it('renders the map image at its stored placement', async () => {
    renderer.setScene(scene({ mapImage: placement }), MAP_URL);
    await settle();

    const sprite = spriteOf(renderer);
    expect(sprite).toBeDefined();
    expect(sprite?.texture).not.toBeNull();
    expect(sprite?.width).toBe(2048);
    expect(sprite?.height).toBe(1536);
    expect(sprite?.position.x).toBe(0);
    expect(sprite?.position.y).toBe(0);
  });

  it('fetches the map bytes rather than pointing an <img> at the asset URL', async () => {
    renderer.setScene(scene({ mapImage: placement }), MAP_URL);
    await settle();

    // An <img> on the asset protocol is cross-origin, and WebGL refuses to
    // upload the tainted result, so the map never appears.
    expect(requestedUrls).toEqual([MAP_URL]);
    expect(spriteOf(renderer)?.texture).not.toBeNull();
  });

  it('falls back to the texture size when the placement has none', async () => {
    renderer.setScene(
      scene({ mapImage: { ...placement, height: 0, width: 0 } }),
      MAP_URL,
    );
    await settle();

    expect(spriteOf(renderer)?.width).toBe(2048);
    expect(spriteOf(renderer)?.height).toBe(1536);
  });

  it('keeps the scene when the image cannot be loaded', async () => {
    failNextLoad = true;
    renderer.setScene(scene({ mapImage: placement }), MAP_URL);
    await settle();

    expect(spriteOf(renderer)).toBeUndefined();
    expect(hatchOf(renderer)).not.toBeNull();
    expect(
      (renderer as unknown as { mapPlaceholder: Graphics | null })
        .mapPlaceholder,
    ).not.toBeNull();
  });

  it('uses Pixi GIF sprites for locally animated image assets', async () => {
    gifNextLoad = true;
    renderer.setScene(
      scene({
        images: { gm: [], map: [], token: [] },
        mapImage: { ...placement, x: 1024, y: 768 },
      }),
      { [placement.assetId]: MAP_URL },
    );
    await vi.waitFor(() => {
      expect(spriteOf(renderer)?.constructor.name).toBe('GifSprite');
    });
  });

  it('keeps fixed map, grid, token, GM, and overlay render bands', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [{ ...placement, id: tokenId, x: 100, y: 100 }],
        },
      }),
      { [placement.assetId]: MAP_URL },
    );
    await settle();

    const appStage = (renderer as unknown as { app: { stage: Container } }).app
      .stage;
    const tokenBand = appStage.children[2];
    const additionalImages = (renderer as unknown as {
      additionalImages: { sprite(id: string): Sprite | undefined };
    }).additionalImages;
    expect(appStage.children).toHaveLength(12);
    expect(additionalImages.sprite(tokenId)?.parent).toBe(tokenBand);
  });

  it('commits one owned Freeform object per drag and emits compact live previews', async () => {
    const current = scene();
    const actorId = '22222222-2222-4222-8222-222222222222';
    const onCommit = vi.fn(
      async (state: SceneObjectState, operationId: string) => {
        void operationId;
        return {
          ...current,
          ...state,
          revision: current.revision + 1,
        };
      },
    );
    const onDrawingPreview = vi.fn();
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'map',
      actorId,
      editable: false,
      onCommit,
      onDrawingPreview,
      paintEnabled: true,
      paintKind: 'freeform',
      paintStyle: {
        edge: 'soft',
        fillColor: '#eeeeee',
        fillEnabled: false,
        fillOpacity: 0.25,
        hardness: 0.25,
        strokeColor: '#eeeeee',
        strokeOpacity: 0.75,
        strokeWidth: 12,
      },
    });
    expect(element.style.cursor).toBe('');

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 390,
        clientY: 295,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 420,
        clientY: 310,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 420,
        clientY: 310,
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const [state, operationId] = onCommit.mock.calls[0];
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(state.drawings.map).toEqual([]);
    expect(state.drawings.token).toHaveLength(1);
    expect(state.drawings.token[0]).toMatchObject({
      kind: 'freeform',
      ownerId: actorId,
      style: { edge: 'soft', strokeOpacity: 0.75, strokeWidth: 12 },
    });
    expect(state.drawings.token[0].points.length).toBeGreaterThan(1);
    expect(onDrawingPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: false,
        operationId,
        points: [],
      }),
    );
  });

  it('limits continuous GM paint callbacks before they cross renderer IPC', async () => {
    const current = scene();
    const onDrawingPreview = vi.fn();
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: 1,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'map',
      actorId: null,
      editable: false,
      networkUpdateRate: 32,
      onCommit,
      onDrawingPreview,
      paintEnabled: true,
      paintKind: 'freeform',
      paintStyle: {
        edge: 'hard',
        fillColor: '#ffffff',
        fillEnabled: false,
        fillOpacity: 0.25,
        hardness: 1,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWidth: 12,
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'));

    element.dispatchEvent(pointerEvent('pointerdown', {
      button: 0,
      clientX: 300,
      clientY: 250,
    }));
    for (let index = 1; index <= 10; index += 1) {
      element.dispatchEvent(pointerEvent('pointermove', {
        button: -1,
        clientX: 300 + index * 5,
        clientY: 250 + index * 3,
      }));
    }
    expect(onDrawingPreview).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(31);
    expect(onDrawingPreview).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onDrawingPreview).toHaveBeenCalledTimes(3);

    element.dispatchEvent(pointerEvent('pointerup', {
      button: 0,
      clientX: 350,
      clientY: 280,
    }));
    expect(onDrawingPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false, reliable: true }),
    );
  });

  it('previews fog locally but commits both fog tools only on release', async () => {
    const current = scene();
    const onFogCommit = vi.fn(
      async (mutation: SceneFogMutation, operationId: string) => {
        void operationId;
        return {
          ...current,
          fog: mutation.kind === 'append'
            ? {
                ...current.fog,
                operations: [...current.fog.operations, mutation.operation],
              }
            : current.fog,
          revision: current.revision + 1,
        };
      },
    );
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: false,
      fogBrushHardness: 0.4,
      fogBrushWidth: 80,
      fogEnabled: true,
      fogMode: 'reveal',
      fogSubtool: 'brush',
      onFogCommit,
    });

    element.dispatchEvent(pointerEvent('pointerdown', {
      button: 0,
      clientX: 390,
      clientY: 295,
    }));
    element.dispatchEvent(pointerEvent('pointermove', {
      button: -1,
      clientX: 450,
      clientY: 325,
    }));
    expect(onFogCommit).not.toHaveBeenCalled();
    element.dispatchEvent(pointerEvent('pointerup', {
      button: 0,
      clientX: 450,
      clientY: 325,
    }));

    await vi.waitFor(() => expect(onFogCommit).toHaveBeenCalledTimes(1));
    const [brushMutation, brushOperationId] = onFogCommit.mock.calls[0];
    expect(brushMutation).toMatchObject({
      kind: 'append',
      operation: {
        hardness: 0.4,
        id: brushOperationId,
        kind: 'brush',
        mode: 'reveal',
        width: 80,
      },
    });
    if (brushMutation.kind !== 'append' || brushMutation.operation.kind !== 'brush') {
      throw new Error('brush commit expected');
    }
    expect(brushMutation.operation.points.length).toBeGreaterThan(1);

    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: false,
      fogEnabled: true,
      fogMode: 'hide',
      fogSubtool: 'box',
      onFogCommit,
    });
    element.dispatchEvent(pointerEvent('pointerdown', {
      button: 0,
      clientX: 300,
      clientY: 250,
    }));
    element.dispatchEvent(pointerEvent('pointermove', {
      button: -1,
      clientX: 500,
      clientY: 350,
    }));
    expect(onFogCommit).toHaveBeenCalledTimes(1);
    element.dispatchEvent(pointerEvent('pointerup', {
      button: 0,
      clientX: 500,
      clientY: 350,
    }));

    await vi.waitFor(() => expect(onFogCommit).toHaveBeenCalledTimes(2));
    expect(onFogCommit.mock.calls[1][0]).toMatchObject({
      kind: 'append',
      operation: { kind: 'box', mode: 'hide' },
    });
  });

  it('coalesces dense fog pointer input into one render per animation frame', async () => {
    const current = scene();
    const onFogCommit = vi.fn(async () => ({ ...current, revision: 1 }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: false,
      fogEnabled: true,
      fogMode: 'hide',
      fogSubtool: 'brush',
      onFogCommit,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    const scheduled: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return 77;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const fogRenderer = (renderer as unknown as {
      fogRenderer: { render: () => void };
    }).fogRenderer;
    const renderFog = vi.spyOn(fogRenderer, 'render');

    element.dispatchEvent(pointerEvent('pointerdown', {
      button: 0,
      clientX: 300,
      clientY: 250,
    }));
    renderFog.mockClear();
    for (let index = 1; index <= 20; index += 1) {
      element.dispatchEvent(pointerEvent('pointermove', {
        button: -1,
        clientX: 300 + index * 3,
        clientY: 250 + index * 2,
      }));
    }

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(renderFog).not.toHaveBeenCalled();
    if (!scheduled[0]) {
      throw new Error('fog frame was not scheduled');
    }
    scheduled[0](performance.now());
    expect(renderFog).toHaveBeenCalledTimes(1);

    element.dispatchEvent(pointerEvent('pointerup', {
      button: 0,
      clientX: 360,
      clientY: 290,
    }));
    await vi.waitFor(() => expect(onFogCommit).toHaveBeenCalledTimes(1));
  });

  it('uses the default cursor for both paint tools', () => {
    const paintStyle: SceneDrawingStyle = {
      edge: 'soft',
      fillColor: '#ffffff',
      fillEnabled: false,
      fillOpacity: 0.25,
      hardness: 0.25,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWidth: 24,
    };
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      paintEnabled: true,
      paintKind: 'freeform',
      paintStyle,
    });

    expect(element.style.cursor).toBe('');

    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      paintEnabled: true,
      paintKind: 'polyline',
      paintStyle: { ...paintStyle, edge: 'hard', hardness: 1 },
    });
    expect(element.style.cursor).toBe('');
  });

  it('creates the same 5-unit sphere with either grid mode and uses the true release point', async () => {
    const create = async (grid: SceneRecord['grid']) => {
      const existingImage = {
        ...placement,
        id: '99999999-9999-4999-8999-999999999999',
        x: 200,
        y: 200,
      };
      const current = scene({
        grid,
        images: { ...createEmptyImageLayers(), token: [existingImage] },
      });
      const committed: SceneShape[] = [];
      const onCommit = vi.fn(async (
        state: SceneObjectState,
        _operationId: string,
      ) => {
        void _operationId;
        committed.push(structuredClone(state.shapes.token[0]));
        expect(state.objectOrder.token).toEqual([
          state.shapes.token[0].id,
          existingImage.id,
        ]);
        return {
          ...current,
          ...state,
          revision: current.revision + 1,
        };
      });
      const onShapePreview = vi.fn();
      renderer.setScene(current, null);
      renderer.setInteraction({
        activeLayer: 'token',
        actorId: null,
        editable: false,
        onCommit,
        onShapePreview,
        shapeEnabled: true,
        shapeKind: 'sphere',
        shapeStyle: DEFAULT_SHAPE_SETTINGS,
      });
      const origin = renderer.clientToScene(383, 287);

      element.dispatchEvent(pointerEvent('pointerdown', {
        button: 0,
        clientX: 383,
        clientY: 287,
      }));
      element.dispatchEvent(pointerEvent('pointermove', {
        button: -1,
        clientX: 413,
        clientY: 287,
      }));
      element.dispatchEvent(pointerEvent('pointerup', {
        button: 0,
        clientX: 470,
        clientY: 287,
      }));

      await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
      expect(onShapePreview.mock.calls.map(([preview]) => preview.phase))
        .toEqual(['start', 'update', 'final']);
      expect(onShapePreview.mock.calls.at(-1)?.[0].operationId)
        .toBe(onCommit.mock.calls[0][1]);
      expect(committed[0])
        .toMatchObject(onShapePreview.mock.calls.at(-1)?.[0].shape);
      expect(committed[0]).toMatchObject({
        height: 420,
        kind: 'sphere',
        width: 420,
        x: origin.x,
        y: origin.y,
      });
      return committed[0];
    };

    const squareGrid = await create({
      ...createDefaultGrid(),
      offsetX: 19,
      offsetY: 31,
      size: 83,
      type: 'square',
    });
    const gridless = await create({
      ...createDefaultGrid(),
      type: 'gridless',
    });

    expect(gridless).toMatchObject({
      height: squareGrid.height,
      width: squareGrid.width,
      x: squareGrid.x,
      y: squareGrid.y,
    });
    expect((squareGrid.width / 2 / 70) * 5).toBe(15);
    expect((squareGrid.x - 19) % 83).not.toBeCloseTo(0);
  });

  it('keeps Alt dimensions quantized and makes Alt+Control truly freeform', async () => {
    const current = scene();
    const shapes: SceneShape[] = [];
    const onCommit = vi.fn(async (state: SceneObjectState) => {
      const created = state.shapes.token.at(-1);
      if (created) shapes.push(structuredClone(created));
      return {
        ...current,
        ...state,
        revision: current.revision + shapes.length,
      };
    });
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: false,
      onCommit,
      shapeEnabled: true,
      shapeKind: 'sphere',
      shapeStyle: DEFAULT_SHAPE_SETTINGS,
    });
    const drag = async (pointerId: number, ctrlKey: boolean) => {
      element.dispatchEvent(pointerEvent('pointerdown', {
        altKey: true,
        button: 0,
        clientX: 380,
        clientY: 280,
        ctrlKey,
        pointerId,
      }));
      element.dispatchEvent(pointerEvent('pointerup', {
        altKey: true,
        button: 0,
        clientX: 419,
        clientY: 346,
        ctrlKey,
        pointerId,
      }));
      await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(pointerId));
    };

    await drag(1, false);
    renderer.setScene(current, null);
    await drag(2, true);

    expect(shapes[0].width % 140).toBe(0);
    expect(shapes[0].height % 140).toBe(0);
    expect(shapes[0].width).not.toBe(shapes[0].height);
    expect(shapes[1].width % 140).not.toBeCloseTo(0);
    expect(shapes[1].height % 140).not.toBeCloseTo(0);
    expect(shapes[1].width).not.toBe(shapes[1].height);
  });

  it('cancels the reliable shape preview when the authoritative commit fails', async () => {
    const onShapePreview = vi.fn();
    const onCommit = vi.fn(async () => null);
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: false,
      onCommit,
      onShapePreview,
      shapeEnabled: true,
      shapeKind: 'cone',
      shapeStyle: DEFAULT_SHAPE_SETTINGS,
    });

    element.dispatchEvent(pointerEvent('pointerdown', {
      button: 0,
      clientX: 350,
      clientY: 300,
    }));
    element.dispatchEvent(pointerEvent('pointerup', {
      button: 0,
      clientX: 450,
      clientY: 300,
    }));

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(onShapePreview.mock.calls.map(([preview]) => preview.phase))
        .toEqual(['start', 'final', 'cancel']),
    );
    expect((renderer as unknown as { draftShape: SceneShape | null }).draftShape)
      .toBeNull();
  });

  it('uses all soft passes for both paths and single-click dots', () => {
    const style: SceneDrawingStyle = {
      edge: 'soft',
      fillColor: '#ffffff',
      fillEnabled: false,
      fillOpacity: 0.25,
      hardness: 0.25,
      strokeColor: '#ffffff',
      strokeOpacity: 0.75,
      strokeWidth: 32,
    };
    const GraphicsConstructor = gridOf(renderer).constructor as new () => Graphics;
    const path = new GraphicsConstructor();
    const dot = new GraphicsConstructor();

    strokeDrawingPath(path, {
      closed: false,
      points: [{ x: 0, y: 0 }, { x: 20, y: 20 }],
      style,
    });
    strokeDrawingPath(dot, {
      closed: false,
      points: [{ x: 0, y: 0 }],
      style,
    });

    expect(path.calls.filter((call) => call.op === 'stroke')).toHaveLength(16);
    expect(dot.calls.filter((call) => call.op === 'fill')).toHaveLength(16);
  });

  it('finishes open Polylines with Enter and cancels unfinished work on tool change', async () => {
    const current = scene();
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: current.revision + 1,
    }));
    const interaction = {
      activeLayer: 'token' as const,
      editable: false,
      onCommit,
      paintEnabled: true,
      paintKind: 'polyline' as const,
      paintStyle: {
        edge: 'hard' as const,
        fillColor: '#dddddd',
        fillEnabled: true,
        fillOpacity: 0.25,
        hardness: 1,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWidth: 6,
      },
    };
    renderer.setScene(current, null);
    renderer.setInteraction(interaction);
    for (const [clientX, clientY] of [
      [380, 280],
      [420, 280],
      [420, 320],
    ]) {
      element.dispatchEvent(
        pointerEvent('pointerdown', {
          button: 0,
          clientX,
          clientY,
        }),
      );
    }
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].drawings.token[0]).toMatchObject({
      closed: false,
      kind: 'polyline',
      points: expect.arrayContaining([
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      ]),
      style: { fillEnabled: false },
    });

    renderer.setScene(current, null);
    renderer.setInteraction(interaction);
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 390,
        clientY: 290,
      }),
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
    });
    expect(
      (renderer as unknown as { activePolyline: unknown }).activePolyline,
    ).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('filters player selection to owned drawings while the GM can select both', () => {
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const ownedId = '44444444-4444-4444-8444-444444444444';
    const foreignId = '55555555-5555-4555-8555-555555555555';
    renderer.setScene(
      scene({
        drawings: {
          gm: [],
          map: [],
          token: [
            drawing(ownedId, ownerId),
            drawing(foreignId, '33333333-3333-4333-8333-333333333333'),
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: ownerId,
      canEditImages: false,
      editable: true,
    });
    const activeTargets = () =>
      (
        renderer as unknown as {
          activeTargets(): Array<{ id: string }>;
        }
      )
        .activeTargets()
        .map((target) => target.id);

    expect(activeTargets()).toEqual([ownedId]);

    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      canEditImages: true,
      editable: true,
    });
    expect(activeTargets()).toEqual([ownedId, foreignId]);
  });

  it('selects a committed drawing with the pointer and moves it through the normal Select workflow', async () => {
    const actorId = '22222222-2222-4222-8222-222222222222';
    let authoritative = scene();
    const onCommit = vi.fn(
      async (state: SceneObjectState, _operationId: string) => {
        void _operationId;
        authoritative = {
          ...authoritative,
          ...structuredClone(state),
          revision: authoritative.revision + 1,
        };
        return structuredClone(authoritative);
      },
    );
    const onPreviewCancel = vi.fn();
    const onPreviewStart = vi.fn();
    renderer.setScene(authoritative, null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId,
      canEditImages: false,
      editable: false,
      onCommit,
      paintEnabled: true,
      paintKind: 'freeform',
      paintStyle: {
        edge: 'hard',
        fillColor: '#ffffff',
        fillEnabled: false,
        fillOpacity: 0.25,
        hardness: 1,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWidth: 12,
      },
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 380,
        clientY: 300,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 420,
        clientY: 300,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 420,
        clientY: 300,
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const created = authoritative.drawings.token[0];

    renderer.setInteraction({
      activeLayer: 'token',
      actorId,
      canEditImages: false,
      editable: true,
      onCommit,
      onPreviewCancel,
      onPreviewStart,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerId: 2,
      }),
    );
    expect([
      ...(renderer as unknown as { selected: Set<string> }).selected,
    ]).toEqual([created.id]);
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerId: 2,
      }),
    );
    expect(onPreviewStart).toHaveBeenCalledTimes(1);
    expect(onPreviewCancel).toHaveBeenCalledWith(
      onPreviewStart.mock.calls[0][0].operationId,
      authoritative.id,
    );

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerId: 3,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 440,
        clientY: 300,
        pointerId: 3,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 440,
        clientY: 300,
        pointerId: 3,
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onPreviewStart).toHaveBeenCalledTimes(2);
    expect(authoritative.drawings.token[0].x).toBeGreaterThan(created.x);
  });

  it('marquee-selects only editable drawings and selects a filled Polyline from its interior', () => {
    const actorId = '22222222-2222-4222-8222-222222222222';
    const ownedId = '44444444-4444-4444-8444-444444444444';
    const foreignId = '55555555-5555-4555-8555-555555555555';
    renderer.setScene(
      scene({
        drawings: {
          gm: [],
          map: [],
          token: [
            drawing(ownedId, actorId, { x: 900, y: 500 }),
            drawing(foreignId, '33333333-3333-4333-8333-333333333333', {
              x: 1020,
              y: 580,
            }),
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      actorId,
      canEditImages: false,
      editable: true,
      onCommit: async () => null,
    });
    const state = renderer as unknown as {
      camera: Parameters<typeof sceneToScreen>[0];
      selected: Set<string>;
      viewport: Parameters<typeof sceneToScreen>[1];
    };
    const start = sceneToScreen(state.camera, state.viewport, {
      x: 820,
      y: 440,
    });
    const end = sceneToScreen(state.camera, state.viewport, {
      x: 1080,
      y: 640,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: start.x,
        clientY: start.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: end.x,
        clientY: end.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: end.x,
        clientY: end.y,
      }),
    );
    expect([...state.selected]).toEqual([ownedId]);

    const filledId = '66666666-6666-4666-8666-666666666666';
    renderer.setScene(
      scene({
        drawings: {
          gm: [],
          map: [],
          token: [
            drawing(filledId, null, {
              closed: true,
              kind: 'polyline',
              points: [
                { x: -80, y: -60 },
                { x: 80, y: -60 },
                { x: 80, y: 60 },
                { x: -80, y: 60 },
              ],
              style: {
                ...drawing(filledId, null).style,
                fillEnabled: true,
              },
            }),
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: true,
      onCommit: async () => null,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerId: 2,
      }),
    );
    expect([...state.selected]).toEqual([filledId]);
  });

  it('scales, rotates, nudges, deletes, undoes, and redoes a drawing through Select controls', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    let authoritative = scene({
      drawings: {
        gm: [],
        map: [],
        token: [drawing(id, null)],
      },
      grid: { ...createDefaultGrid(), type: 'gridless' },
    });
    const undoHistory: SceneRecord[] = [];
    const redoHistory: SceneRecord[] = [];
    const onCommit = vi.fn(async (state: SceneObjectState) => {
      undoHistory.push(structuredClone(authoritative));
      redoHistory.length = 0;
      authoritative = {
        ...authoritative,
        ...structuredClone(state),
        revision: authoritative.revision + 1,
      };
      return structuredClone(authoritative);
    });
    const onUndo = vi.fn(async () => {
      const previous = undoHistory.pop();
      if (!previous) {
        return null;
      }
      redoHistory.push(structuredClone(authoritative));
      authoritative = {
        ...structuredClone(previous),
        revision: authoritative.revision + 1,
      };
      return structuredClone(authoritative);
    });
    const onRedo = vi.fn(async () => {
      const next = redoHistory.pop();
      if (!next) {
        return null;
      }
      undoHistory.push(structuredClone(authoritative));
      authoritative = {
        ...structuredClone(next),
        revision: authoritative.revision + 1,
      };
      return structuredClone(authoritative);
    });
    renderer.setScene(authoritative, null);
    renderer.setInteraction({
      activeLayer: 'token',
      actorId: null,
      editable: true,
      onCommit,
      onRedo,
      onUndo,
    });
    renderer.selectImages([id]);
    const state = renderer as unknown as {
      selected: Set<string>;
    };

    let corners = rendererSelectionCorners();
    const scaleCorner = corners[2];
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: scaleCorner.x,
        clientY: scaleCorner.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: scaleCorner.x + 40,
        clientY: scaleCorner.y + 40,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: scaleCorner.x + 40,
        clientY: scaleCorner.y + 40,
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(authoritative.drawings.token[0].scaleX).toBeGreaterThan(1);
    expect(authoritative.drawings.token[0].scaleY).toBeCloseTo(
      authoritative.drawings.token[0].scaleX,
      3,
    );

    corners = rendererSelectionCorners();
    const centre = {
      x: (corners[0].x + corners[2].x) / 2,
      y: (corners[0].y + corners[2].y) / 2,
    };
    const rotate = rotationHandle(corners).handle;
    const radius = Math.hypot(rotate.x - centre.x, rotate.y - centre.y);
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: rotate.x,
        clientY: rotate.y,
        pointerId: 2,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: centre.x + radius,
        clientY: centre.y,
        pointerId: 2,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: centre.x + radius,
        clientY: centre.y,
        pointerId: 2,
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(Math.abs(authoritative.drawings.token[0].rotation)).toBeGreaterThan(
      45,
    );

    const beforeNudge = authoritative.drawings.token[0].x;
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(3));
    expect(authoritative.drawings.token[0].x).toBe(beforeNudge + 1);

    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Delete',
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(4));
    expect(authoritative.drawings.token).toEqual([]);
    await vi.waitFor(() => expect(state.selected.size).toBe(0));

    element.dispatchEvent(shortcutEvent('z'));
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledTimes(4);
    expect(authoritative.drawings.token).toHaveLength(1);
    await vi.waitFor(() =>
      expect(
        (renderer as unknown as { committing: boolean }).committing,
      ).toBe(false),
    );

    element.dispatchEvent(shortcutEvent('y'));
    await vi.waitFor(() => expect(onRedo).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledTimes(4);
    expect(authoritative.drawings.token).toEqual([]);
  });

  it('measures from grid centers, adds pivots, and clears on release', () => {
    vi.useFakeTimers();
    const currentScene = scene();
    const onMeasurementUpdate = vi.fn();
    renderer.setScene(currentScene, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      measureEnabled: true,
      onMeasurementUpdate,
    });
    expect(element.style.cursor).toBe('');

    const startScene = renderer.clientToScene(200, 200);
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 200,
        clientY: 200,
      }),
    );
    expect(onMeasurementUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: true,
        points: [
          expect.objectContaining({
            x: Math.max(
              0,
              Math.min(
                currentScene.width,
                (Math.floor(startScene.x / 70) + 0.5) * 70,
              ),
            ),
          }),
        ],
      }),
    );

    vi.advanceTimersByTime(40);
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: 0,
        clientX: 400,
        clientY: 200,
      }),
    );
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 200,
    });
    element.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(onMeasurementUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: true,
        points: [expect.any(Object), expect.any(Object)],
      }),
    );

    vi.advanceTimersByTime(40);
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: 0,
        clientX: 400,
        clientY: 400,
      }),
    );
    expect(onMeasurementUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: true,
        points: expect.arrayContaining([
          expect.any(Object),
          expect.any(Object),
          expect.any(Object),
        ]),
      }),
    );
    expect(element.querySelectorAll('span').length).toBeGreaterThanOrEqual(2);

    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 400,
        clientY: 400,
      }),
    );
    expect(onMeasurementUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false, points: [] }),
    );
    expect(element.querySelectorAll('span')).toHaveLength(0);
  });

  it('keeps touch input out of measure mode and expires remote rulers', () => {
    vi.useFakeTimers();
    renderer.setScene(scene(), null);
    const onMeasurementUpdate = vi.fn();
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      measureEnabled: true,
      onMeasurementUpdate,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 200,
        clientY: 200,
        pointerType: 'touch',
      }),
    );
    expect(onMeasurementUpdate).not.toHaveBeenCalled();

    renderer.showMeasurement({
      active: true,
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      measurementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      sceneId: '11111111-1111-4111-8111-111111111111',
      sourceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      updateSequence: 1,
    });
    expect(element.querySelectorAll('span')).toHaveLength(1);
    vi.advanceTimersByTime(1_520);
    expect(element.querySelectorAll('span')).toHaveLength(0);
  });

  it('renders the GM band opaque only while the GM layer is active', () => {
    renderer.setScene(scene(), null);

    const appStage = (renderer as unknown as { app: { stage: Container } }).app
      .stage;
    const gmBand = (renderer as unknown as { gmWorld: Container }).gmWorld;
    expect(appStage.children[2].alpha).toBe(1);
    expect(gmBand.alpha).toBe(0.5);

    renderer.setInteraction({ activeLayer: 'gm', editable: true });
    expect(gmBand.alpha).toBe(1);

    renderer.setInteraction({ activeLayer: 'map', editable: true });
    expect(gmBand.alpha).toBe(0.5);
  });

  it('keeps unchanged sprites, textures, and camera state stable across additions and deletions', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    const secondAssetId = '66666666-6666-4666-8666-666666666666';
    const first = { ...placement, id: firstId, x: 500, y: 500 };
    const initial = scene({
      images: { gm: [], map: [], token: [first] },
    });
    renderer.setScene(initial, { [placement.assetId]: MAP_URL });
    await settle();

    const additionalImages = (renderer as unknown as {
      additionalImages: { sprite(id: string): Sprite | undefined };
    }).additionalImages;
    const resources = (renderer as unknown as {
      imageResources: { texture(assetId: string): unknown };
    }).imageResources;
    const firstSprite = additionalImages.sprite(firstId);
    const firstTexture = resources.texture(placement.assetId);
    const cameraBefore = {
      ...(renderer as unknown as {
        camera: { x: number; y: number; zoom: number };
      }).camera,
    };

    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            first,
            {
              ...placement,
              assetId: secondAssetId,
              id: secondId,
              x: 700,
              y: 500,
            },
          ],
        },
        revision: 1,
      }),
      {
        [placement.assetId]: MAP_URL,
        [secondAssetId]: `blackbox-asset://token/${secondAssetId}`,
      },
    );
    await settle();

    expect(additionalImages.sprite(firstId)).toBe(firstSprite);
    expect(resources.texture(placement.assetId)).toBe(firstTexture);
    expect(requestedUrls).toEqual([
      MAP_URL,
      `blackbox-asset://token/${secondAssetId}`,
    ]);
    expect(
      (renderer as unknown as {
        camera: { x: number; y: number; zoom: number };
      }).camera,
    ).toEqual(cameraBefore);

    renderer.setScene(
      scene({
        images: { gm: [], map: [], token: [first] },
        revision: 2,
      }),
      { [placement.assetId]: MAP_URL },
    );

    expect(additionalImages.sprite(firstId)).toBe(firstSprite);
    expect(resources.texture(placement.assetId)).toBe(firstTexture);
    expect(additionalImages.sprite(secondId)).toBeUndefined();
  });

  it('uses an enlarged invisible resize target with rotation-aware cursor feedback', () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              rotation: 0,
              width: 200,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    renderer.selectImages([tokenId]);
    const points = rendererSelectionCorners();

    // Ten pixels is outside the visible five-pixel half-handle but within the
    // intended twelve-pixel interaction radius.
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: points[0].x + 10,
        clientY: points[0].y,
      }),
    );
    expect(element.style.cursor).toBe('nwse-resize');
  });

  it('keeps the default cursor while box-selecting empty canvas space', () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              width: 100,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });

    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 100,
        clientY: 150,
      }),
    );
    expect(element.style.cursor).toBe('');

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 150,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 200,
        clientY: 250,
      }),
    );
    expect(
      (renderer as unknown as { editMode: string }).editMode,
    ).toBe('marquee');
    expect(element.style.cursor).toBe('');
  });

  it('pings after a stationary map hold, preserves selection, and tracks Shift throughout the hold', () => {
    vi.useFakeTimers();
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const onPing = vi.fn();
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              width: 100,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onPing,
      pingEnabled: true,
    });
    renderer.selectImages([tokenId]);
    const expected = renderer.clientToScene(100, 150);

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 150,
      }),
    );
    vi.advanceTimersByTime(499);
    expect(onPing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPing).toHaveBeenCalledWith({
      id: expect.any(String),
      pullPlayers: false,
      sceneId: '11111111-1111-4111-8111-111111111111',
      x: expected.x,
      y: expected.y,
    });
    expect(
      (renderer as unknown as { selected: Set<string> }).selected,
    ).toEqual(new Set([tokenId]));
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 100,
        clientY: 150,
      }),
    );

    vi.advanceTimersByTime(500);
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 120,
        clientY: 170,
      }),
    );
    vi.advanceTimersByTime(250);
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        code: 'ShiftLeft',
        key: 'Shift',
        shiftKey: true,
      }),
    );
    vi.advanceTimersByTime(500);
    expect(onPing).toHaveBeenLastCalledWith(
      expect.objectContaining({ pullPlayers: true }),
    );
  });

  it('cancels a pending ping into box-select after more than eight screen pixels', () => {
    vi.useFakeTimers();
    const onPing = vi.fn();
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
      onPing,
      pingEnabled: true,
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 100,
        clientY: 150,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: 109,
        clientY: 150,
      }),
    );
    vi.advanceTimersByTime(600);

    expect(onPing).not.toHaveBeenCalled();
    expect(
      (renderer as unknown as { editMode: string }).editMode,
    ).toBe('marquee');
    expect(element.style.cursor).toBe('');
  });

  it('never steals a placed-image hold but permits a canonical-map hold', () => {
    vi.useFakeTimers();
    const placedId = '44444444-4444-4444-8444-444444444444';
    const onPing = vi.fn();
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: placedId,
              width: 100,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
      onPing,
      pingEnabled: true,
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
      }),
    );
    vi.advanceTimersByTime(600);
    expect(onPing).not.toHaveBeenCalled();
    element.dispatchEvent(
      pointerEvent('pointerup', {
        button: 0,
        clientX: 400,
        clientY: 300,
      }),
    );

    renderer.setScene(
      scene({
        mapImage: {
          ...placement,
          height: 100,
          width: 100,
          x: 960,
          y: 540,
        },
      }),
      null,
    );
    const onPreviewStart = vi.fn();
    renderer.setInteraction({
      activeLayer: 'map',
      editable: true,
      onCommit: async () => null,
      onPing,
      onPreviewStart,
      pingEnabled: true,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
      }),
    );
    vi.advanceTimersByTime(500);
    expect(onPing).toHaveBeenCalledTimes(1);
    expect(onPreviewStart).not.toHaveBeenCalled();
  });

  it('shows ping actions across the scene and groups them before Duplicate', () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              width: 100,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
      onPing: vi.fn(),
      pingEnabled: true,
    });

    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      }),
    );
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      'Ping here',
      'Pull players here',
      'Duplicate',
      'Move to GM layer',
      'Move to Token layer',
      'Move to Map layer',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Delete',
    ]);

    document.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 5, clientY: 5 }),
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onPing: vi.fn(),
      pingEnabled: true,
    });
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 150,
      }),
    );
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(
        (button) => button.textContent,
      ),
    ).toEqual(['Ping here', 'Pull players here']);
  });

  it('keeps ping actions out of the existing touch long-press menu', () => {
    vi.useFakeTimers();
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              width: 100,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
      onPing: vi.fn(),
      pingEnabled: true,
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerType: 'touch',
      }),
    );
    vi.advanceTimersByTime(500);
    const labels = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].map((button) => button.textContent);
    expect(labels[0]).toBe('Duplicate');
    expect(labels).not.toContain('Ping here');
    expect(labels).not.toContain('Pull players here');
  });

  it('draws transient screen-space ripples and smoothly centers without changing zoom', () => {
    vi.useFakeTimers();
    renderer.setScene(scene(), null);
    const rendererState = renderer as unknown as {
      activePings: Map<string, unknown>;
      camera: { x: number; y: number; zoom: number };
      pingGraphics: Graphics;
    };
    rendererState.camera = { x: 100, y: 100, zoom: 2 };

    renderer.showPing(
      {
        id: '44444444-4444-4444-8444-444444444444',
        pullPlayers: true,
        sceneId: '11111111-1111-4111-8111-111111111111',
        x: 600,
        y: 400,
      },
      true,
    );
    expect(
      rendererState.pingGraphics.calls.filter((call) => call.op === 'circle'),
    ).toHaveLength(3);
    expect(rendererState.activePings.size).toBe(1);

    vi.advanceTimersByTime(320);
    expect(rendererState.camera).toEqual({ x: 600, y: 400, zoom: 2 });
    vi.advanceTimersByTime(900);
    expect(rendererState.activePings.size).toBe(0);
  });

  it('lets the newest camera pull win and cancels it on manual camera input', () => {
    vi.useFakeTimers();
    renderer.setScene(scene(), null);
    const rendererState = renderer as unknown as {
      camera: { x: number; y: number; zoom: number };
    };
    rendererState.camera = { x: 100, y: 100, zoom: 2 };
    renderer.showPing(
      {
        id: '44444444-4444-4444-8444-444444444444',
        pullPlayers: true,
        sceneId: '11111111-1111-4111-8111-111111111111',
        x: 500,
        y: 400,
      },
      true,
    );
    vi.advanceTimersByTime(100);
    renderer.showPing(
      {
        id: '55555555-5555-4555-8555-555555555555',
        pullPlayers: true,
        sceneId: '11111111-1111-4111-8111-111111111111',
        x: 700,
        y: 600,
      },
      true,
    );
    vi.advanceTimersByTime(320);
    expect(rendererState.camera).toEqual({ x: 700, y: 600, zoom: 2 });

    renderer.showPing(
      {
        id: '66666666-6666-4666-8666-666666666666',
        pullPlayers: true,
        sceneId: '11111111-1111-4111-8111-111111111111',
        x: 900,
        y: 800,
      },
      true,
    );
    vi.advanceTimersByTime(50);
    element.dispatchEvent(
      new WheelEvent('wheel', {
        cancelable: true,
        clientX: 400,
        clientY: 300,
        deltaY: -120,
      }),
    );
    const afterManualInput = { ...rendererState.camera };
    vi.advanceTimersByTime(400);
    expect(rendererState.camera).toEqual(afterManualInput);
  });

  it('preserves proportions by default and allows free resizing with Shift', () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setScene(
      scene({
        grid: { ...createDefaultGrid(), type: 'gridless' },
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: tokenId,
              width: 200,
              x: 960,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    renderer.selectImages([tokenId]);
    const rendererState = renderer as unknown as {
      scene: SceneRecord;
    };

    let corner = rendererSelectionCorners()[2];
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: corner.x,
        clientY: corner.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: corner.x + 30,
        clientY: corner.y + 5,
      }),
    );
    let resized = rendererState.scene.images.token[0];
    expect(resized.width / resized.height).toBeCloseTo(2, 2);
    element.dispatchEvent(
      pointerEvent('pointercancel', {
        button: -1,
        clientX: corner.x + 30,
        clientY: corner.y + 5,
      }),
    );

    corner = rendererSelectionCorners()[2];
    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: corner.x,
        clientY: corner.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: corner.x + 30,
        clientY: corner.y + 5,
        shiftKey: true,
      }),
    );
    resized = rendererState.scene.images.token[0];
    expect(resized.width / resized.height).not.toBeCloseTo(2, 1);
  });

  it('snaps a previously free-rotated object back to an absolute grid angle', () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    const rendererState = renderer as unknown as {
      scene: SceneRecord;
    };

    for (const [startingRotation, dragDegrees, expected] of [
      [7, 8, 15],
      [353, 8, 0],
      [-7, -8, 345],
    ]) {
      renderer.setScene(
        scene({
          images: {
            gm: [],
            map: [],
            token: [
              {
                ...placement,
                height: 100,
                id: tokenId,
                rotation: startingRotation,
                width: 200,
                x: 960,
                y: 540,
              },
            ],
          },
        }),
        null,
      );
      renderer.selectImages([tokenId]);
      const points = rendererSelectionCorners();
      const center = {
        x: (points[0].x + points[2].x) / 2,
        y: (points[0].y + points[2].y) / 2,
      };
      const handle = rotationHandle(points).handle;
      const radians = (dragDegrees * Math.PI) / 180;
      const dx = handle.x - center.x;
      const dy = handle.y - center.y;

      element.dispatchEvent(
        pointerEvent('pointerdown', {
          button: 0,
          clientX: handle.x,
          clientY: handle.y,
        }),
      );
      element.dispatchEvent(
        pointerEvent('pointermove', {
          button: -1,
          clientX: center.x + Math.cos(radians) * dx - Math.sin(radians) * dy,
          clientY: center.y + Math.sin(radians) * dx + Math.cos(radians) * dy,
        }),
      );
      expect(rendererState.scene.images.token[0].rotation).toBe(expected);
      element.dispatchEvent(
        pointerEvent('pointercancel', {
          button: -1,
          clientX: handle.x,
          clientY: handle.y,
        }),
      );
    }
  });

  it('snaps a previously free-rotated group absolutely while preserving relative rotations', () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    renderer.setScene(
      scene({
        images: {
          gm: [],
          map: [],
          token: [
            {
              ...placement,
              height: 100,
              id: firstId,
              rotation: 12,
              width: 100,
              x: 900,
              y: 540,
            },
            {
              ...placement,
              height: 100,
              id: secondId,
              rotation: 42,
              width: 100,
              x: 1020,
              y: 540,
            },
          ],
        },
      }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    renderer.selectImages([firstId, secondId]);
    const rendererState = renderer as unknown as {
      groupSelectionRotation: number;
      scene: SceneRecord;
    };
    rendererState.groupSelectionRotation = 7;
    const points = rendererSelectionCorners();
    const center = {
      x: (points[0].x + points[2].x) / 2,
      y: (points[0].y + points[2].y) / 2,
    };
    const handle = rotationHandle(points).handle;
    const radians = (8 * Math.PI) / 180;
    const dx = handle.x - center.x;
    const dy = handle.y - center.y;

    element.dispatchEvent(
      pointerEvent('pointerdown', {
        button: 0,
        clientX: handle.x,
        clientY: handle.y,
      }),
    );
    element.dispatchEvent(
      pointerEvent('pointermove', {
        button: -1,
        clientX: center.x + Math.cos(radians) * dx - Math.sin(radians) * dy,
        clientY: center.y + Math.sin(radians) * dx + Math.cos(radians) * dy,
      }),
    );

    const [first, second] = rendererState.scene.images.token;
    expect(rendererState.groupSelectionRotation).toBe(15);
    expect(first.rotation).toBe(20);
    expect(second.rotation).toBe(50);
    expect(second.rotation - first.rotation).toBe(30);
  });

  it('keeps the active layer unchanged and deselects only after a successful layer move', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: tokenId,
            width: 100,
            x: 960,
            y: 540,
          },
        ],
      },
    });
    const onActiveLayerChange = vi.fn();
    const onCommit = vi.fn(async (
      ...args: [SceneObjectState, string?, unknown?]
    ) => {
      const [state] = args;
      return {
        ...current,
        ...state,
        revision: current.revision + 1,
      };
    });
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onActiveLayerChange,
      onCommit,
    });

    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      }),
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(3);
    const labels = [...menu.querySelectorAll('button')].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual([
      'Duplicate',
      'Move to GM layer',
      'Move to Token layer',
      'Move to Map layer',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Delete',
    ]);
    expect(menu.children[1].getAttribute('role')).toBe('separator');
    expect(menu.children[5].getAttribute('role')).toBe('separator');
    expect(
      [...menu.children].at(-3)?.textContent,
    ).toBe('Send to back');
    /* Destructive entries are fenced off from the rest of the menu everywhere
       they appear, so Delete is preceded by a separator here too. */
    expect(
      [...menu.children].at(-2)?.getAttribute('role'),
    ).toBe('separator');
    expect(
      [...menu.children].at(-1)?.textContent,
    ).toBe('Delete');
    (
      [...menu.querySelectorAll('button')].find(
        (button) => button.textContent === 'Move to GM layer',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(onActiveLayerChange).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalled();
    expect(onCommit.mock.calls[0][2]).toEqual({
      kind: 'move-layer',
      targetLayer: 'gm',
      targets: [tokenId],
    });
    expect(
      (renderer as unknown as { interaction: { activeLayer: string } })
        .interaction.activeLayer,
    ).toBe('token');
    expect(
      (renderer as unknown as { selected: Set<string> }).selected.size,
    ).toBe(0);
  });

  it('duplicates from the context menu and delegates undo to authoritative history', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: tokenId,
            rotation: 30,
            width: 100,
            x: 960,
            y: 540,
          },
        ],
      },
    });
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: current.revision + 1,
    }));
    const onUndo = vi.fn(async () => ({
      ...current,
      revision: current.revision + 2,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
      onUndo,
    });

    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      }),
    );
    const duplicate = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Duplicate',
    ) as HTMLButtonElement;
    expect(duplicate.disabled).toBe(false);
    duplicate.click();
    await settle();

    const rendererState = renderer as unknown as {
      scene: SceneRecord;
      selected: Set<string>;
    };
    const copy = rendererState.scene.images.token[1];
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(copy.id).not.toBe(tokenId);
    expect(copy).toMatchObject({
      assetId: placement.assetId,
      height: 100,
      rotation: 30,
      width: 100,
      x: 1030,
      y: 610,
    });
    expect([...rendererState.selected]).toEqual([copy.id]);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    element.dispatchEvent(shortcutEvent('z'));
    await settle();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(rendererState.scene.images.token).toHaveLength(1);
  });

  it('duplicates multi-selections in z-order with gridless cascading and ignores key repeat', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const middleId = '55555555-5555-4555-8555-555555555555';
    const secondId = '66666666-6666-4666-8666-666666666666';
    const current = scene({
      grid: { ...createDefaultGrid(), type: 'gridless' },
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 40,
            id: firstId,
            rotation: 15,
            width: 80,
            x: 100,
            y: 100,
          },
          {
            ...placement,
            id: middleId,
            x: 300,
            y: 100,
          },
          {
            ...placement,
            height: 60,
            id: secondId,
            rotation: 45,
            width: 120,
            x: 200,
            y: 100,
          },
        ],
      },
    });
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: current.revision + 1,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([firstId, secondId]);
    (
      renderer as unknown as { groupSelectionRotation: number }
    ).groupSelectionRotation = 25;

    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'ControlRight',
        ctrlKey: true,
        key: 'Control',
      }),
    );
    element.dispatchEvent(
      shortcutEvent('d', { ctrlKey: false, metaKey: true }),
    );
    await settle();
    expect(onCommit).not.toHaveBeenCalled();

    element.dispatchEvent(shortcutEvent('d'));
    await settle();
    const rendererState = renderer as unknown as {
      groupSelectionRotation: number;
      scene: SceneRecord;
      selected: Set<string>;
    };
    const firstCopies = rendererState.scene.images.token.slice(3);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(firstCopies).toHaveLength(2);
    expect(firstCopies.map((image) => image.x)).toEqual([120, 220]);
    expect(firstCopies.map((image) => image.y)).toEqual([120, 120]);
    expect(firstCopies.map((image) => image.rotation)).toEqual([15, 45]);
    expect(firstCopies.map((image) => image.width)).toEqual([80, 120]);
    expect(new Set(firstCopies.map((image) => image.id)).size).toBe(2);
    expect(
      firstCopies.every(
        (image) =>
          image.id !== firstId &&
          image.id !== middleId &&
          image.id !== secondId,
      ),
    ).toBe(true);
    expect([...rendererState.selected]).toEqual(
      firstCopies.map((image) => image.id),
    );
    expect(rendererState.groupSelectionRotation).toBe(25);

    element.dispatchEvent(shortcutEvent('d', { repeat: true }));
    await settle();
    expect(onCommit).toHaveBeenCalledTimes(1);

    element.dispatchEvent(shortcutEvent('d'));
    await settle();
    const secondCopies = rendererState.scene.images.token.slice(5);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(secondCopies.map((image) => image.x)).toEqual([140, 240]);
    expect(secondCopies.map((image) => image.y)).toEqual([140, 140]);
  });

  it('copies without committing and pastes into the active layer with cascading offsets', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 50,
            id: firstId,
            rotation: 10,
            width: 100,
            x: 100,
            y: 200,
          },
          {
            ...placement,
            height: 75,
            id: secondId,
            rotation: 20,
            width: 150,
            x: 300,
            y: 200,
          },
        ],
      },
    });
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: current.revision + 1,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([firstId, secondId]);
    (
      renderer as unknown as { groupSelectionRotation: number }
    ).groupSelectionRotation = 12;

    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'ControlLeft',
        ctrlKey: true,
        key: 'Control',
      }),
    );
    const copyEvent = shortcutEvent('c');
    element.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    expect(
      (renderer as unknown as { selected: Set<string> }).selected,
    ).toEqual(new Set([firstId, secondId]));

    renderer.setInteraction({
      activeLayer: 'gm',
      editable: true,
      onCommit,
    });
    element.dispatchEvent(shortcutEvent('v'));
    await settle();

    const rendererState = renderer as unknown as {
      groupSelectionRotation: number;
      scene: SceneRecord;
      selected: Set<string>;
    };
    const firstPaste = rendererState.scene.images.gm;
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(firstPaste.map((image) => [image.x, image.y])).toEqual([
      [170, 270],
      [370, 270],
    ]);
    expect(firstPaste.map((image) => image.rotation)).toEqual([10, 20]);
    expect(firstPaste.map((image) => image.assetId)).toEqual([
      placement.assetId,
      placement.assetId,
    ]);
    expect([...rendererState.selected]).toEqual(
      firstPaste.map((image) => image.id),
    );
    expect(rendererState.groupSelectionRotation).toBe(12);

    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    const secondPaste = rendererState.scene.images.gm.slice(2);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(secondPaste.map((image) => [image.x, image.y])).toEqual([
      [240, 340],
      [440, 340],
    ]);
    expect(
      new Set(
        [...firstPaste, ...secondPaste].map((image) => image.id),
      ).size,
    ).toBe(4);
  });

  it('keeps the clipboard across scenes and centers the first cross-scene paste in the viewport', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    const source = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: firstId,
            width: 100,
            x: 100,
            y: 200,
          },
          {
            ...placement,
            height: 100,
            id: secondId,
            width: 100,
            x: 300,
            y: 200,
          },
        ],
      },
    });
    renderer.setScene(source, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    renderer.selectImages([firstId, secondId]);
    element.dispatchEvent(shortcutEvent('c'));

    const target = scene({
      height: 800,
      id: '77777777-7777-4777-8777-777777777777',
      width: 1000,
    });
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...target,
      ...state,
      revision: target.revision + 1,
    }));
    renderer.setScene(target, null);
    renderer.setInteraction({
      activeLayer: 'map',
      editable: true,
      onCommit,
    });
    element.dispatchEvent(shortcutEvent('v'));
    await settle();

    const rendererState = renderer as unknown as {
      camera: { x: number; y: number };
      scene: SceneRecord;
    };
    const firstPaste = rendererState.scene.images.map;
    expect(firstPaste).toHaveLength(2);
    expect(
      (firstPaste[0].x + firstPaste[1].x) / 2,
    ).toBeCloseTo(rendererState.camera.x);
    expect(
      (firstPaste[0].y + firstPaste[1].y) / 2,
    ).toBeCloseTo(rendererState.camera.y);

    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    const secondPaste = rendererState.scene.images.map.slice(2);
    expect(
      (secondPaste[0].x + secondPaste[1].x) / 2,
    ).toBeCloseTo(rendererState.camera.x + 70);
    expect(
      (secondPaste[0].y + secondPaste[1].y) / 2,
    ).toBeCloseTo(rendererState.camera.y + 70);
  });

  it('disables canonical-map duplication and preserves an earlier clipboard after invalid copy', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: tokenId,
            width: 100,
            x: 960,
            y: 540,
          },
        ],
      },
      mapImage: {
        ...placement,
        height: 100,
        width: 100,
        x: 960,
        y: 540,
      },
    });
    const onCommit = vi.fn(async (state: SceneObjectState) => ({
      ...current,
      ...state,
      revision: current.revision + 1,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([tokenId]);
    element.dispatchEvent(shortcutEvent('c'));

    renderer.setInteraction({
      activeLayer: 'map',
      editable: true,
      onCommit,
    });
    renderer.selectImages([CANONICAL_MAP_ID]);
    (
      renderer as unknown as {
        openContextMenu(clientX: number, clientY: number): void;
      }
    ).openContextMenu(400, 300);
    const duplicate = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Duplicate',
    ) as HTMLButtonElement;
    expect(duplicate.disabled).toBe(true);
    (
      renderer as unknown as { closeContextMenu(): void }
    ).closeContextMenu();

    element.dispatchEvent(shortcutEvent('c'));
    element.dispatchEvent(shortcutEvent('d'));
    await settle();
    expect(onCommit).not.toHaveBeenCalled();

    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    const rendererState = renderer as unknown as {
      scene: SceneRecord;
      selected: Set<string>;
    };
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(rendererState.scene.images.map).toHaveLength(1);
    expect(rendererState.scene.images.map[0]).toMatchObject({
      assetId: placement.assetId,
      x: 1030,
      y: 610,
    });
    expect([...rendererState.selected]).toEqual([
      rendererState.scene.images.map[0].id,
    ]);
  });

  it('rejects duplicate and paste atomically when the scene image limit is reached', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    const source = scene({
      images: {
        gm: [],
        map: [],
        token: [
          { ...placement, id: firstId, x: 100, y: 100 },
          { ...placement, id: secondId, x: 200, y: 100 },
        ],
      },
    });
    const onCommit = vi.fn(async () => null);
    renderer.setScene(source, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([firstId, secondId]);
    element.dispatchEvent(shortcutEvent('c'));

    const images: SceneImage[] = Array.from(
      { length: MAX_SCENE_IMAGES },
      (_, index) => ({
        ...placement,
        height: 10,
        id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        width: 10,
        x: 960,
        y: 540,
      }),
    );
    const full = scene({
      id: '77777777-7777-4777-8777-777777777777',
      images: { gm: [], map: [], token: images },
    });
    (renderer as unknown as { scene: SceneRecord }).scene = full;
    renderer.selectImages([images[0].id]);
    (
      renderer as unknown as {
        openContextMenu(clientX: number, clientY: number): void;
      }
    ).openContextMenu(400, 300);
    const duplicate = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Duplicate',
    ) as HTMLButtonElement;
    expect(duplicate.disabled).toBe(true);
    (
      renderer as unknown as { closeContextMenu(): void }
    ).closeContextMenu();

    element.dispatchEvent(shortcutEvent('d'));
    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    expect(onCommit).not.toHaveBeenCalled();
    expect(
      (renderer as unknown as { scene: SceneRecord }).scene.images.token,
    ).toHaveLength(MAX_SCENE_IMAGES);
  });

  it('preserves scene, selection, and paste position when a paste commit fails', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: tokenId,
            width: 100,
            x: 100,
            y: 100,
          },
        ],
      },
    });
    let attempt = 0;
    const onCommit = vi.fn(async (state: SceneObjectState) => {
      attempt += 1;
      return attempt === 1
        ? null
        : { ...current, ...state, revision: attempt };
    });
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([tokenId]);
    element.dispatchEvent(shortcutEvent('c'));

    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    const rendererState = renderer as unknown as {
      scene: SceneRecord;
      selected: Set<string>;
    };
    expect(rendererState.scene.images.token).toHaveLength(1);
    expect([...rendererState.selected]).toEqual([tokenId]);

    element.dispatchEvent(shortcutEvent('v'));
    await settle();
    expect(rendererState.scene.images.token).toHaveLength(2);
    expect(rendererState.scene.images.token[1]).toMatchObject({
      x: 170,
      y: 170,
    });
    expect([...rendererState.selected]).toEqual([
      rendererState.scene.images.token[1].id,
    ]);
  });

  it('preserves selection and layer state when a layer move fails to commit', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [{ ...placement, id: tokenId, x: 960, y: 540 }],
      },
    });
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit: async () => null,
    });
    renderer.selectImages([tokenId]);

    await (
      renderer as unknown as {
        moveSelectionToLayer(layer: 'gm'): Promise<void>;
      }
    ).moveSelectionToLayer('gm');

    expect(
      (renderer as unknown as { selected: Set<string> }).selected.has(tokenId),
    ).toBe(true);
    expect(
      (renderer as unknown as { scene: SceneRecord }).scene.images.token,
    ).toHaveLength(1);
    expect(
      (renderer as unknown as { scene: SceneRecord }).scene.images.gm,
    ).toHaveLength(0);
  });

  it('arms before deleting from the context menu', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [
          {
            ...placement,
            height: 100,
            id: tokenId,
            width: 100,
            x: 960,
            y: 540,
          },
        ],
      },
    });
    const onCommit = vi.fn(async (state) => ({
      ...current,
      ...state,
      revision: 1,
    }));
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });

    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      }),
    );
    const deleteButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Delete selection"]',
    )!;

    /* First press only arms: the menu stays open so the second press has
       somewhere to land, and nothing is committed yet. */
    expect(deleteButton).toHaveAttribute('aria-pressed', 'false');
    deleteButton.click();
    await settle();
    expect(deleteButton).toHaveAttribute('aria-pressed', 'true');
    expect(deleteButton.textContent).toBe('Confirm Delete');
    expect(deleteButton.getAttribute('aria-label')).toBe(
      'Confirm deletion of selection',
    );
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    deleteButton.click();
    await settle();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('deletes immediately from the keyboard and preserves selection on failure', async () => {
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const current = scene({
      images: {
        gm: [],
        map: [],
        token: [{ ...placement, id: tokenId, x: 960, y: 540 }],
      },
    });
    const onCommit = vi.fn(async () => null);
    renderer.setScene(current, null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: true,
      onCommit,
    });
    renderer.selectImages([tokenId]);

    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Delete',
      }),
    );
    await settle();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(
      (renderer as unknown as { selected: Set<string> }).selected.has(tokenId),
    ).toBe(true);
    expect(
      (renderer as unknown as { scene: SceneRecord }).scene.images.token,
    ).toHaveLength(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('drops the map sprite when the scene loses its image', async () => {
    renderer.setScene(scene({ mapImage: placement }), MAP_URL);
    await settle();
    expect(spriteOf(renderer)).toBeDefined();

    renderer.setScene(scene({ mapImage: null }), null);
    await settle();

    expect(spriteOf(renderer)).toBeUndefined();
  });

  it('outlines the scene so an empty one is distinct from the backdrop', () => {
    renderer.setScene(scene(), null);

    const outline = (renderer as unknown as { outline: Graphics }).outline;
    const rect = outline.calls.find((call) => call.op === 'rect');
    const zoom = (renderer as unknown as { camera: { zoom: number } }).camera
      .zoom;
    const [, , width, height] = rect?.args as number[];

    expect(width).toBeCloseTo(1920 * zoom, 0);
    expect(height).toBeCloseTo(1080 * zoom, 0);
    // A constant hairline whatever the zoom, like the grid.
    expect(outline.calls.find((call) => call.op === 'stroke')?.args[0]).toMatchObject(
      { width: 1 },
    );
  });

  it('clears the outline when there is no scene', () => {
    renderer.setScene(scene(), null);
    renderer.setScene(null, null);

    const outline = (renderer as unknown as { outline: Graphics }).outline;
    expect(outline.calls.some((call) => call.op === 'rect')).toBe(false);
  });

  it('spans the crosshatch across the scene, not the viewport', () => {
    renderer.setScene(scene(), null);

    const hatch = hatchOf(renderer);
    expect(hatch?.width).toBe(1920);
    expect(hatch?.height).toBe(1080);
    expect(hatch?.tileScale.x).toBe(1);
  });

  it('keeps the same number of hatch lines across the scene at any zoom', () => {
    renderer.setScene(scene(), null);

    // Tiles across the scene, which is what "density" means to someone looking
    // at the map. Rescaling the tile to follow the camera would change this.
    const tilesAcross = () => {
      const hatch = hatchOf(renderer);
      return hatch!.width / hatch!.tileScale.x;
    };
    const before = tilesAcross();
    const fitted = (renderer as unknown as { camera: { zoom: number } }).camera
      .zoom;

    renderer.resize(1600, 1200);
    renderer.fitToScene();

    expect(
      (renderer as unknown as { camera: { zoom: number } }).camera.zoom,
    ).not.toBeCloseTo(fitted, 6);
    expect(tilesAcross()).toBe(before);
  });

  it('draws no grid lines for a gridless scene', () => {
    renderer.setScene(
      scene({ grid: { ...createDefaultGrid(), type: 'gridless' } }),
      null,
    );

    expect(
      gridOf(renderer).calls.filter((call) => call.op === 'lineTo'),
    ).toHaveLength(0);
  });

  it('strokes a square grid with the configured colour and opacity', () => {
    renderer.setScene(
      scene({
        grid: {
          ...createDefaultGrid(),
          color: '#3a7bd5',
          lineThickness: 2,
          opacity: 0.4,
          size: 100,
          type: 'square',
        },
      }),
      null,
    );

    const calls = gridOf(renderer).calls;
    expect(calls.filter((call) => call.op === 'lineTo').length).toBeGreaterThan(
      0,
    );
    const stroke = calls.find((call) => call.op === 'stroke');
    expect(stroke?.args[0]).toMatchObject({ alpha: 0.4, color: 0x3a7bd5 });
  });

  it('draws the grid pixel-snapped in screen space at a constant width', () => {
    const squareGrid = {
      ...createDefaultGrid(),
      lineThickness: 2,
      size: 100,
      type: 'square' as const,
    };
    renderer.setScene(scene({ grid: squareGrid }), null);

    const strokeWidth = () =>
      (
        gridOf(renderer).calls.find((call) => call.op === 'stroke')
          ?.args[0] as { width: number }
      ).width;
    const coordinates = () =>
      gridOf(renderer)
        .calls.filter((call) => call.op === 'moveTo' || call.op === 'lineTo')
        .flatMap((call) => call.args as number[]);
    const zoom = () =>
      (renderer as unknown as { camera: { zoom: number } }).camera.zoom;

    // An even thickness snaps to whole pixels; inside the scaled world
    // container these would be fractional and the antialiaser makes them crawl.
    expect(coordinates().every((value) => Number.isInteger(value))).toBe(true);
    expect(strokeWidth()).toBe(2);

    const fitted = zoom();
    renderer.resize(1600, 1200);
    renderer.fitToScene();

    expect(zoom()).not.toBeCloseTo(fitted, 6);
    // Thickness means the same number of pixels at every zoom.
    expect(strokeWidth()).toBe(2);
    expect(coordinates().every((value) => Number.isInteger(value))).toBe(true);
  });

  it('offsets odd line thicknesses by a half pixel to stay crisp', () => {
    renderer.setScene(
      scene({
        grid: {
          ...createDefaultGrid(),
          lineThickness: 1,
          size: 100,
          type: 'square',
        },
      }),
      null,
    );

    const coordinates = gridOf(renderer)
      .calls.filter((call) => call.op === 'moveTo' || call.op === 'lineTo')
      .flatMap((call) => call.args as number[]);

    expect(coordinates.length).toBeGreaterThan(0);
    expect(coordinates.every((value) => Math.abs(value % 1) === 0.5)).toBe(
      true,
    );
  });

  it('authors multiline text locally and commits it with the captured style', async () => {
    const onCommit = vi.fn(async (state: SceneObjectState) =>
      scene({ ...state, revision: 1 }),
    );
    const textStyle = sceneText().style;
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onCommit,
      textEnabled: true,
      textStyle,
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }),
    );
    const editor = element.querySelector('textarea');
    expect(editor).not.toBeNull();
    if (!editor) {
      return;
    }
    editor.value = '  First\nSecond 😀  ';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(textPreviewOf(renderer)?.text).toBe(editor.value);
    expect(textPreviewOf(renderer)?.style.stroke).toEqual({
      color: '#000000',
      width: 2,
    });
    expect(editor.style.webkitTextStroke).toBe('');
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const committed = onCommit.mock.calls[0][0];
    expect(committed.texts.token[0]).toMatchObject({
      content: '  First\nSecond 😀  ',
      ownerId: null,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      style: textStyle,
      x: 960,
      y: 540,
    });
    await vi.waitFor(() =>
      expect(element.querySelector('textarea')).toBeNull(),
    );
    expect(textPreviewOf(renderer)).toBeNull();
  });

  it('keeps invalid and conflicted text drafts open with an error', async () => {
    const onCommit = vi.fn(async () => null);
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onCommit,
      textEnabled: true,
      textStyle: sceneText().style,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }),
    );
    const editor = element.querySelector('textarea')!;
    const invalidContent = Array.from(
      { length: 33 },
      (_, index) => `Line ${index + 1}`,
    ).join('\n');
    editor.value = invalidContent;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')).toHaveTextContent(
        'Text can contain at most 32 lines.',
      ),
    );
    expect(element.querySelector('textarea')).toHaveValue(invalidContent);
    expect(onCommit).not.toHaveBeenCalled();

    editor.value = 'A valid but conflicted draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')).toHaveTextContent(
        'Text could not be saved because the scene changed. Try again.',
      ),
    );
    expect(element.querySelector('textarea')).toHaveValue(
      'A valid but conflicted draft',
    );
  });

  it('retries a conflicted draft on top of the latest authoritative scene', async () => {
    let resolveFirst!: (value: SceneRecord | null) => void;
    const firstCommit = new Promise<SceneRecord | null>((resolve) => {
      resolveFirst = resolve;
    });
    const onCommit = vi
      .fn<(state: SceneObjectState) => Promise<SceneRecord | null>>()
      .mockImplementationOnce(async () => firstCommit)
      .mockImplementationOnce(async (state) =>
        scene({ ...state, revision: 2 }),
      );
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onCommit,
      textEnabled: true,
      textStyle: sceneText().style,
    });
    element.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }),
    );
    const editor = element.querySelector('textarea')!;
    editor.value = 'Keep this draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    );
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());

    const concurrentTexts = createEmptyTextLayers();
    concurrentTexts.token.push(
      sceneText({ id: '88888888-8888-4888-8888-888888888888' }),
    );
    renderer.setScene(scene({ revision: 1, texts: concurrentTexts }), null);
    resolveFirst(null);
    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')).toBeVisible(),
    );
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit.mock.calls[1][0].texts.token).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '88888888-8888-4888-8888-888888888888',
        }),
        expect.objectContaining({ content: 'Keep this draft' }),
      ]),
    );
    await vi.waitFor(() =>
      expect(element.querySelector('textarea')).toBeNull(),
    );
  });

  it('cancels blank drafts and remains ready for repeated text placement', async () => {
    const onCommit = vi.fn(async (state: SceneObjectState) => scene(state));
    renderer.setScene(scene(), null);
    renderer.setInteraction({
      activeLayer: 'token',
      editable: false,
      onCommit,
      textEnabled: true,
      textStyle: sceneText().style,
    });

    element.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }),
    );
    const first = element.querySelector('textarea')!;
    first.value = ' \n\t ';
    first.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(onCommit).not.toHaveBeenCalled();

    element.dispatchEvent(
      pointerEvent('pointerdown', { button: 0, clientX: 420, clientY: 320 }),
    );
    expect(element.querySelector('textarea')).not.toBeNull();
    element.querySelector('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }),
    );
    expect(element.querySelector('textarea')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('edits text content inline without changing its center, transform, or style', async () => {
    const original = sceneText();
    const onCommit = vi.fn(async (state: SceneObjectState) =>
      scene({ ...state, revision: 1 }),
    );
    renderer.setScene(
      scene({ texts: { ...createEmptyTextLayers(), token: [original] } }),
      null,
    );
    renderer.setInteraction({
      activeLayer: 'token',
      canEditImages: true,
      editable: true,
      onCommit,
    });

    element.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      }),
    );
    const editor = element.querySelector('textarea');
    expect(editor?.value).toBe('Old label');
    if (!editor) {
      return;
    }
    editor.value = 'New\nlabel';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        key: 'Enter',
      }),
    );

    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].texts.token[0]).toEqual({
      ...original,
      content: 'New\nlabel',
    });
  });

  it('does not open a text editor when a shape is double-clicked', () => {
    const original = sceneShape();
    renderer.setScene(scene({
      shapes: { ...createEmptyShapeLayers(), token: [original] },
    }), null);
    renderer.setInteraction({
      activeLayer: 'token',
      canEditImages: true,
      editable: true,
      onCommit: vi.fn(async () => null),
    });

    element.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 300,
    }));
    expect(element.querySelector('textarea')).toBeNull();
  });

  describe('camera input', () => {
    const cameraOf = () =>
      (renderer as unknown as { camera: { x: number; y: number; zoom: number } })
        .camera;

    const press = (button: number, clientX: number, clientY: number) =>
      element.dispatchEvent(
        pointerEvent('pointerdown', { button, clientX, clientY }),
      );
    const move = (clientX: number, clientY: number) =>
      element.dispatchEvent(
        pointerEvent('pointermove', { button: -1, clientX, clientY }),
      );
    const release = () =>
      element.dispatchEvent(pointerEvent('pointerup', { button: -1 }));

    it('ignores a left drag so the tools keep the primary button', () => {
      renderer.setScene(scene(), null);
      const before = { ...cameraOf() };

      press(0, 100, 100);
      move(220, 180);
      release();

      expect(cameraOf()).toEqual(before);
    });

    it('ignores a right drag as well', () => {
      renderer.setScene(scene(), null);
      const before = { ...cameraOf() };

      press(2, 100, 100);
      move(220, 180);
      release();

      expect(cameraOf()).toEqual(before);
    });

    it('pans while the middle button is held', () => {
      renderer.setScene(scene(), null);
      const before = { ...cameraOf() };

      press(1, 100, 100);
      move(160, 140);

      const during = cameraOf();
      // Dragging right and down moves the camera left and up over the scene.
      expect(during.x).toBeLessThan(before.x);
      expect(during.y).toBeLessThan(before.y);
      expect(during.zoom).toBe(before.zoom);

      release();
      const afterRelease = { ...cameraOf() };
      move(400, 400);
      expect(cameraOf()).toEqual(afterRelease);
    });

    it('zooms from the wheel, anchored under the cursor', () => {
      renderer.setScene(scene(), null);
      const before = { ...cameraOf() };

      element.dispatchEvent(
        new WheelEvent('wheel', {
          cancelable: true,
          clientX: 400,
          clientY: 300,
          deltaY: -240,
        }),
      );

      expect(cameraOf().zoom).toBeGreaterThan(before.zoom);
    });

    it('moves committed fog with wheel zoom in the same input turn', () => {
      renderer.setScene(scene({
        fog: { base: 'covered', color: '#000000', operations: [] },
      }), null);
      const fogRenderer = (renderer as unknown as {
        fogRenderer: {
          render: () => void;
          sprite: { scale: { x: number } };
        };
      }).fogRenderer;
      const renderFog = vi.spyOn(fogRenderer, 'render');
      renderFog.mockClear();

      element.dispatchEvent(
        new WheelEvent('wheel', {
          cancelable: true,
          clientX: 400,
          clientY: 300,
          deltaY: -240,
        }),
      );

      expect(renderFog).toHaveBeenCalledTimes(1);
      expect(fogRenderer.sprite.scale.x).toBe(cameraOf().zoom);
    });
  });

  it('fits a new scene into the viewport', () => {
    renderer.setScene(scene(), null);

    const camera = (renderer as unknown as { camera: { zoom: number } }).camera;
    // 800 / 1920 is the binding axis, less the fit padding.
    expect(camera.zoom).toBeCloseTo((800 / 1920) * 0.94, 6);
  });
});
