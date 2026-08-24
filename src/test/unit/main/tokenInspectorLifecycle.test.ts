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
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-inspector-'));
  database = CampaignDatabase.create(directory, {
    createdAt: '2026-08-23T00:00:00.000Z',
    id: campaignId,
    name: 'Inspector Test',
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

describe('Token Inspector lifecycle', () => {
  it('reads with view access and applies linked field-local edits with history', async () => {
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
    const created = await journal.createEntry(
      { kind: 'gm' },
      DND5E_CHARACTER_ENTRY_TYPE_ID,
    );
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup');
    const viewGrant = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: created.value.permissionRevision,
      permissions: { allPlayers: 'view', overrides: [] },
    });
    if (!viewGrant.ok) throw new Error('permissions');
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('scene');
    const state = sceneObjectStateOf(createdScene.value);
    const tokenId = '10000000-0000-4000-8000-000000000001';
    state.images.token.push(candidateToken(createdScene.value, created.value.id, tokenId));
    state.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      createdScene.value.id,
      state,
      createdScene.value.revision,
      '20000000-0000-4000-8000-000000000001',
      { kind: 'gm' },
    );
    if (!placed.ok) throw new Error('placement');

    await scenes.mutateTokenInspector(
      placed.value.id,
      tokenId,
      { fieldId: 'initiative', kind: 'add-field' },
      '20000000-0000-4000-8000-000000000005',
      { kind: 'gm' },
    );

    const readOnlyInspector = scenes.getTokenInspector(placed.value.id, tokenId, player);
    expect(readOnlyInspector).toMatchObject({
        ok: true,
        value: {
          editable: false,
          selectedFieldIds: ['health', 'armor-class', 'initiative'],
          tokenId,
        },
      });
    if (!readOnlyInspector.ok) throw new Error('inspector');
    expect(readOnlyInspector.value.fields.find(({ id }) => id === 'initiative'))
      .not.toHaveProperty('roll');
    expect(scenes.resolveTokenInspectorRoll(
      placed.value.id,
      tokenId,
      'initiative',
      player,
    )).toMatchObject({ error: { code: 'permission_denied' }, ok: false });
    await expect(scenes.mutateTokenInspector(
      placed.value.id,
      tokenId,
      {
        command: '18',
        fieldId: 'armor-class',
        kind: 'set-value',
        target: 'value',
      },
      '20000000-0000-4000-8000-000000000002',
      player,
    )).resolves.toMatchObject({ error: { code: 'permission_denied' }, ok: false });

    const editGrant = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: viewGrant.value.permissionRevision,
      permissions: { allPlayers: 'edit', overrides: [] },
    });
    if (!editGrant.ok) throw new Error('permissions');
    const rollSource = await journal.getEntry({ kind: 'gm' }, created.value.id);
    if (!rollSource.ok || rollSource.value.kind !== 'system') throw new Error('read');
    const rollData = structuredClone(rollSource.value.data as Dnd5eCharacterData);
    rollData.importantStats.initiativeOffset = 4;
    const rollSourceSaved = await journal.updateEntryData({ kind: 'gm' }, {
      data: rollData,
      entryId: rollSource.value.id,
      expectedRevision: rollSource.value.revision,
    });
    if (!rollSourceSaved.ok) throw new Error('save');
    expect(scenes.resolveTokenInspectorRoll(
      placed.value.id,
      tokenId,
      'initiative',
      player,
    )).toMatchObject({
      ok: true,
      value: {
        category: 'Initiative',
        sections: [{ modifiers: [{ value: 4 }] }],
      },
    });
    const added = await scenes.mutateTokenInspectorWithEffects(
      placed.value.id,
      tokenId,
      { fieldId: 'speed', kind: 'add-field' },
      '20000000-0000-4000-8000-000000000003',
      player,
    );
    expect(added).toMatchObject({
      authoredDataChangedEntryIds: [created.value.id],
      result: { ok: true },
    });
    await scenes.mutateTokenInspector(
      placed.value.id,
      tokenId,
      {
        command: '18',
        fieldId: 'armor-class',
        kind: 'set-value',
        target: 'value',
      },
      '20000000-0000-4000-8000-000000000004',
      player,
    );
    const current = await journal.getEntry({ kind: 'gm' }, created.value.id);
    if (!current.ok || current.value.kind !== 'system') throw new Error('read');
    const unrelated = structuredClone(current.value.data as Dnd5eCharacterData);
    unrelated.identity.ancestry = 'Elf';
    const saved = await journal.updateEntryData({ kind: 'gm' }, {
      data: unrelated,
      entryId: current.value.id,
      expectedRevision: current.value.revision,
    });
    if (!saved.ok) throw new Error('save');
    await scenes.undo(placed.value.id, player);
    const undone = await journal.getEntry({ kind: 'gm' }, created.value.id);
    expect(undone).toMatchObject({
      ok: true,
      value: {
        data: {
          importantStats: { armorClass: '10' },
          identity: { ancestry: 'Elf' },
        },
      },
    });
  });

  it('keeps a Template value and layout independent from its root', async () => {
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
    const created = await journal.createEntry(
      { kind: 'gm' },
      DND5E_CHARACTER_ENTRY_TYPE_ID,
    );
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup');
    const data = createDefaultDnd5eCharacterData();
    data.defaultToken.type = 'template';
    data.defaultToken.inspector.fieldIds.push('initiative');
    data.importantStats.armorClass = '12';
    data.importantStats.initiativeOffset = 2;
    const configured = await journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    });
    if (!configured.ok || configured.value.kind !== 'system') {
      throw new Error('configuration');
    }
    const scene = await scenes.create();
    if (!scene.ok) throw new Error('scene');
    const state = sceneObjectStateOf(scene.value);
    const tokenId = '30000000-0000-4000-8000-000000000001';
    state.images.token.push(candidateToken(scene.value, created.value.id, tokenId));
    state.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      scene.value.id,
      state,
      scene.value.revision,
      '40000000-0000-4000-8000-000000000001',
      { kind: 'gm' },
    );
    if (!placed.ok) throw new Error('placement');
    const token = placed.value.images.token.find((image) => image.id === tokenId);
    if (!token || !isSceneToken(token) || token.source.kind !== 'template') {
      throw new Error('template');
    }
    const changedRootData = structuredClone(configured.value.data as Dnd5eCharacterData);
    changedRootData.importantStats.initiativeOffset = 9;
    const changedRoot = await journal.updateEntryData({ kind: 'gm' }, {
      data: changedRootData,
      entryId: configured.value.id,
      expectedRevision: configured.value.revision,
    });
    if (!changedRoot.ok) throw new Error('root update');
    expect(scenes.resolveTokenInspectorRoll(
      placed.value.id,
      tokenId,
      'initiative',
      { kind: 'gm' },
    )).toMatchObject({
      ok: true,
      value: {
        category: 'Initiative',
        sections: [{ modifiers: [{ value: 2 }] }],
      },
    });
    await scenes.mutateTokenInspector(
      placed.value.id,
      tokenId,
      {
        command: '16',
        fieldId: 'armor-class',
        kind: 'set-value',
        target: 'value',
      },
      '40000000-0000-4000-8000-000000000002',
      { kind: 'gm' },
    );
    await scenes.mutateTokenInspector(
      placed.value.id,
      tokenId,
      { fieldId: 'health', kind: 'delete-field' },
      '40000000-0000-4000-8000-000000000003',
      { kind: 'gm' },
    );

    expect(scenes.getTokenInspector(placed.value.id, tokenId, { kind: 'gm' }))
      .toMatchObject({
        ok: true,
        value: { selectedFieldIds: ['armor-class', 'initiative'] },
      });
    expect(tokens.getTemplateSnapshot(
      { kind: 'gm' },
      token.source.instanceId,
    )).toMatchObject({
      data: {
        defaultToken: { inspector: { fieldIds: ['armor-class', 'initiative'] } },
        importantStats: { armorClass: '16' },
      },
    });
    const root = await journal.getEntry({ kind: 'gm' }, created.value.id);
    expect(root).toMatchObject({
      ok: true,
      value: {
        data: {
          defaultToken: {
            inspector: { fieldIds: ['health', 'armor-class', 'initiative'] },
          },
          importantStats: { armorClass: '12' },
        },
      },
    });
  });
});
