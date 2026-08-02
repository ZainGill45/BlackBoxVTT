import { describe, expect, it, vi } from 'vitest';
import { CampaignSceneService } from '../../../../main/campaignTable/sceneService';
import type { SceneRepository } from '../../../../main/sceneRepository';
import {
  createDefaultGrid,
  createDefaultFog,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptySceneManifest,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  sceneObjectStateOf,
  type SceneRecord,
} from '../../../../shared/scenes';

const sceneId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const gmImageId = '55555555-5555-4555-8555-555555555555';

function scene(): SceneRecord {
  return {
    createdAt: '2026-07-31T12:00:00.000Z',
    distance: 5,
    drawings: createEmptyDrawingLayers(),
    fog: createDefaultFog(),
    grid: createDefaultGrid(),
    height: 100,
    id: sceneId,
    images: {
      ...createEmptyImageLayers(),
      gm: [
        {
          assetId,
          height: 10,
          id: gmImageId,
          rotation: 0,
          width: 10,
          x: 0,
          y: 0,
        },
      ],
    },
    mapImage: null,
    name: 'Arena',
    objectOrder: { gm: [gmImageId], map: [], token: [] },
    pixelScale: 1,
    revision: 1,
    shapes: createEmptyShapeLayers(),
    unit: 'ft',
    texts: createEmptyTextLayers(),
    updatedAt: '2026-07-31T12:00:00.000Z',
    width: 100,
  };
}

function createHarness() {
  const activeScene = scene();
  const readManifest = vi.fn(async () => ({
    ...createEmptySceneManifest(),
    activeSceneId: sceneId,
    scenes: [activeScene],
  }));
  const setObjects = vi.fn(async () => ({
    ok: true as const,
    value: activeScene,
  }));
  const undo = vi.fn(async () => ({
    ok: true as const,
    value: activeScene,
  }));
  const redo = vi.fn(async () => ({
    ok: true as const,
    value: activeScene,
  }));
  const beginTransform = vi.fn(async () => ({
    ok: true as const,
    value: null,
  }));
  const refreshTransform = vi.fn();
  const cancelTransform = vi.fn();
  const service = new CampaignSceneService({
    beginTransform,
    cancelTransform,
    readManifest,
    redo,
    refreshTransform,
    setObjects,
    undo,
  } as unknown as SceneRepository);
  return {
    activeScene,
    beginTransform,
    cancelTransform,
    redo,
    refreshTransform,
    service,
    setObjects,
    undo,
  };
}

describe('CampaignSceneService', () => {
  it('projects the active scene before it crosses the player boundary', async () => {
    const { service } = createHarness();

    const result = await service.readActiveScene();

    expect(result?.id).toBe(sceneId);
    expect(result?.images.gm).toEqual([]);
  });

  it('applies player identity to commits and projects mutation results', async () => {
    const { activeScene, service, setObjects } = createHarness();
    const state = sceneObjectStateOf(activeScene);

    const result = await service.setPlayerObjects(
      sceneId,
      state,
      1,
      operationId,
      userId,
    );

    expect(setObjects).toHaveBeenCalledWith(
      sceneId,
      state,
      1,
      operationId,
      { kind: 'player', userId },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { images: { gm: [] } },
    });
  });

  it('routes history and transform leases through the same player actor', async () => {
    const {
      beginTransform,
      cancelTransform,
      redo,
      refreshTransform,
      service,
    } = createHarness();

    await service.applyPlayerHistory('redo', sceneId, userId);
    await service.beginPlayerTransform(
      sceneId,
      operationId,
      ['drawing-id'],
      userId,
    );
    service.refreshTransform(operationId, userId);
    service.cancelTransform(operationId, userId);

    expect(redo).toHaveBeenCalledWith(sceneId, {
      kind: 'player',
      userId,
    });
    expect(beginTransform).toHaveBeenCalledWith(
      sceneId,
      operationId,
      ['drawing-id'],
      { kind: 'player', userId },
    );
    expect(refreshTransform).toHaveBeenCalledWith(operationId, {
      kind: 'player',
      userId,
    });
    expect(cancelTransform).toHaveBeenCalledWith(operationId, {
      kind: 'player',
      userId,
    });
  });
});
