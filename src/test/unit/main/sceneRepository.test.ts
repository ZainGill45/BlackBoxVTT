import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GRID_OPACITY,
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_NAME,
  DEFAULT_SCENE_WIDTH,
  MAX_SCENE_IMAGES,
  MAX_SCENE_FOG_POINTS,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
  sceneObjectStateOf,
  projectSceneForPlayer,
  type SceneDrawing,
  type SceneShape,
  type SceneText,
} from '../../../shared/scenes';
import { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

let directory = '';
let database: CampaignDatabase;

function createRepository(touchCampaign?: () => Promise<void>) {
  let counter = 0;
  return new SceneRepository({
    database,
    createId: () =>
      `0000000${(counter += 1)}-1111-4111-8111-111111111111`.slice(-36),
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    touchCampaign,
    warn: () => undefined,
  });
}

async function readSceneFile() {
  return createRepository().readManifest();
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

function text(
  id: string,
  ownerId: string | null = null,
): SceneText {
  return {
    content: 'Gatehouse',
    id,
    ownerId,
    revision: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    style: {
      fontFamily: 'lora',
      fontSize: 40,
      fontWeight: 700,
      primaryColor: '#abcdef',
      strokeColor: '#123456',
      strokeWidth: 3,
    },
    x: 100,
    y: 100,
  };
}

function shape(
  id: string,
  ownerId: string | null = null,
): SceneShape {
  return {
    height: 100,
    id,
    kind: 'cone',
    ownerId,
    revision: 0,
    rotation: 0,
    spread: 53.13,
    style: {
      backgroundColor: '#ffffff',
      backgroundOpacity: 0.25,
      backgroundType: 'crosshatched',
      fontColor: '#ffffff',
      fontFamily: 'inter',
      fontSize: 24,
      fontStrokeColor: '#000000',
      fontStrokeWidth: 2,
      fontWeight: 400,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeType: 'solid',
      strokeWidth: 2,
    },
    width: 200,
    x: 100,
    y: 100,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-scenes-'));
  const timestamp = '2026-07-31T12:00:00.000Z';
  database = CampaignDatabase.create(directory, {
    createdAt: timestamp,
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Iron Meridian',
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: timestamp,
  });
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('SceneRepository', () => {
  it('starts empty and creates scenes with the documented defaults', async () => {
    const repository = createRepository();

    expect(await repository.readManifest()).toEqual({
      activeSceneId: null,
      revision: 0,
      scenes: [],
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
      objectOrder: {
        gm: [],
        map: [],
        token: [],
      },
      shapes: createEmptyShapeLayers(),
      texts: createEmptyTextLayers(),
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

  it('keeps scene commit idempotency across repository restarts', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const state = sceneObjectStateOf(created.value);
    state.drawings.token.push(
      drawing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const committed = await repository.setObjects(
      created.value.id,
      state,
      0,
      operationId,
      { kind: 'gm' },
    );
    expect(committed).toMatchObject({ ok: true, value: { revision: 1 } });
    const manifestRevision = (await repository.readManifest()).revision;

    const reopened = createRepository();
    const retried = await reopened.setObjects(
      created.value.id,
      state,
      0,
      operationId,
      { kind: 'gm' },
    );

    expect(retried).toMatchObject({ ok: true, value: { revision: 1 } });
    expect((await reopened.readManifest()).revision).toBe(manifestRevision);
  });

  it('persists idempotent fog operations and includes them in GM history', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const operationId = 'abababab-abab-4bab-8bab-abababababab';
    const operation = {
      hardness: 0.5,
      id: operationId,
      kind: 'brush' as const,
      mode: 'hide' as const,
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      width: 70,
    };

    const saved = await repository.setFog(
      created.value.id,
      { kind: 'append', operation },
      created.value.revision,
      operationId,
    );
    expect(saved).toMatchObject({
      ok: true,
      value: { fog: { operations: [operation] }, revision: 1 },
    });

    const retried = await createRepository().setFog(
      created.value.id,
      { kind: 'append', operation },
      created.value.revision,
      operationId,
    );
    expect(retried).toMatchObject({
      ok: true,
      value: { fog: { operations: [operation] }, revision: 1 },
    });

    const undone = await repository.undo(created.value.id, { kind: 'gm' });
    expect(undone).toMatchObject({
      ok: true,
      value: { fog: { base: 'clear', operations: [] }, revision: 2 },
    });
    const redone = await repository.redo(created.value.id, { kind: 'gm' });
    expect(redone).toMatchObject({
      ok: true,
      value: { fog: { operations: [operation] }, revision: 3 },
    });
    if (!redone.ok) {
      throw new Error('redo failed');
    }

    const covered = await repository.setFog(
      created.value.id,
      { kind: 'cover-all' },
      redone.value.revision,
      'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
    );
    expect(covered).toMatchObject({
      ok: true,
      value: { fog: { base: 'covered', operations: [] } },
    });
    if (!covered.ok) {
      throw new Error('cover failed');
    }
    const recolored = await repository.setFog(
      created.value.id,
      { color: '#AbCdEf', kind: 'set-color' },
      covered.value.revision,
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    );
    expect(recolored).toMatchObject({
      ok: true,
      value: { fog: { color: '#abcdef' } },
    });
    if (!recolored.ok) {
      throw new Error('color failed');
    }
    expect(await repository.setFog(
      created.value.id,
      { kind: 'clear-all' },
      recolored.value.revision,
      'dededede-dede-4ede-8ede-dededededede',
    )).toMatchObject({
      ok: true,
      value: { fog: { base: 'clear', color: '#abcdef', operations: [] } },
    });
  });

  it('compacts saturated fog paths so later brush strokes still commit', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const operationIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const saturated = {
      ...created.value,
      fog: {
        ...created.value.fog,
        base: 'covered' as const,
        operations: operationIds.map((id, operationIndex) => ({
          hardness: 1,
          id,
          kind: 'brush' as const,
          mode: operationIndex % 2 === 0 ? 'hide' as const : 'reveal' as const,
          points: Array.from({
            length: MAX_SCENE_FOG_POINTS / operationIds.length,
          }, (_value, pointIndex) => ({
            x: pointIndex * 0.4,
            y: 100 + (pointIndex % 2),
          })),
          width: 1,
        })),
      },
    };
    database.connection
      .prepare('UPDATE scenes SET record_json = ? WHERE id = ?')
      .run(JSON.stringify(saturated), saturated.id);
    const operationId = '66666666-6666-4666-8666-666666666666';
    const operation = {
      hardness: 1,
      id: operationId,
      kind: 'brush' as const,
      mode: 'reveal' as const,
      points: [{ x: 100, y: 100 }, { x: 500, y: 100 }],
      width: 70,
    };

    const saved = await repository.setFog(
      saturated.id,
      { kind: 'append', operation },
      saturated.revision,
      operationId,
    );

    expect(saved).toMatchObject({ ok: true, value: { revision: 1 } });
    if (!saved.ok) {
      throw new Error('fog commit failed');
    }
    const pointCount = saved.value.fog.operations.reduce(
      (total, entry) =>
        total + (entry.kind === 'brush' ? entry.points.length : 0),
      0,
    );
    expect(pointCount).toBeLessThanOrEqual(MAX_SCENE_FOG_POINTS);
    expect(saved.value.fog.operations.at(-1)).toMatchObject(operation);
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
      objectOrder: {
        gm: [],
        map: [],
        token: ['44444444-4444-4444-8444-444444444444'],
      },
      shapes: createEmptyShapeLayers(),
      texts: createEmptyTextLayers(),
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
          objectOrder: {
            gm: [],
            map: [],
            token: token.map((image) => image.id),
          },
          shapes: createEmptyShapeLayers(),
          texts: createEmptyTextLayers(),
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
    const requested = sceneObjectStateOf(created.value);
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
    const invalidLockedState = sceneObjectStateOf(saved.value);
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

    const withoutDrawing = sceneObjectStateOf(saved.value);
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
    const state = sceneObjectStateOf(created.value);
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

  it('stamps player text ownership, enforces layers and revisions, locks transforms, and preserves style', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const playerId = '22222222-2222-4222-8222-222222222222';
    const otherPlayerId = '33333333-3333-4333-8333-333333333333';
    const textId = '44444444-4444-4444-8444-444444444444';
    const requested = sceneObjectStateOf(created.value);
    requested.texts.map.push(text(textId, otherPlayerId));
    expect(
      await repository.setObjects(
        created.value.id,
        requested,
        0,
        '55555555-5555-4555-8555-555555555555',
        { kind: 'player', userId: playerId },
      ),
    ).toMatchObject({ error: { code: 'permission_denied' }, ok: false });

    requested.texts.token.push(requested.texts.map.pop()!);
    const saved = await repository.setObjects(
      created.value.id,
      requested,
      0,
      '66666666-6666-4666-8666-666666666666',
      { kind: 'player', userId: playerId },
    );
    expect(saved).toMatchObject({
      ok: true,
      value: {
        texts: { token: [{ id: textId, ownerId: playerId, revision: 0 }] },
      },
    });
    if (!saved.ok) {
      return;
    }

    const editedState = sceneObjectStateOf(saved.value);
    editedState.texts.token[0].content = 'Edited gatehouse';
    editedState.texts.token[0].style = {
      ...editedState.texts.token[0].style,
      fontFamily: 'cinzel',
      primaryColor: '#000000',
    };
    const edited = await repository.setObjects(
      created.value.id,
      editedState,
      saved.value.revision,
      '77777777-7777-4777-8777-777777777777',
      { kind: 'player', userId: playerId },
    );
    expect(edited).toMatchObject({
      ok: true,
      value: {
        texts: {
          token: [
            {
              content: 'Edited gatehouse',
              revision: 1,
              style: { fontFamily: 'lora', primaryColor: '#abcdef' },
            },
          ],
        },
      },
    });
    if (!edited.ok) {
      return;
    }

    const stale = sceneObjectStateOf(saved.value);
    stale.texts.token[0].content = 'Stale edit';
    expect(
      await repository.setObjects(
        created.value.id,
        stale,
        saved.value.revision,
        '88888888-8888-4888-8888-888888888888',
        { kind: 'player', userId: playerId },
      ),
    ).toMatchObject({ error: { code: 'conflict' }, ok: false });

    expect(
      await repository.beginTransform(
        created.value.id,
        '99999999-9999-4999-8999-999999999999',
        [textId],
        { kind: 'player', userId: otherPlayerId },
      ),
    ).toMatchObject({ error: { code: 'permission_denied' }, ok: false });
    expect(
      await repository.beginTransform(
        created.value.id,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        [textId],
        { kind: 'player', userId: playerId },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await repository.beginTransform(
        created.value.id,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        [textId],
        { kind: 'gm' },
      ),
    ).toMatchObject({ error: { code: 'conflict' }, ok: false });
    repository.cancelTransform('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      kind: 'player',
      userId: playerId,
    });
  });

  it('preserves token text ordering when a player edits an owned object', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const playerId = '22222222-2222-4222-8222-222222222222';
    const firstId = '11111111-1111-4111-8111-111111111111';
    const playerTextId = '22222222-2222-4222-8222-333333333333';
    const lastId = '33333333-3333-4333-8333-333333333333';
    const gmState = sceneObjectStateOf(created.value);
    gmState.texts.token.push(text(firstId), text(lastId));
    const gmSaved = await repository.setObjects(
      created.value.id,
      gmState,
      created.value.revision,
      '44444444-4444-4444-8444-444444444444',
      { kind: 'gm' },
    );
    if (!gmSaved.ok) {
      throw new Error('setup failed');
    }
    const playerState = sceneObjectStateOf(gmSaved.value);
    playerState.texts.token.push(text(playerTextId));
    const playerSaved = await repository.setObjects(
      created.value.id,
      playerState,
      gmSaved.value.revision,
      '55555555-5555-4555-8555-555555555555',
      { kind: 'player', userId: playerId },
    );
    if (!playerSaved.ok) {
      throw new Error('setup failed');
    }
    const reordered = sceneObjectStateOf(playerSaved.value);
    reordered.texts.token = [
      reordered.texts.token[0],
      reordered.texts.token[2],
      reordered.texts.token[1],
    ];
    const gmReordered = await repository.setObjects(
      created.value.id,
      reordered,
      playerSaved.value.revision,
      '66666666-6666-4666-8666-666666666666',
      { kind: 'gm' },
    );
    if (!gmReordered.ok) {
      throw new Error('setup failed');
    }
    const edited = sceneObjectStateOf(gmReordered.value);
    edited.texts.token[1].content = 'Edited in place';
    const saved = await repository.setObjects(
      created.value.id,
      edited,
      gmReordered.value.revision,
      '77777777-7777-4777-8777-777777777777',
      { kind: 'player', userId: playerId },
    );

    expect(saved).toMatchObject({
      ok: true,
      value: {
        texts: {
          token: [
            { id: firstId },
            { content: 'Edited in place', id: playerTextId },
            { id: lastId },
          ],
        },
      },
    });
  });

  it('tracks text in GM moderation history and player projections', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const gmTextId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tokenTextId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const state = sceneObjectStateOf(created.value);
    state.texts.gm.push(text(gmTextId));
    state.texts.token.push(text(tokenTextId));
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
    expect(projectSceneForPlayer(saved.value).texts).toMatchObject({
      gm: [],
      token: [{ id: tokenTextId }],
    });

    const deletedState = sceneObjectStateOf(saved.value);
    deletedState.texts.token = [];
    const deleted = await repository.setObjects(
      created.value.id,
      deletedState,
      saved.value.revision,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      { kind: 'gm' },
    );
    expect(deleted).toMatchObject({ ok: true, value: { texts: { token: [] } } });
    const restored = await repository.undo(created.value.id, { kind: 'gm' });
    expect(restored).toMatchObject({
      ok: true,
      value: { texts: { token: [{ id: tokenTextId, revision: 1 }] } },
    });
    const redone = await repository.redo(created.value.id, { kind: 'gm' });
    expect(redone).toMatchObject({ ok: true, value: { texts: { token: [] } } });
  });

  it('derives shape ownership, freezes committed style, locks edits, and records history', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const playerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const shapeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const state = sceneObjectStateOf(projectSceneForPlayer(created.value));
    state.shapes.token.push(shape(shapeId, otherId));
    const saved = await repository.setObjects(
      created.value.id,
      state,
      0,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      { kind: 'player', userId: playerId },
    );
    expect(saved).toMatchObject({
      ok: true,
      value: { shapes: { token: [{ id: shapeId, ownerId: playerId }] } },
    });
    if (!saved.ok) {
      throw new Error('setup failed');
    }

    const forged = sceneObjectStateOf(projectSceneForPlayer(saved.value));
    const sphereFields = structuredClone(forged.shapes.token[0]) as
      SceneShape & { spread?: number };
    delete sphereFields.spread;
    forged.shapes.token[0] = {
      ...sphereFields,
      kind: 'sphere',
    };
    expect(await repository.setObjects(
      created.value.id,
      forged,
      saved.value.revision,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      { kind: 'player', userId: playerId },
    )).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });

    expect(await repository.beginTransform(
      created.value.id,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      [shapeId],
      { kind: 'player', userId: otherId },
    )).toMatchObject({ error: { code: 'permission_denied' }, ok: false });
    expect(await repository.beginTransform(
      created.value.id,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      [shapeId],
      { kind: 'player', userId: playerId },
    )).toMatchObject({ ok: true });

    const edited = sceneObjectStateOf(projectSceneForPlayer(saved.value));
    edited.shapes.token[0].x = 175;
    edited.shapes.token[0].style.backgroundColor = '#ff0000';
    const changed = await repository.setObjects(
      created.value.id,
      edited,
      saved.value.revision,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      { kind: 'player', userId: playerId },
    );
    expect(changed).toMatchObject({
      ok: true,
      value: {
        shapes: {
          token: [{
            revision: 1,
            style: { backgroundColor: '#ffffff' },
            x: 175,
          }],
        },
      },
    });
    const undone = await repository.undo(created.value.id, {
      kind: 'player',
      userId: playerId,
    });
    expect(undone).toMatchObject({
      ok: true,
      value: { shapes: { token: [{ x: 100 }] } },
    });
  });

  it('authoritatively reorders mixed objects and histories shape layer transfers', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) throw new Error('setup failed');
    const imageId = '11111111-1111-4111-8111-111111111111';
    const drawingId = '22222222-2222-4222-8222-222222222222';
    const shapeId = '33333333-3333-4333-8333-333333333333';
    const textId = '44444444-4444-4444-8444-444444444444';
    const playerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const initial = sceneObjectStateOf(created.value);
    initial.images.token.push({
      assetId: '55555555-5555-4555-8555-555555555555',
      height: 100,
      id: imageId,
      rotation: 0,
      width: 100,
      x: 100,
      y: 100,
    });
    initial.drawings.token.push(drawing(drawingId));
    initial.shapes.token.push(shape(shapeId, playerId));
    initial.texts.token.push(text(textId));
    initial.objectOrder.token.push(imageId, drawingId, shapeId, textId);
    const saved = await repository.setObjects(
      created.value.id,
      initial,
      created.value.revision,
      '66666666-6666-4666-8666-666666666666',
      { kind: 'gm' },
    );
    if (!saved.ok) throw new Error('setup failed');
    expect(saved.value.objectOrder.token).toEqual([
      shapeId,
      imageId,
      drawingId,
      textId,
    ]);

    const forged = sceneObjectStateOf(saved.value);
    forged.shapes.token[0].x += 1;
    expect(await repository.setObjects(
      created.value.id,
      forged,
      saved.value.revision,
      '67676767-6767-4767-8767-676767676767',
      { kind: 'gm' },
      { direction: 'front', kind: 'reorder', targets: [shapeId] },
    )).toMatchObject({ error: { code: 'invalid_input' }, ok: false });

    const lockOperationId = '68686868-6868-4868-8868-686868686868';
    expect(await repository.beginTransform(
      created.value.id,
      lockOperationId,
      [shapeId],
      { kind: 'gm' },
    )).toMatchObject({ ok: true });
    expect(await repository.setObjects(
      created.value.id,
      sceneObjectStateOf(saved.value),
      saved.value.revision,
      '69696969-6969-4969-8969-696969696969',
      { kind: 'gm' },
      { direction: 'front', kind: 'reorder', targets: [shapeId] },
    )).toMatchObject({ error: { code: 'conflict' }, ok: false });
    repository.cancelTransform(lockOperationId, { kind: 'gm' });

    const reordered = await repository.setObjects(
      created.value.id,
      sceneObjectStateOf(saved.value),
      saved.value.revision,
      '77777777-7777-4777-8777-777777777777',
      { kind: 'gm' },
      { direction: 'front', kind: 'reorder', targets: [drawingId, shapeId] },
    );
    expect(reordered).toMatchObject({
      ok: true,
      value: {
        objectOrder: { token: [imageId, textId, shapeId, drawingId] },
        shapes: { token: [{ id: shapeId, revision: 1 }] },
      },
    });
    if (!reordered.ok) throw new Error('reorder failed');
    expect(await repository.setObjects(
      created.value.id,
      sceneObjectStateOf(saved.value),
      saved.value.revision,
      '77777777-7777-4777-8777-777777777777',
      { kind: 'gm' },
      { direction: 'front', kind: 'reorder', targets: [drawingId, shapeId] },
    )).toMatchObject({
      ok: true,
      value: { revision: reordered.value.revision },
    });

    const undoneOrder = await repository.undo(created.value.id, { kind: 'gm' });
    expect(undoneOrder).toMatchObject({
      ok: true,
      value: { objectOrder: { token: [shapeId, imageId, drawingId, textId] } },
    });
    const redoneOrder = await repository.redo(created.value.id, { kind: 'gm' });
    expect(redoneOrder).toMatchObject({
      ok: true,
      value: { objectOrder: { token: [imageId, textId, shapeId, drawingId] } },
    });
    if (!redoneOrder.ok) throw new Error('redo failed');

    const movedState = sceneObjectStateOf(redoneOrder.value);
    const movedShape = movedState.shapes.token.shift()!;
    movedState.shapes.gm.push(movedShape);
    movedState.objectOrder.token = movedState.objectOrder.token.filter(
      (id) => id !== shapeId,
    );
    movedState.objectOrder.gm.push(shapeId);
    const moved = await repository.setObjects(
      created.value.id,
      movedState,
      redoneOrder.value.revision,
      '88888888-8888-4888-8888-888888888888',
      { kind: 'gm' },
      { kind: 'move-layer', targetLayer: 'gm', targets: [shapeId] },
    );
    expect(moved).toMatchObject({
      ok: true,
      value: {
        objectOrder: { gm: [shapeId], token: [imageId, textId, drawingId] },
        shapes: { gm: [{ id: shapeId, ownerId: null }] },
      },
    });
    if (!moved.ok) throw new Error('layer move failed');
    expect(projectSceneForPlayer(moved.value)).toMatchObject({
      objectOrder: { gm: [] },
      shapes: { gm: [] },
    });
    expect((await createRepository().readManifest()).scenes[0]).toMatchObject({
      objectOrder: { gm: [shapeId] },
      shapes: { gm: [{ id: shapeId, ownerId: null }] },
    });

    const undoneMove = await repository.undo(created.value.id, { kind: 'gm' });
    expect(undoneMove).toMatchObject({
      ok: true,
      value: {
        objectOrder: { token: [imageId, textId, shapeId, drawingId] },
        shapes: { token: [{ id: shapeId, ownerId: null }] },
      },
    });
  });

  it('lets players reorder only their own token objects and preserves off-token ownership', async () => {
    const repository = createRepository();
    const created = await repository.create();
    if (!created.ok) throw new Error('setup failed');
    const playerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const drawingId = '11111111-1111-4111-8111-111111111111';
    const shapeId = '22222222-2222-4222-8222-222222222222';
    const textId = '33333333-3333-4333-8333-333333333333';
    const initial = sceneObjectStateOf(projectSceneForPlayer(created.value));
    initial.drawings.token.push(drawing(drawingId, playerId));
    initial.shapes.token.push(shape(shapeId, playerId));
    initial.objectOrder.token.push(drawingId, shapeId);
    const owned = await repository.setObjects(
      created.value.id,
      initial,
      0,
      '44444444-4444-4444-8444-444444444444',
      { kind: 'player', userId: playerId },
    );
    if (!owned.ok) throw new Error('setup failed');
    const withTextState = sceneObjectStateOf(owned.value);
    withTextState.texts.token.push(text(textId, otherId));
    withTextState.objectOrder.token.push(textId);
    const saved = await repository.setObjects(
      created.value.id,
      withTextState,
      owned.value.revision,
      '45454545-4545-4545-8545-454545454545',
      { kind: 'gm' },
    );
    if (!saved.ok) throw new Error('setup failed');

    const reordered = await repository.setObjects(
      created.value.id,
      sceneObjectStateOf(projectSceneForPlayer(saved.value)),
      saved.value.revision,
      '55555555-5555-4555-8555-555555555555',
      { kind: 'player', userId: playerId },
      { direction: 'front', kind: 'reorder', targets: [shapeId] },
    );
    expect(reordered).toMatchObject({
      ok: true,
      value: {
        objectOrder: { token: [drawingId, textId, shapeId] },
        shapes: { token: [{ id: shapeId, revision: 1 }] },
      },
    });
    if (!reordered.ok) throw new Error('reorder failed');

    expect(await repository.setObjects(
      created.value.id,
      sceneObjectStateOf(projectSceneForPlayer(reordered.value)),
      reordered.value.revision,
      '66666666-6666-4666-8666-666666666666',
      { kind: 'player', userId: otherId },
      { direction: 'back', kind: 'reorder', targets: [shapeId] },
    )).toMatchObject({ error: { code: 'permission_denied' }, ok: false });

    const movedState = sceneObjectStateOf(reordered.value);
    movedState.shapes.token = [];
    movedState.shapes.map = [reordered.value.shapes.token[0]];
    movedState.objectOrder.token = movedState.objectOrder.token.filter(
      (id) => id !== shapeId,
    );
    movedState.objectOrder.map.push(shapeId);
    const moved = await repository.setObjects(
      created.value.id,
      movedState,
      reordered.value.revision,
      '77777777-7777-4777-8777-777777777777',
      { kind: 'gm' },
      { kind: 'move-layer', targetLayer: 'map', targets: [shapeId] },
    );
    if (!moved.ok) throw new Error('layer move failed');

    const laterPlayerState = sceneObjectStateOf(projectSceneForPlayer(moved.value));
    laterPlayerState.drawings.token[0].x = 175;
    const later = await repository.setObjects(
      created.value.id,
      laterPlayerState,
      moved.value.revision,
      '88888888-8888-4888-8888-888888888888',
      { kind: 'player', userId: playerId },
    );
    expect(later).toMatchObject({
      ok: true,
      value: {
        shapes: { map: [{ id: shapeId, ownerId: playerId }] },
      },
    });

    expect(await repository.setObjects(
      created.value.id,
      laterPlayerState,
      moved.value.revision,
      '99999999-9999-4999-8999-999999999999',
      { kind: 'player', userId: playerId },
      { kind: 'move-layer', targetLayer: 'token', targets: [shapeId] },
    )).toMatchObject({ error: { code: 'permission_denied' }, ok: false });
  });

  it('recovers from a malformed manifest instead of throwing', async () => {
    const repository = createRepository();
    database.connection
      .prepare(
        `INSERT INTO scenes (id, position, record_json)
         VALUES (?, 0, ?)`,
      )
      .run(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '{"invalid":true}',
      );

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
    database.connection
      .prepare(
        `UPDATE scene_manifest
         SET active_scene_id = ?
         WHERE singleton = 1`,
      )
      .run('44444444-4444-4444-8444-444444444444');

    expect((await repository.readManifest()).activeSceneId).toBeNull();
  });
});
