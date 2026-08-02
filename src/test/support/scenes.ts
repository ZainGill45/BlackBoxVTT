import { vi } from 'vitest';
import type { AssetApi, AssetView } from '../../shared/assets';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createSceneObjectOrder,
  createEmptySceneManifest,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  DEFAULT_SCENE_DISTANCE,
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_PIXEL_SCALE,
  DEFAULT_SCENE_UNIT,
  DEFAULT_SCENE_WIDTH,
  type SceneApi,
  type SceneChangedEvent,
  type SceneImage,
  type SceneRecord,
} from '../../shared/scenes';

export const testCampaignId = '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325';

export function makeScene(overrides: Partial<SceneRecord> = {}): SceneRecord {
  const drawings = overrides.drawings ?? createEmptyDrawingLayers();
  const fog = overrides.fog ?? createDefaultFog();
  const images = overrides.images ?? createEmptyImageLayers();
  const shapes = overrides.shapes ?? createEmptyShapeLayers();
  const texts = overrides.texts ?? createEmptyTextLayers();
  return {
    createdAt: '2026-07-28T00:00:00.000Z',
    distance: DEFAULT_SCENE_DISTANCE,
    grid: createDefaultGrid(),
    height: DEFAULT_SCENE_HEIGHT,
    id: '11111111-1111-4111-8111-111111111111',
    mapImage: null,
    name: 'Iron Keep',
    objectOrder: overrides.objectOrder ?? createSceneObjectOrder({
      drawings,
      images,
      shapes,
      texts,
    }),
    pixelScale: DEFAULT_SCENE_PIXEL_SCALE,
    revision: 0,
    unit: DEFAULT_SCENE_UNIT,
    updatedAt: '2026-07-28T00:00:00.000Z',
    width: DEFAULT_SCENE_WIDTH,
    ...overrides,
    drawings,
    fog,
    images,
    shapes,
    texts,
  };
}

export function makeImageAsset(
  overrides: Partial<AssetView> = {},
): AssetView {
  return {
    available: true,
    capabilities: {
      delete: true,
      import: true,
      list: true,
      preview: true,
      read: true,
      rename: true,
    },
    chunkHashes: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    createdBy: 'gm',
    displayName: 'Keep Ground Floor',
    extension: 'png',
    fileModifiedAtMs: 0,
    format: 'png',
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'image',
    lastModifiedAt: '2026-07-28T00:00:00.000Z',
    lastModifiedBy: 'gm',
    mimeType: 'image/png',
    originalFilename: 'keep.png',
    revision: 0,
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    syncState: 'ready',
    ...overrides,
  };
}

/** An in-memory scene API that behaves like the real repository contract. */
export function createFakeSceneApi(initial: SceneRecord[] = []) {
  let manifest = { ...createEmptySceneManifest(), scenes: initial };
  const listeners = new Set<(event: SceneChangedEvent) => void>();
  let nextId = 0;

  const publish = () => {
    manifest = { ...manifest, revision: manifest.revision + 1 };
    for (const listener of listeners) {
      listener({ campaignId: testCampaignId, manifest });
    }
  };

  const api: SceneApi = {
    create: vi.fn(async () => {
      nextId += 1;
      const scene = makeScene({
        id: `3333333${nextId}-3333-4333-8333-333333333333`,
        name: 'New Scene',
      });
      manifest = { ...manifest, scenes: [...manifest.scenes, scene] };
      publish();
      return { ok: true as const, value: scene };
    }),
    detachAsset: vi.fn(async ({ assetId }) => {
      manifest = {
        ...manifest,
        scenes: manifest.scenes.map((scene) =>
          scene.mapImage?.assetId === assetId ||
          (Object.values(scene.images) as SceneImage[][]).some((layer) =>
            layer.some((image) => image.assetId === assetId),
          )
            ? {
                ...scene,
                images: {
                  gm: scene.images.gm.filter(
                    (image) => image.assetId !== assetId,
                  ),
                  map: scene.images.map.filter(
                    (image) => image.assetId !== assetId,
                  ),
                  token: scene.images.token.filter(
                    (image) => image.assetId !== assetId,
                  ),
                },
                mapImage:
                  scene.mapImage?.assetId === assetId
                    ? null
                    : scene.mapImage,
                objectOrder: {
                  gm: scene.objectOrder.gm.filter((id) =>
                    !scene.images.gm.some((image) =>
                      image.id === id && image.assetId === assetId)),
                  map: scene.objectOrder.map.filter((id) =>
                    !scene.images.map.some((image) =>
                      image.id === id && image.assetId === assetId)),
                  token: scene.objectOrder.token.filter((id) =>
                    !scene.images.token.some((image) =>
                      image.id === id && image.assetId === assetId)),
                },
                revision: scene.revision + 1,
              }
            : scene,
        ),
      };
      publish();
      return { ok: true as const, value: null };
    }),
    findDependents: vi.fn(async ({ assetId }) => ({
      ok: true as const,
      value: manifest.scenes.filter(
        (scene) =>
          scene.mapImage?.assetId === assetId ||
          (Object.values(scene.images) as SceneImage[][]).some((layer) =>
            layer.some((image) => image.assetId === assetId),
          ),
      ),
    })),
    list: vi.fn(async () => ({ ok: true as const, value: manifest })),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    present: vi.fn(async ({ sceneId }) => {
      manifest = { ...manifest, activeSceneId: sceneId };
      publish();
      return { ok: true as const, value: manifest };
    }),
    previewCancel: vi.fn(async () => undefined),
    previewStart: vi.fn(async () => undefined),
    previewUpdate: vi.fn(async () => undefined),
    redo: vi.fn(async ({ sceneId }) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      return current
        ? { ok: true as const, value: current }
        : {
            error: { code: 'not_found' as const, message: 'Gone.' },
            ok: false as const,
          };
    }),
    setImages: vi.fn(
      async ({ expectedRevision, sceneId, state }) => {
        const current = manifest.scenes.find((scene) => scene.id === sceneId);
        if (!current) {
          return {
            error: { code: 'not_found' as const, message: 'Gone.' },
            ok: false as const,
          };
        }
        if (current.revision !== expectedRevision) {
          return {
            error: { code: 'conflict' as const, message: 'Stale.' },
            ok: false as const,
          };
        }
        const next = {
          ...current,
          ...state,
          revision: current.revision + 1,
        };
        manifest = {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        };
        publish();
        return { ok: true as const, value: next };
      },
    ),
    setFog: vi.fn(
      async ({ expectedRevision, mutation, sceneId }) => {
        const current = manifest.scenes.find((scene) => scene.id === sceneId);
        if (!current) {
          return {
            error: { code: 'not_found' as const, message: 'Gone.' },
            ok: false as const,
          };
        }
        if (current.revision !== expectedRevision) {
          return {
            error: { code: 'conflict' as const, message: 'Stale.' },
            ok: false as const,
          };
        }
        const fog = mutation.kind === 'append'
          ? {
              ...current.fog,
              operations: [...current.fog.operations, mutation.operation],
            }
          : mutation.kind === 'set-color'
            ? { ...current.fog, color: mutation.color }
            : {
                ...current.fog,
                base: mutation.kind === 'cover-all' ? 'covered' as const : 'clear' as const,
                operations: [],
              };
        const next: SceneRecord = {
          ...current,
          fog,
          revision: current.revision + 1,
        };
        manifest = {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        };
        publish();
        return { ok: true as const, value: next };
      },
    ),
    setObjects: vi.fn(
      async ({ expectedRevision, sceneId, state }) => {
        const current = manifest.scenes.find((scene) => scene.id === sceneId);
        if (!current) {
          return {
            error: { code: 'not_found' as const, message: 'Gone.' },
            ok: false as const,
          };
        }
        if (current.revision !== expectedRevision) {
          return {
            error: { code: 'conflict' as const, message: 'Stale.' },
            ok: false as const,
          };
        }
        const next = {
          ...current,
          ...state,
          revision: current.revision + 1,
        };
        manifest = {
          ...manifest,
          scenes: manifest.scenes.map((scene) =>
            scene.id === sceneId ? next : scene,
          ),
        };
        publish();
        return { ok: true as const, value: next };
      },
    ),
    trash: vi.fn(async ({ sceneId }) => {
      manifest = {
        ...manifest,
        activeSceneId:
          manifest.activeSceneId === sceneId ? null : manifest.activeSceneId,
        scenes: manifest.scenes.filter((scene) => scene.id !== sceneId),
      };
      publish();
      return { ok: true as const, value: null };
    }),
    update: vi.fn(async ({ expectedRevision, patch, sceneId }) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      if (!current) {
        return {
          error: { code: 'not_found' as const, message: 'Gone.' },
          ok: false as const,
        };
      }
      if (current.revision !== expectedRevision) {
        return {
          error: { code: 'conflict' as const, message: 'Stale.' },
          ok: false as const,
        };
      }
      const next: SceneRecord = {
        ...current,
        ...patch,
        grid: { ...current.grid, ...patch.grid },
        revision: current.revision + 1,
      };
      manifest = {
        ...manifest,
        scenes: manifest.scenes.map((scene) =>
          scene.id === sceneId ? next : scene,
        ),
      };
      publish();
      return { ok: true as const, value: next };
    }),
    undo: vi.fn(async ({ sceneId }) => {
      const current = manifest.scenes.find((scene) => scene.id === sceneId);
      return current
        ? { ok: true as const, value: current }
        : {
            error: { code: 'not_found' as const, message: 'Gone.' },
            ok: false as const,
          };
    }),
  };

  return api;
}

export function createFakeAssetApi(assets: AssetView[] = []): AssetApi {
  return {
    getPreview: vi.fn(async ({ assetId }) => ({
      ok: true as const,
      value: {
        assetId,
        displayName: 'preview',
        format: 'png' as const,
        kind: 'image' as const,
        mimeType: 'image/png',
        token: '44444444-4444-4444-8444-444444444444',
        url: `blackbox-asset://token/${assetId}`,
      },
    })),
    list: vi.fn(async () => ({ ok: true as const, value: assets })),
    onChanged: () => () => undefined,
    onError: () => () => undefined,
    onProgress: () => () => undefined,
    pickAndImport: vi.fn(async () => ({ ok: true as const, value: assets })),
    prepareRemote: vi.fn(async () => ({ ok: true as const, value: assets })),
    releasePreview: vi.fn(async () => undefined),
    rename: vi.fn(async () => ({ ok: true as const, value: assets[0] })),
    trash: vi.fn(async () => ({ ok: true as const, value: null })),
  };
}
