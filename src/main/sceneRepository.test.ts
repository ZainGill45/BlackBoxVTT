import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRID_OPACITY,
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_NAME,
  DEFAULT_SCENE_WIDTH,
  MAX_SCENE_IMAGES,
  SCENE_MANIFEST_SCHEMA_VERSION,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  imageStateOf,
  projectSceneForPlayer,
  type SceneDrawing,
} from '../shared/scenes';
import { SceneRepository } from './sceneRepository';

let directory = '';

function createRepository(touchCampaign?: () => Promise<void>) {
  let counter = 0;
  return new SceneRepository({
    campaignDirectory: directory,
    createId: () =>
      `0000000${(counter += 1)}-1111-4111-8111-111111111111`.slice(-36),
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    touchCampaign,
    warn: () => undefined,
  });
}

async function readSceneFile() {
  return JSON.parse(
    await readFile(path.join(directory, 'scenes.json'), 'utf8'),
  ) as { activeSceneId: string | null; revision: number; scenes: unknown[] };
}

function drawing(
  id: string,
  ownerId: string | null = null,
): SceneDrawing {
  return {
    closed: false,
    id,
    kind: 'freeform',
    ownerId,
    points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
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
    x: 100,
    y: 100,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-scenes-'));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe('SceneRepository', () => {
  it('starts empty and creates scenes with the documented defaults', async () => {
    const repository = createRepository();

    expect(await repository.readManifest()).toEqual({
      activeSceneId: null,
      revision: 0,
      scenes: [],
      schemaVersion: SCENE_MANIFEST_SCHEMA_VERSION,
    });

    const created = await repository.create();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value).toMatchObject({
      grid: { opacity: DEFAULT_GRID_OPACITY, type: 'square' },
      height: DEFAULT_SCENE_HEIGHT,
      mapImage: null,
      name: DEFAULT_SCENE_NAME,
      revision: 0,
      width: DEFAULT_SCENE_WIDTH,
    });

    const stored = await readSceneFile();
    expect(stored.scenes).toHaveLength(1);
    expect(stored.revision).toBe(1);
  });

  it('touches the campaign on every write', async () => {
    const touchCampaign = vi.fn(async () => undefined);
    const repository = createRepository(touchCampaign);

    await repository.create();

    expect(touchCampaign).toHaveBeenCalledTimes(1);
  });

  it('merges partial grid patches and rejects stale revisions', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }

    const updated = await repository.update(
      created.value.id,
      { grid: { size: 100, type: 'square' }, name: '  Iron Keep  ' },
      0,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.value.grid).toEqual({
      ...created.value.grid,
      size: 100,
      type: 'square',
    });
    expect(updated.value.name).toBe('Iron Keep');
    expect(updated.value.revision).toBe(1);

    const stale = await repository.update(created.value.id, { width: 50 }, 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('conflict');
    }
  });

  it('rejects a name that normalizes to nothing', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }

    const result = await repository.update(created.value.id, { name: '   ' }, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_input');
    }
  });

  it('clears the presented scene when that scene is trashed', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }

    await repository.present(created.value.id);
    expect((await repository.readManifest()).activeSceneId).toBe(
      created.value.id,
    );

    await repository.trash(created.value.id, 0);

    const manifest = await repository.readManifest();
    expect(manifest.activeSceneId).toBeNull();
    expect(manifest.scenes).toEqual([]);
  });

  it('refuses to present a scene that does not exist', async () => {
    const repository = createRepository();

    const result = await repository.present(
      '99999999-9999-4999-8999-999999999999',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
    }
  });

  it('finds and detaches every scene that uses an asset', async () => {
    const repository = createRepository();
    const first = await repository.create();
    const second = await repository.create();
    const third = await repository.create();
    if (!first.ok || !second.ok || !third.ok) {
      throw new Error('setup failed');
    }
    const assetId = '33333333-3333-4333-8333-333333333333';
    const mapImage = {
      assetId,
      height: 600,
      rotation: 0,
      width: 800,
      x: 0,
      y: 0,
    };
    await repository.update(first.value.id, { mapImage }, 0);
    await repository.update(third.value.id, { mapImage }, 0);

    const dependents = await repository.findDependents(assetId);
    expect(dependents.ok).toBe(true);
    if (dependents.ok) {
      expect(dependents.value.map((scene) => scene.id)).toEqual([
        first.value.id,
        third.value.id,
      ]);
    }

    await repository.detachAsset(assetId);

    const manifest = await repository.readManifest();
    expect(manifest.scenes.every((scene) => scene.mapImage === null)).toBe(true);
    expect(manifest.scenes[0].revision).toBe(2);
    expect(manifest.scenes[1].revision).toBe(0);
  });

  it('migrates top-left map transforms to center transforms without moving them', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const stored = JSON.parse(
      await readFile(path.join(directory, 'scenes.json'), 'utf8'),
    );
    stored.schemaVersion = 1;
    delete stored.scenes[0].images;
    stored.scenes[0].mapImage = {
      assetId: '33333333-3333-4333-8333-333333333333',
      height: 50,
      rotation: 90,
      width: 100,
      x: 10,
      y: 20,
    };
    await writeFile(
      path.join(directory, 'scenes.json'),
      JSON.stringify(stored),
      'utf8',
    );

    const migrated = await repository.readManifest();

    expect(migrated.schemaVersion).toBe(SCENE_MANIFEST_SCHEMA_VERSION);
    expect(migrated.scenes[0].images).toEqual(createEmptyImageLayers());
    expect(migrated.scenes[0].mapImage).toMatchObject({ x: -15, y: 70 });
  });

  it('migrates version-two scenes with empty drawing layers', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const stored = JSON.parse(
      await readFile(path.join(directory, 'scenes.json'), 'utf8'),
    );
    stored.schemaVersion = 2;
    delete stored.scenes[0].drawings;
    await writeFile(
      path.join(directory, 'scenes.json'),
      JSON.stringify(stored),
      'utf8',
    );

    const migrated = await repository.readManifest();

    expect(migrated.schemaVersion).toBe(SCENE_MANIFEST_SCHEMA_VERSION);
    expect(migrated.scenes[0].drawings).toEqual(createEmptyDrawingLayers());
  });

  it('adds default hardness to version-three drawings without changing width', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const stored = JSON.parse(
      await readFile(path.join(directory, 'scenes.json'), 'utf8'),
    );
    const legacy = drawing(
      '44444444-4444-4444-8444-444444444444',
      null,
    );
    legacy.style.edge = 'soft';
    const legacyStyle = legacy.style as Partial<typeof legacy.style>;
    delete legacyStyle.hardness;
    stored.schemaVersion = 3;
    stored.scenes[0].drawings.token = [legacy];
    await writeFile(
      path.join(directory, 'scenes.json'),
      JSON.stringify(stored),
      'utf8',
    );

    const migrated = await repository.readManifest();

    expect(migrated.schemaVersion).toBe(SCENE_MANIFEST_SCHEMA_VERSION);
    expect(migrated.scenes[0].drawings.token[0].style).toMatchObject({
      edge: 'soft',
      hardness: 1,
      strokeWidth: 12,
    });
  });

  it('normalizes image state atomically and rejects stale or duplicate state', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const state = {
      drawings: createEmptyDrawingLayers(),
      images: {
        ...createEmptyImageLayers(),
        token: [
          {
            assetId: '33333333-3333-4333-8333-333333333333',
            height: 0.2,
            id: '44444444-4444-4444-8444-444444444444',
            rotation: -15,
            width: 0.1,
            x: 1.23456,
            y: -2.34567,
          },
        ],
      },
      mapImage: null,
    };

    const saved = await repository.setImages(created.value.id, state, 0);

    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.value.images.token[0]).toMatchObject({
      height: 1,
      rotation: 345,
      width: 1,
      x: 1.2346,
      y: -2.3457,
    });
    expect(
      await repository.setImages(created.value.id, state, 0),
    ).toMatchObject({ error: { code: 'conflict' }, ok: false });

    const duplicate = structuredClone(state);
    duplicate.images.map.push({ ...duplicate.images.token[0] });
    expect(
      await repository.setImages(created.value.id, duplicate, 1),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
  });

  it('rejects more than the additional-image safety limit', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const token = Array.from({ length: MAX_SCENE_IMAGES + 1 }, (_, index) => ({
      assetId: '33333333-3333-4333-8333-333333333333',
      height: 1,
      id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      rotation: 0,
      width: 1,
      x: 0,
      y: 0,
    }));

    expect(
      await repository.setImages(
        created.value.id,
        {
          drawings: createEmptyDrawingLayers(),
          images: { ...createEmptyImageLayers(), token },
          mapImage: null,
        },
        0,
      ),
    ).toMatchObject({ error: { code: 'invalid_input' }, ok: false });
  });

  it('derives player ownership, scopes history, restores moderation deletes, and enforces locks', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const playerId = '22222222-2222-4222-8222-222222222222';
    const otherPlayerId = '33333333-3333-4333-8333-333333333333';
    const drawingId = '44444444-4444-4444-8444-444444444444';
    const requested = imageStateOf(created.value);
    requested.drawings.token.push(drawing(drawingId, otherPlayerId));

    const saved = await repository.setObjects(
      created.value.id,
      requested,
      0,
      '55555555-5555-4555-8555-555555555555',
      { kind: 'player', userId: playerId },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.value.drawings.token[0].ownerId).toBe(playerId);

    const repeated = await repository.setObjects(
      created.value.id,
      requested,
      0,
      '55555555-5555-4555-8555-555555555555',
      { kind: 'player', userId: playerId },
    );
    expect(repeated).toEqual(saved);

    expect(
      await repository.beginTransform(
        created.value.id,
        '66666666-6666-4666-8666-666666666666',
        [drawingId],
        { kind: 'player', userId: otherPlayerId },
      ),
    ).toMatchObject({ error: { code: 'permission_denied' }, ok: false });

    expect(
      await repository.beginTransform(
        created.value.id,
        '77777777-7777-4777-8777-777777777777',
        [drawingId],
        { kind: 'player', userId: playerId },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await repository.beginTransform(
        created.value.id,
        '88888888-8888-4888-8888-888888888888',
        [drawingId],
        { kind: 'gm' },
      ),
    ).toMatchObject({ error: { code: 'conflict' }, ok: false });
    const invalidLockedState = imageStateOf(saved.value);
    invalidLockedState.drawings.gm.push(
      invalidLockedState.drawings.token.pop()!,
    );
    expect(
      await repository.setObjects(
        created.value.id,
        invalidLockedState,
        saved.value.revision,
        '77777777-7777-4777-8777-777777777777',
        { kind: 'player', userId: playerId },
      ),
    ).toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });
    expect(
      await repository.beginTransform(
        created.value.id,
        '88888888-8888-4888-8888-888888888888',
        [drawingId],
        { kind: 'gm' },
      ),
    ).toMatchObject({ ok: true });
    repository.cancelTransform(
      '88888888-8888-4888-8888-888888888888',
      { kind: 'gm' },
    );

    const withoutDrawing = imageStateOf(saved.value);
    withoutDrawing.drawings.token = [];
    const deleted = await repository.setObjects(
      created.value.id,
      withoutDrawing,
      saved.value.revision,
      '99999999-9999-4999-8999-999999999999',
      { kind: 'gm' },
    );
    expect(deleted).toMatchObject({
      ok: true,
      value: { drawings: { token: [] } },
    });
    if (!deleted.ok) {
      return;
    }

    const playerUndo = await repository.undo(created.value.id, {
      kind: 'player',
      userId: playerId,
    });
    expect(playerUndo).toMatchObject({
      ok: true,
      value: { revision: deleted.value.revision },
    });

    const gmUndo = await repository.undo(created.value.id, { kind: 'gm' });
    expect(gmUndo.ok).toBe(true);
    if (gmUndo.ok) {
      expect(gmUndo.value.drawings.token[0]).toMatchObject({
        id: drawingId,
        ownerId: playerId,
      });
    }
  });

  it('omits only the GM drawing layer from player projections', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const state = imageStateOf(created.value);
    state.drawings.gm.push(
      drawing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );
    state.drawings.token.push(
      drawing('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    );
    const saved = await repository.setObjects(
      created.value.id,
      state,
      0,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      { kind: 'gm' },
    );
    if (!saved.ok) {
      throw new Error('setup failed');
    }

    const projected = projectSceneForPlayer(saved.value);

    expect(projected.drawings.gm).toEqual([]);
    expect(projected.drawings.token).toHaveLength(1);
  });

  it('recovers from a malformed manifest instead of throwing', async () => {
    await writeFile(
      path.join(directory, 'scenes.json'),
      '{"schemaVersion": 99}',
      'utf8',
    );
    const repository = createRepository();

    expect((await repository.readManifest()).scenes).toEqual([]);

    const created = await repository.create();
    expect(created.ok).toBe(true);
  });

  it('drops an active scene id that no longer resolves', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const manifest = await repository.readManifest();
    await writeFile(
      path.join(directory, 'scenes.json'),
      JSON.stringify({
        ...manifest,
        activeSceneId: '44444444-4444-4444-8444-444444444444',
      }),
      'utf8',
    );

    expect((await repository.readManifest()).activeSceneId).toBeNull();
  });
});
