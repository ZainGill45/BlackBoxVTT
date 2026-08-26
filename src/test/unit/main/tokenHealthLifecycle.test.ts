import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRepository } from '../../../main/assetRepository';
import { JournalRepository } from '../../../main/journalRepository';
import { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { MutationQueue } from '../../../main/storage/mutationQueue';
import { TokenRepository } from '../../../main/tokenRepository';
import {
  DEFAULT_TOKEN_ASSET_ID,
  isSceneToken,
  sceneObjectStateOf,
  type SceneRecord,
  type SceneToken,
} from '../../../shared/scenes';
import {
  createDefaultDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const campaignId = '99999999-9999-4999-8999-999999999999';
const playerId = '88888888-8888-4888-8888-888888888888';
const player = { kind: 'player' as const, userId: playerId, username: 'Alice' };
let database: CampaignDatabase;
let directory = '';

function candidateToken(scene: SceneRecord, entryId: string, id: string): SceneToken {
  return {
    assetId: DEFAULT_TOKEN_ASSET_ID,
    height: scene.grid.size,
    id,
    rotation: 0,
    size: { height: 1, kind: 'default', width: 1 },
    source: { entryId, kind: 'linked' },
    width: scene.grid.size,
    x: 100,
    y: 100,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-health-'));
  database = CampaignDatabase.create(directory, {
    createdAt: '2026-08-23T00:00:00.000Z',
    id: campaignId,
    name: 'Health Test',
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: '2026-08-23T00:00:00.000Z',
  });
  database.connection.prepare(
    `INSERT INTO campaign_users (
       id, username, username_key, password_algorithm, password_block_size,
       password_cost, password_hash, password_key_length,
       password_parallelization, password_salt
     ) VALUES (?, 'Alice', 'alice', 'scrypt', 8, 2, 'hash', 32, 1, 'salt')`,
  ).run(playerId);
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('token health lifecycle', () => {
  it('rolls fresh Template instances and copies concrete health on duplication', async () => {
    const roll = vi.fn()
      .mockReturnValueOnce(21.115)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(44);
    const mutations = new MutationQueue();
    const tokens = new TokenRepository({ database, roll });
    const scenes = new SceneRepository({ database, mutations, tokens, warn: vi.fn() });
    const journal = new JournalRepository({
      assets: {
        readManifest: vi.fn(async () => ({ assets: [], revision: 0 })),
        trashAsset: vi.fn(),
      } as unknown as AssetRepository,
      database,
      mutations,
      scenes,
      tokens,
      touchCampaign: vi.fn(async () => undefined),
    });
    const created = await journal.createEntry(
      { kind: 'gm' },
      DND5E_CHARACTER_ENTRY_TYPE_ID,
    );
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup');
    const data = createDefaultDnd5eCharacterData();
    data.defaultToken.type = 'template';
    data.health.currentHitPoints = '8';
    data.health.maximumHitPoints = 'd10 + 10';
    const configured = await journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    });
    if (!configured.ok || configured.value.kind !== 'system') throw new Error('setup');
    const granted = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: configured.value.id,
      expectedPermissionRevision: configured.value.permissionRevision,
      permissions: { allPlayers: 'edit', overrides: [] },
    });
    if (!granted.ok) throw new Error('setup');
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('setup');

    const firstState = sceneObjectStateOf(createdScene.value);
    const firstId = '10000000-0000-4000-8000-000000000001';
    firstState.images.token.push(candidateToken(
      createdScene.value,
      configured.value.id,
      firstId,
    ));
    firstState.objectOrder.token.push(firstId);
    const first = await scenes.setObjects(
      createdScene.value.id,
      firstState,
      createdScene.value.revision,
      '20000000-0000-4000-8000-000000000001',
      player,
    );
    if (!first.ok) throw new Error('placement');
    const firstToken = first.value.images.token[0];
    if (!firstToken || !isSceneToken(firstToken) || firstToken.source.kind !== 'template') {
      throw new Error('snapshot');
    }
    expect(tokens.getTemplateSnapshot(player, firstToken.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '21.12', maximumHitPoints: '21.12' } },
    });

    const copiedState = sceneObjectStateOf(first.value);
    const copyId = '10000000-0000-4000-8000-000000000002';
    copiedState.images.token.push({ ...structuredClone(firstToken), id: copyId, x: 200 });
    copiedState.objectOrder.token.push(copyId);
    const copied = await scenes.setObjects(
      first.value.id,
      copiedState,
      first.value.revision,
      '20000000-0000-4000-8000-000000000002',
      player,
    );
    if (!copied.ok) throw new Error('copy');
    const copy = copied.value.images.token.find((token) => token.id === copyId);
    if (!copy || !isSceneToken(copy) || copy.source.kind !== 'template') throw new Error('copy');
    expect(tokens.getTemplateSnapshot(player, copy.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '21.12', maximumHitPoints: '21.12' } },
    });
    expect(roll).toHaveBeenCalledTimes(1);

    const secondState = sceneObjectStateOf(copied.value);
    const secondId = '10000000-0000-4000-8000-000000000003';
    secondState.images.token.push(candidateToken(
      copied.value,
      configured.value.id,
      secondId,
    ));
    secondState.objectOrder.token.push(secondId);
    const second = await scenes.setObjects(
      copied.value.id,
      secondState,
      copied.value.revision,
      '20000000-0000-4000-8000-000000000003',
      player,
    );
    if (!second.ok) throw new Error('second placement');
    const secondToken = second.value.images.token.find((token) => token.id === secondId);
    if (!secondToken || !isSceneToken(secondToken) || secondToken.source.kind !== 'template') {
      throw new Error('second snapshot');
    }
    expect(tokens.getTemplateSnapshot(player, secondToken.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '35', maximumHitPoints: '35' } },
    });
    expect(roll).toHaveBeenCalledTimes(2);

    expect(scenes.listTokenHealth(second.value.id)).toMatchObject({
      ok: true,
      value: expect.arrayContaining([{
        down: false,
        ratio: expect.any(Number),
        tokenId: firstId,
      }]),
    });

    const linkedData = structuredClone(configured.value.data as Dnd5eCharacterData);
    linkedData.defaultToken.type = 'linked';
    const linked = await journal.updateEntryData({ kind: 'gm' }, {
      data: linkedData,
      entryId: configured.value.id,
      expectedRevision: configured.value.revision,
    });
    expect(linked).toMatchObject({
      ok: true,
      value: {
        data: {
          defaultToken: { type: 'linked' },
          health: { currentHitPoints: '44', maximumHitPoints: '44' },
        },
      },
    });
    expect(roll).toHaveBeenCalledTimes(3);
    expect(
      second.value.images.token.every(
        (token) => isSceneToken(token) && token.source.kind === 'template',
      ),
    ).toBe(true);
    const convertedScene = (await scenes.readManifest()).scenes.find(
      (scene) => scene.id === second.value.id,
    );
    expect(
      convertedScene
        ? convertedScene.images.token.every(
            (token) => isSceneToken(token) && token.source.kind === 'linked',
          )
        : false,
    ).toBe(true);
    const sharedHealth = scenes.listTokenHealth(second.value.id);
    expect(sharedHealth.ok ? sharedHealth.value : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          down: false,
          ratio: 1,
        }),
      ]),
    );
  });

  it('edits Linked health through the Token Inspector with stale-aware undo', async () => {
    const mutations = new MutationQueue();
    const tokens = new TokenRepository({ database });
    const scenes = new SceneRepository({ database, mutations, tokens, warn: vi.fn() });
    const journal = new JournalRepository({
      assets: {
        readManifest: vi.fn(async () => ({ assets: [], revision: 0 })),
        trashAsset: vi.fn(),
      } as unknown as AssetRepository,
      database,
      mutations,
      scenes,
      tokens,
      touchCampaign: vi.fn(async () => undefined),
    });
    const created = await journal.createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup');
    const data = createDefaultDnd5eCharacterData();
    data.health.currentHitPoints = '10';
    data.health.maximumHitPoints = '20';
    const configured = await journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    });
    if (!configured.ok || configured.value.kind !== 'system') throw new Error('setup');
    const granted = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: configured.value.id,
      expectedPermissionRevision: configured.value.permissionRevision,
      permissions: { allPlayers: 'edit', overrides: [] },
    });
    if (!granted.ok) throw new Error('setup');
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('setup');
    const state = sceneObjectStateOf(createdScene.value);
    const tokenId = '30000000-0000-4000-8000-000000000001';
    state.images.token.push(candidateToken(createdScene.value, configured.value.id, tokenId));
    state.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      createdScene.value.id,
      state,
      createdScene.value.revision,
      '40000000-0000-4000-8000-000000000001',
      player,
    );
    if (!placed.ok) throw new Error('placement');

    expect(scenes.listTokenHealth(placed.value.id)).toMatchObject({
      ok: true,
      value: [{
        down: false,
        ratio: 0.5,
        tokenId,
      }],
    });
    const adjusted = await scenes.mutateTokenInspectorWithEffects(
      placed.value.id,
      tokenId,
      {
        command: '=5',
        fieldId: 'health',
        kind: 'set-value',
        target: 'maximum',
      },
      '40000000-0000-4000-8000-000000000002',
      player,
    );
    expect(adjusted).toMatchObject({
      authoredDataChangedEntryIds: [configured.value.id],
      result: { ok: true },
    });
    expect(scenes.listTokenHealth(placed.value.id)).toMatchObject({
      ok: true,
      value: [{ down: true, ratio: 0, tokenId }],
    });

    const latest = await journal.getEntry({ kind: 'gm' }, configured.value.id);
    if (!latest.ok || latest.value.kind !== 'system') throw new Error('read');
    const unrelated = structuredClone(latest.value.data as Dnd5eCharacterData);
    unrelated.identity.ancestry = 'Dragonborn';
    const unrelatedSaved = await journal.updateEntryData({ kind: 'gm' }, {
      data: unrelated,
      entryId: latest.value.id,
      expectedRevision: latest.value.revision,
    });
    if (!unrelatedSaved.ok) throw new Error('unrelated save');
    const undo = await scenes.undoWithEffects(placed.value.id, player);
    expect(undo.authoredDataChangedEntryIds).toEqual([configured.value.id]);
    const undone = await journal.getEntry({ kind: 'gm' }, configured.value.id);
    expect(undone).toMatchObject({
      ok: true,
      value: {
        data: {
          health: { currentHitPoints: '10', maximumHitPoints: '20' },
          identity: { ancestry: 'Dragonborn' },
        },
      },
    });

    const read = await journal.getEntry({ kind: 'gm' }, configured.value.id);
    if (!read.ok || read.value.kind !== 'system') throw new Error('read');
    const external = structuredClone(read.value.data as Dnd5eCharacterData);
    external.health.currentHitPoints = '3';
    const externalSaved = await journal.updateEntryData({ kind: 'gm' }, {
      data: external,
      entryId: read.value.id,
      expectedRevision: read.value.revision,
    });
    if (!externalSaved.ok) throw new Error('external save');
    const redo = await scenes.redoWithEffects(placed.value.id, player);
    expect(redo.authoredDataChangedEntryIds).toEqual([]);
    const staleSkipped = await journal.getEntry({ kind: 'gm' }, configured.value.id);
    expect(staleSkipped).toMatchObject({
      ok: true,
      value: { data: { health: { currentHitPoints: '3', maximumHitPoints: '20' } } },
    });

    if (!staleSkipped.ok || staleSkipped.value.kind !== 'system') {
      throw new Error('stale read');
    }
    const formulaTemplate = structuredClone(
      staleSkipped.value.data as Dnd5eCharacterData,
    );
    formulaTemplate.defaultToken.type = 'template';
    formulaTemplate.health.currentHitPoints = '2';
    formulaTemplate.health.maximumHitPoints = 'd8';
    const converted = await journal.updateEntryData({ kind: 'gm' }, {
      data: formulaTemplate,
      entryId: staleSkipped.value.id,
      expectedRevision: staleSkipped.value.revision,
    });
    expect(converted).toMatchObject({ ok: true });
    const convertedScene = (await scenes.readManifest()).scenes.find(
      (scene) => scene.id === placed.value.id,
    );
    const convertedToken = convertedScene?.images.token.find(
      (token) => token.id === tokenId,
    );
    if (
      !convertedToken ||
      !isSceneToken(convertedToken) ||
      convertedToken.source.kind !== 'template'
    ) {
      throw new Error('template conversion');
    }
    expect(tokens.getTemplateSnapshot(
      { kind: 'gm' },
      convertedToken.source.instanceId,
    )).toMatchObject({
      data: {
        health: { currentHitPoints: '3', maximumHitPoints: '20' },
      },
    });
  });
});
