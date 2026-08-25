import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRepository } from '../../../main/assetRepository';
import { JournalRepository } from '../../../main/journalRepository';
import type { SceneRepository } from '../../../main/sceneRepository';
import { SceneRepository as RealSceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { MutationQueue } from '../../../main/storage/mutationQueue';
import { TokenRepository } from '../../../main/tokenRepository';
import { emptyRichTextDocument } from '../../../shared/journal';
import {
  DEFAULT_TOKEN_ASSET_ID,
  isSceneToken,
  sceneObjectStateOf,
} from '../../../shared/scenes';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_SPELL_ENTRY_TYPE_ID,
} from '../../../systems/dnd5e/definition';
import {
  createDefaultDnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import { createDefaultDnd5eSpellData } from '../../../systems/dnd5e/spellData';

const campaignId = '99999999-9999-4999-8999-999999999999';
const playerId = '88888888-8888-4888-8888-888888888888';
const player = { kind: 'player' as const, userId: playerId, username: 'Alice' };
let directory = '';
let database: CampaignDatabase;
let counter = 0;

function repository() {
  const assets = {
    readManifest: vi.fn(async () => ({ assets: [], revision: 0 })),
    trashAsset: vi.fn(),
  } as unknown as AssetRepository;
  const scenes = {
    findDependents: vi.fn(async () => ({ ok: true as const, value: [] })),
  } as unknown as SceneRepository;
  return new JournalRepository({
    assets,
    createId: () => `${String(++counter).padStart(8, '0')}-1111-4111-8111-111111111111`,
    database,
    now: () => new Date('2026-08-02T12:00:00.000Z'),
    scenes,
    touchCampaign: vi.fn(async () => undefined),
  });
}

beforeEach(async () => {
  counter = 0;
  directory = await mkdtemp(path.join(tmpdir(), 'blackbox-journal-'));
  database = CampaignDatabase.create(directory, {
    createdAt: '2026-08-02T00:00:00.000Z',
    id: campaignId,
    name: 'Iron Meridian',
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: '2026-08-02T00:00:00.000Z',
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

describe('JournalRepository', () => {
  it('moves a linked token between scene layers through the authoritative path', async () => {
    const mutations = new MutationQueue();
    const tokens = new TokenRepository({ database });
    const scenes = new RealSceneRepository({
      database,
      mutations,
      tokens,
      touchCampaign: vi.fn(async () => undefined),
      warn: vi.fn(),
    });
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
    const character = await journal.createEntry(
      { kind: 'gm' },
      DND5E_CHARACTER_ENTRY_TYPE_ID,
    );
    if (!character.ok || character.value.kind !== 'system') {
      throw new Error('Character setup failed.');
    }
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('Scene setup failed.');
    const tokenId = '66666666-6666-4666-8666-666666666666';
    const placedState = sceneObjectStateOf(createdScene.value);
    placedState.images.token.push({
      assetId: DEFAULT_TOKEN_ASSET_ID,
      height: createdScene.value.grid.size,
      id: tokenId,
      rotation: 0,
      size: { height: 1, kind: 'default', width: 1 },
      source: { entryId: character.value.id, kind: 'linked' },
      width: createdScene.value.grid.size,
      x: 100,
      y: 100,
    });
    placedState.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      createdScene.value.id,
      placedState,
      createdScene.value.revision,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      { kind: 'gm' },
    );
    if (!placed.ok) throw new Error('Token placement failed.');
    const persisted = (await scenes.readManifest()).scenes.find(
      (candidate) => candidate.id === placed.value.id,
    );
    expect(persisted && sceneObjectStateOf(persisted))
      .toEqual(sceneObjectStateOf(placed.value));

    const movedState = sceneObjectStateOf(placed.value);
    movedState.images.map.push(movedState.images.token.shift()!);
    movedState.objectOrder.map.push(tokenId);
    movedState.objectOrder.token = [];
    const moved = await scenes.setObjects(
      placed.value.id,
      movedState,
      placed.value.revision,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      { kind: 'gm' },
      { kind: 'move-layer', targetLayer: 'map', targets: [tokenId] },
    );

    expect(moved).toMatchObject({
      ok: true,
      value: {
        images: { map: [{ id: tokenId }], token: [] },
        objectOrder: { map: [tokenId], token: [] },
      },
    });
  });

  it('places Template tokens as independent validated Character snapshots', async () => {
    const mutations = new MutationQueue();
    const tokens = new TokenRepository({ database });
    const scenes = new RealSceneRepository({
      database,
      mutations,
      tokens,
      touchCampaign: vi.fn(async () => undefined),
      warn: vi.fn(),
    });
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
    if (!created.ok || created.value.kind !== 'system') {
      throw new Error('Character setup failed.');
    }
    const templateData = createDefaultDnd5eCharacterData();
    templateData.defaultToken.type = 'template';
    templateData.health.currentHitPoints = '18';
    const configured = await journal.updateEntryData({ kind: 'gm' }, {
      data: templateData,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    });
    if (!configured.ok || configured.value.kind !== 'system') {
      throw new Error('Character configuration failed.');
    }
    const granted = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: configured.value.id,
      expectedPermissionRevision: configured.value.permissionRevision,
      permissions: {
        allPlayers: 'none',
        overrides: [{ access: 'edit', userId: playerId }],
      },
    });
    if (!granted.ok || granted.value.kind !== 'system') {
      throw new Error('Permission setup failed.');
    }
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('Scene setup failed.');
    const state = sceneObjectStateOf(createdScene.value);
    const tokenId = '66666666-6666-4666-8666-666666666666';
    state.images.token.push({
      assetId: DEFAULT_TOKEN_ASSET_ID,
      height: createdScene.value.grid.size,
      id: tokenId,
      rotation: 0,
      size: { height: 1, kind: 'default', width: 1 },
      source: { entryId: granted.value.id, kind: 'linked' },
      width: createdScene.value.grid.size,
      x: 100,
      y: 100,
    });
    state.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      createdScene.value.id,
      state,
      createdScene.value.revision,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      player,
    );
    expect(placed).toMatchObject({
      ok: true,
      value: {
        images: {
          token: [{
            source: {
              entryId: granted.value.id,
              kind: 'template',
              instanceId: expect.any(String),
            },
          }],
        },
      },
    });
    if (!placed.ok) throw new Error('Template placement failed.');
    const placedToken = placed.value.images.token[0]!;
    if (!isSceneToken(placedToken)) throw new Error('Template token missing.');
    const source = placedToken.source;
    if (source.kind !== 'template') throw new Error('Template source missing.');
    expect(tokens.getTemplateSnapshot(player, source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '18' } },
      name: 'New Character',
      rootEntryId: granted.value.id,
      typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
    });

    const duplicatedState = sceneObjectStateOf(placed.value);
    const duplicateId = '55555555-5555-4555-8555-555555555555';
    duplicatedState.images.token.push({
      ...structuredClone(placedToken),
      id: duplicateId,
      x: placedToken.x + 100,
    });
    duplicatedState.objectOrder.token.push(duplicateId);
    const duplicated = await scenes.setObjects(
      placed.value.id,
      duplicatedState,
      placed.value.revision,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      player,
    );
    expect(duplicated).toMatchObject({ ok: true });
    if (!duplicated.ok) throw new Error('Template duplication failed.');
    const duplicate = duplicated.value.images.token.find(
      (image) => image.id === duplicateId,
    );
    if (!duplicate || !isSceneToken(duplicate) || duplicate.source.kind !== 'template') {
      throw new Error('Duplicated Template token missing.');
    }
    expect(duplicate.source.instanceId).not.toBe(source.instanceId);
    expect(tokens.getTemplateSnapshot(player, duplicate.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '18' } },
      rootEntryId: granted.value.id,
    });

    const deletedState = sceneObjectStateOf(duplicated.value);
    deletedState.images.token = deletedState.images.token.filter(
      (image) => image.id !== duplicateId,
    );
    deletedState.objectOrder.token = deletedState.objectOrder.token.filter(
      (id) => id !== duplicateId,
    );
    const deleted = await scenes.setObjects(
      duplicated.value.id,
      deletedState,
      duplicated.value.revision,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      player,
    );
    expect(deleted).toMatchObject({ ok: true });
    expect(tokens.getTemplateSnapshot({ kind: 'gm' }, duplicate.source.instanceId)).toBeNull();
    const restored = await scenes.undo(duplicated.value.id, player);
    expect(restored).toMatchObject({ ok: true, value: { images: { token: expect.any(Array) } } });
    expect(tokens.getTemplateSnapshot(player, duplicate.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '18' } },
    });
    await expect(scenes.redo(duplicated.value.id, player)).resolves.toMatchObject({ ok: true });
    expect(tokens.getTemplateSnapshot({ kind: 'gm' }, duplicate.source.instanceId)).toBeNull();

    const changedRoot = structuredClone(templateData);
    changedRoot.health.currentHitPoints = '7';
    const changed = await journal.updateEntryData({ kind: 'gm' }, {
      data: changedRoot,
      entryId: granted.value.id,
      expectedRevision: granted.value.revision,
    });
    expect(changed).toMatchObject({ ok: true });
    if (!changed.ok || changed.value.kind !== 'system') {
      throw new Error('Root Character update failed.');
    }
    expect(tokens.getTemplateSnapshot(player, source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '18' } },
    });

    const playerConversion = structuredClone(changedRoot);
    playerConversion.defaultToken.type = 'linked';
    await expect(journal.updateEntryData(player, {
      data: playerConversion,
      entryId: granted.value.id,
      expectedRevision: changed.value.revision,
    })).resolves.toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });

    const convertedLinked = await journal.updateEntryData({ kind: 'gm' }, {
      data: playerConversion,
      entryId: granted.value.id,
      expectedRevision: changed.value.revision,
    });
    expect(convertedLinked).toMatchObject({ ok: true });
    if (!convertedLinked.ok || convertedLinked.value.kind !== 'system') {
      throw new Error('Template-to-Linked conversion failed.');
    }
    const linkedScene = (await scenes.readManifest()).scenes[0]!;
    expect(linkedScene.images.token).toMatchObject([{
      id: tokenId,
      size: { kind: 'override' },
      source: { entryId: granted.value.id, kind: 'linked' },
    }]);
    expect(tokens.getTemplateSnapshot({ kind: 'gm' }, source.instanceId)).toBeNull();

    const convertedTemplateData = structuredClone(playerConversion);
    convertedTemplateData.defaultToken.type = 'template';
    const convertedTemplate = await journal.updateEntryData({ kind: 'gm' }, {
      data: convertedTemplateData,
      entryId: granted.value.id,
      expectedRevision: convertedLinked.value.revision,
    });
    expect(convertedTemplate).toMatchObject({ ok: true });
    if (!convertedTemplate.ok || convertedTemplate.value.kind !== 'system') {
      throw new Error('Linked-to-Template conversion failed.');
    }
    const templateScene = (await scenes.readManifest()).scenes[0]!;
    expect(templateScene.images.token).toMatchObject([{
      id: tokenId,
      source: {
        entryId: granted.value.id,
        instanceId: expect.any(String),
        kind: 'template',
      },
    }]);
    const orphanSource = templateScene.images.token[0];
    if (
      !orphanSource ||
      !isSceneToken(orphanSource) ||
      orphanSource.source.kind !== 'template'
    ) {
      throw new Error('Converted Template source missing.');
    }
    await expect(journal.prepareDelete(
      { kind: 'gm' },
      { entryId: granted.value.id, kind: 'entry' },
    )).resolves.toMatchObject({
      ok: true,
      value: { linkedTokenCount: 0, templateTokenCount: 1 },
    });
    await expect(journal.deleteTarget({ kind: 'gm' }, {
      cleanupAssetIds: [],
      deleteTemplateTokens: false,
      expectedRevision: convertedTemplate.value.revision,
      target: { entryId: granted.value.id, kind: 'entry' },
    })).resolves.toMatchObject({ ok: true });
    expect((await scenes.readManifest()).scenes[0]!.images.token).toMatchObject([{
      id: tokenId,
      source: orphanSource.source,
    }]);
    expect(tokens.getTemplateSnapshot({ kind: 'gm' }, orphanSource.source.instanceId)).toMatchObject({
      data: { health: { currentHitPoints: '7' } },
      rootEntryId: granted.value.id,
    });
    expect(tokens.getTemplateSnapshot(player, orphanSource.source.instanceId)).toBeNull();
    await expect(journal.getEntry({ kind: 'gm' }, granted.value.id)).resolves.toMatchObject({
      error: { code: 'not_found' },
      ok: false,
    });
    const orphanScene = (await scenes.readManifest()).scenes[0]!;
    const orphanState = sceneObjectStateOf(orphanScene);
    const orphanCopyId = '44444444-4444-4444-8444-444444444444';
    orphanState.images.token.push({
      ...structuredClone(orphanSource),
      id: orphanCopyId,
      x: orphanSource.x + 100,
    });
    orphanState.objectOrder.token.push(orphanCopyId);
    const copiedOrphan = await scenes.setObjects(
      orphanScene.id,
      orphanState,
      orphanScene.revision,
      '33333333-3333-4333-8333-333333333333',
      { kind: 'gm' },
    );
    expect(copiedOrphan).toMatchObject({ ok: true });
    if (!copiedOrphan.ok) throw new Error('Orphan duplication failed.');
    const orphanCopy = copiedOrphan.value.images.token.find(
      (image) => image.id === orphanCopyId,
    );
    expect(orphanCopy && isSceneToken(orphanCopy) ? orphanCopy.source : null)
      .toMatchObject({
        entryId: granted.value.id,
        instanceId: expect.not.stringMatching(orphanSource.source.instanceId),
        kind: 'template',
      });

    const forbiddenMove = sceneObjectStateOf(copiedOrphan.value);
    forbiddenMove.images.token[0]!.x += 10;
    await expect(scenes.setObjects(
      copiedOrphan.value.id,
      forbiddenMove,
      copiedOrphan.value.revision,
      '22222222-2222-4222-8222-222222222222',
      player,
    )).resolves.toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });
    database.close();
    database = CampaignDatabase.open(directory);
    const reopenedTokens = new TokenRepository({ database });
    expect(reopenedTokens.getTemplateSnapshot(
      { kind: 'gm' },
      orphanSource.source.instanceId,
    )).toMatchObject({
      data: { health: { currentHitPoints: '7' } },
      rootEntryId: granted.value.id,
    });
  });

  it('persists linked tokens and atomically projects Character defaults across scenes', async () => {
    const mutations = new MutationQueue();
    const scenes = new RealSceneRepository({
      database,
      mutations,
      touchCampaign: vi.fn(async () => undefined),
      warn: vi.fn(),
    });
    const journal = new JournalRepository({
      assets: {
        readManifest: vi.fn(async () => ({ assets: [], revision: 0 })),
        trashAsset: vi.fn(),
      } as unknown as AssetRepository,
      database,
      mutations,
      scenes,
      touchCampaign: vi.fn(async () => undefined),
    });
    const createdCharacter = await journal.createEntry(
      { kind: 'gm' },
      DND5E_CHARACTER_ENTRY_TYPE_ID,
    );
    if (!createdCharacter.ok || createdCharacter.value.kind !== 'system') {
      throw new Error('Character setup failed.');
    }
    const granted = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: createdCharacter.value.id,
      expectedPermissionRevision: createdCharacter.value.permissionRevision,
      permissions: {
        allPlayers: 'none',
        overrides: [{ access: 'edit', userId: playerId }],
      },
    });
    if (!granted.ok || granted.value.kind !== 'system') {
      throw new Error('Permission setup failed.');
    }
    const createdScene = await scenes.create();
    if (!createdScene.ok) throw new Error('Scene setup failed.');
    const placedState = sceneObjectStateOf(createdScene.value);
    const tokenId = '77777777-7777-4777-8777-777777777777';
    placedState.images.token.push({
      assetId: DEFAULT_TOKEN_ASSET_ID,
      height: createdScene.value.grid.size,
      id: tokenId,
      rotation: 0,
      size: { height: 1, kind: 'default', width: 1 },
      source: { entryId: granted.value.id, kind: 'linked' },
      width: createdScene.value.grid.size,
      x: 100,
      y: 100,
    });
    placedState.objectOrder.token.push(tokenId);
    const placed = await scenes.setObjects(
      createdScene.value.id,
      placedState,
      createdScene.value.revision,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      player,
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('Token placement failed.');

    const resizedState = sceneObjectStateOf(placed.value);
    resizedState.images.token[0]!.height *= 2;
    resizedState.images.token[0]!.width *= 2;
    const resized = await scenes.setObjects(
      placed.value.id,
      resizedState,
      placed.value.revision,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      player,
    );
    expect(resized).toMatchObject({
      ok: true,
      value: {
        images: {
          token: [{ size: { height: 2, kind: 'override', width: 2 } }],
        },
      },
    });

    const characterData = createDefaultDnd5eCharacterData();
    characterData.defaultToken.size = { height: 3, width: 2 };
    const savedDefault = await journal.updateEntryData({ kind: 'gm' }, {
      data: characterData,
      entryId: granted.value.id,
      expectedRevision: granted.value.revision,
    });
    expect(savedDefault).toMatchObject({ ok: true });
    const synchronized = (await scenes.readManifest()).scenes[0]!;
    expect(synchronized.images.token).toMatchObject([{
      assetId: DEFAULT_TOKEN_ASSET_ID,
      height: synchronized.grid.size * 3,
      size: { height: 3, kind: 'default', width: 2 },
      source: { entryId: granted.value.id, kind: 'linked' },
      width: synchronized.grid.size * 2,
    }]);

    const staleDeletion = sceneObjectStateOf(synchronized);
    staleDeletion.images.token = [];
    staleDeletion.objectOrder.token = [];
    await expect(scenes.update(
      synchronized.id,
      { name: 'Changed elsewhere' },
      synchronized.revision,
    )).resolves.toMatchObject({ ok: true });
    await expect(scenes.setObjects(
      synchronized.id,
      staleDeletion,
      synchronized.revision,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      player,
    )).resolves.toMatchObject({
      error: { code: 'conflict' },
      ok: false,
    });

    await expect(journal.prepareDelete(
      { kind: 'gm' },
      { entryId: granted.value.id, kind: 'entry' },
    )).resolves.toMatchObject({
      ok: true,
      value: { linkedTokenCount: 1 },
    });
    if (!savedDefault.ok) throw new Error('Default update failed.');
    await expect(journal.deleteTarget({ kind: 'gm' }, {
      cleanupAssetIds: [],
      deleteTemplateTokens: false,
      expectedRevision: savedDefault.value.revision,
      target: { entryId: granted.value.id, kind: 'entry' },
    })).resolves.toMatchObject({ ok: true });
    expect((await scenes.readManifest()).scenes[0]!.images.token).toEqual([]);
  });

  it('creates a private note with one blank page and persists it', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      name: 'New Note',
      pages: [{ title: 'New Page' }],
      permissions: { allPlayers: 'none', overrides: [] },
      typeId: 'core.note',
    });
    await expect(journal.list(player)).resolves.toMatchObject({ ok: true, value: { entries: [] } });
    const page = await journal.getPage({ kind: 'gm' }, created.value.id, created.value.pages[0]!.id);
    expect(page).toMatchObject({ ok: true, value: { content: emptyRichTextDocument() } });
    database.close();
    database = CampaignDatabase.open(directory);
    expect((await repository().list({ kind: 'gm' })).ok).toBe(true);
  });

  it('persists the D&D-owned Character lifecycle and filters private access', async () => {
    const journal = repository();
    await expect(journal.createEntry(player, DND5E_CHARACTER_ENTRY_TYPE_ID)).resolves.toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });
    const created = await journal.createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    expect(created).toMatchObject({
      ok: true,
      value: {
        data: createDefaultDnd5eCharacterData(),
        groupId: 'dnd5e.characters',
        detail: null,
        kind: 'system',
        name: 'New Character',
        permissions: { allPlayers: 'none', overrides: [] },
        typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
      },
    });
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup failed');
    expect(database.connection.prepare(
      'SELECT COUNT(*) AS count FROM journal_pages WHERE entry_id = ?',
    ).get(created.value.id)).toEqual({ count: 0 });
    await expect(journal.list(player)).resolves.toMatchObject({ ok: true, value: { entries: [] } });

    const granted = await journal.updateEntryPermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: created.value.permissionRevision,
      permissions: { allPlayers: 'none', overrides: [{ access: 'edit', userId: playerId }] },
    });
    if (!granted.ok || granted.value.kind !== 'system') throw new Error('permission setup failed');
    await expect(journal.list(player)).resolves.toMatchObject({
      ok: true,
      value: { entries: [{ capabilities: { edit: true, managePermissions: false }, name: 'New Character' }] },
    });
    const data = createDefaultDnd5eCharacterData();
    data.identity.className = 'Fighter';
    data.abilities.strength.score = 17;
    const updated = await journal.updateEntryData(player, {
      data,
      entryId: created.value.id,
      expectedRevision: granted.value.revision,
    });
    expect(updated).toMatchObject({
      ok: true,
      value: {
        data: { abilities: { strength: { score: 17 } }, identity: { className: 'Fighter' } },
        revision: granted.value.revision + 1,
      },
    });
    expect(database.connection.prepare(
      'SELECT updated_at, updated_by FROM journal_entries WHERE id = ?',
    ).get(created.value.id)).toEqual({
      updated_at: '2026-08-02T12:00:00.000Z',
      updated_by: `player:${playerId}`,
    });
    if (!updated.ok) throw new Error('data update failed');
    const renamed = await journal.renameEntry(player, created.value.id, '  Aria Stone  ', updated.value.revision);
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Aria Stone' } });
    expect(await journal.createEntry({ kind: 'gm' }, 'core.character')).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });

    database.close();
    database = CampaignDatabase.open(directory);
    await expect(repository().getEntry({ kind: 'gm' }, created.value.id)).resolves.toMatchObject({
      ok: true,
      value: {
        data: { abilities: { strength: { score: 17 } }, identity: { className: 'Fighter' } },
        name: 'Aria Stone',
        typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
      },
    });
  });

  it('creates D&D Spells with immediate default player visibility and system detail', async () => {
    const journal = repository();
    const created = await journal.createEntry(
      { kind: 'gm' },
      DND5E_SPELL_ENTRY_TYPE_ID,
    );
    expect(created).toMatchObject({
      ok: true,
      value: {
        data: createDefaultDnd5eSpellData(),
        detail: 'Cantrip Abjuration',
        groupId: 'dnd5e.spells',
        name: 'New Spell',
        permissions: { allPlayers: 'view', overrides: [] },
      },
    });
    if (!created.ok || created.value.kind !== 'system') throw new Error('setup failed');
    await expect(journal.list(player)).resolves.toMatchObject({
      ok: true,
      value: {
        entries: [{
          capabilities: { edit: false, view: true },
          detail: 'Cantrip Abjuration',
          name: 'New Spell',
        }],
      },
    });
    const data = createDefaultDnd5eSpellData();
    data.level = 3;
    data.school = 'Evocation';
    const updated = await journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { detail: '3rd Level Evocation' },
    });
    await expect(journal.updateEntryData(player, {
      data,
      entryId: created.value.id,
      expectedRevision: created.value.revision,
    })).resolves.toMatchObject({
      error: { code: 'permission_denied' },
      ok: false,
    });
  });

  it('rejects malformed or foreign-system Journal entry data on reopen', async () => {
    const created = await repository().createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    if (!created.ok) throw new Error('setup failed');
    database.connection.prepare(
      'UPDATE journal_entries SET data_json = ? WHERE id = ?',
    ).run(JSON.stringify({ rulesVersion: '5e' }), created.value.id);
    expect(() => CampaignDatabase.open(directory)).toThrow(/entry data|malformed/u);

    database.connection.prepare(
      'UPDATE journal_entries SET data_json = ?, type_id = ? WHERE id = ?',
    ).run('{}', 'foreign.character', created.value.id);
    expect(() => CampaignDatabase.open(directory)).toThrow(/malformed|unsupported|entry data/u);
  });

  it('reorders one Journal group through the canonical global positions', async () => {
    const journal = repository();
    const noteOne = await journal.createNote({ kind: 'gm' });
    const characterOne = await journal.createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    const noteTwo = await journal.createNote({ kind: 'gm' });
    const characterTwo = await journal.createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    if (!noteOne.ok || !characterOne.ok || !noteTwo.ok || !characterTwo.ok) throw new Error('setup failed');
    const before = await journal.list({ kind: 'gm' });
    if (!before.ok) throw new Error('manifest setup failed');
    const moved = await journal.moveEntry({ kind: 'gm' }, {
      direction: 'up',
      entryId: characterTwo.value.id,
      expectedManifestRevision: before.value.revision,
    });
    expect(moved).toMatchObject({
      ok: true,
      value: { entries: [
        { id: noteOne.value.id },
        { id: characterTwo.value.id },
        { id: noteTwo.value.id },
        { id: characterOne.value.id },
      ] },
    });
    if (!moved.ok) throw new Error('move failed');
    await expect(journal.reorderEntries({ kind: 'gm' }, {
      expectedManifestRevision: before.value.revision,
      groupId: 'core.notes',
      orderedEntryIds: [noteTwo.value.id, noteOne.value.id],
    })).resolves.toMatchObject({ error: { code: 'conflict' }, ok: false });
    const reordered = await journal.reorderEntries({ kind: 'gm' }, {
      expectedManifestRevision: moved.value.revision,
      groupId: 'core.notes',
      orderedEntryIds: [noteTwo.value.id, noteOne.value.id],
    });
    expect(reordered).toMatchObject({
      ok: true,
      value: { entries: [
        { id: noteTwo.value.id },
        { id: characterTwo.value.id },
        { id: noteOne.value.id },
        { id: characterOne.value.id },
      ] },
    });
    database.close();
    database = CampaignDatabase.open(directory);
    await expect(repository().list({ kind: 'gm' })).resolves.toMatchObject(reordered);
  });

  it('validates system entry data updates and revision conflicts', async () => {
    const journal = repository();
    const character = await journal.createEntry({ kind: 'gm' }, DND5E_CHARACTER_ENTRY_TYPE_ID);
    const note = await journal.createNote({ kind: 'gm' });
    if (!character.ok || !note.ok) throw new Error('setup failed');
    const data = createDefaultDnd5eCharacterData();
    data.identity.subclass = 'Champion';

    await expect(journal.updateEntryData(player, {
      data,
      entryId: character.value.id,
      expectedRevision: character.value.revision,
    })).resolves.toMatchObject({ error: { code: 'permission_denied' }, ok: false });
    await expect(journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: note.value.id,
      expectedRevision: note.value.revision,
    })).resolves.toMatchObject({ error: { code: 'not_found' }, ok: false });
    await expect(journal.updateEntryData({ kind: 'gm' }, {
      data: { ...data, extra: '' },
      entryId: character.value.id,
      expectedRevision: character.value.revision,
    })).resolves.toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    const updated = await journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: character.value.id,
      expectedRevision: character.value.revision,
    });
    expect(updated).toMatchObject({ ok: true, value: { data: { identity: { subclass: 'Champion' } } } });
    await expect(journal.updateEntryData({ kind: 'gm' }, {
      data,
      entryId: character.value.id,
      expectedRevision: character.value.revision,
    })).resolves.toMatchObject({ error: { code: 'conflict' }, ok: false });
  });

  it('refuses malformed persisted rich-text state on reopen', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    database.connection.prepare('UPDATE journal_pages SET content_json = ? WHERE id = ?').run(
      JSON.stringify({ doc: { content: [{ attrs: { src: 'https://bad.example/image.png' }, type: 'image' }], type: 'doc' } }),
      created.value.pages[0]!.id,
    );
    expect(() => CampaignDatabase.open(directory)).toThrow(/malformed page|content is invalid/u);
  });

  it('applies page inheritance and explicit overrides', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    const pageId = created.value.pages[0]!.id;
    const parentEdit = await journal.updateNotePermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: created.value.permissionRevision,
      permissions: { allPlayers: 'view', overrides: [{ access: 'edit', userId: playerId }] },
    });
    expect(parentEdit.ok && parentEdit.value.capabilities.managePermissions).toBe(true);
    const playerNote = await journal.getNote(player, created.value.id);
    expect(playerNote).toMatchObject({ ok: true, value: { capabilities: { edit: true, managePermissions: false } } });
    const hiddenPage = await journal.updatePagePermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: created.value.pages[0]!.permissionRevision,
      pageId,
      permissions: { allPlayers: 'none', overrides: [] },
    });
    expect(hiddenPage.ok).toBe(true);
    expect(await journal.getPage(player, created.value.id, pageId)).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    const latest = await journal.getNote({ kind: 'gm' }, created.value.id);
    if (!latest.ok) throw new Error('setup failed');
    await journal.updateNotePermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: latest.value.permissionRevision,
      permissions: { allPlayers: 'none', overrides: [] },
    });
    expect(await journal.getNote(player, created.value.id)).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('lets a page grant access independently from a private note default', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    const page = created.value.pages[0]!;
    const sharedPage = await journal.updatePagePermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: page.permissionRevision,
      pageId: page.id,
      permissions: {
        allPlayers: 'none',
        overrides: [{ access: 'view', userId: playerId }],
      },
    });
    expect(sharedPage.ok).toBe(true);
    expect(await journal.getNote(player, created.value.id)).toMatchObject({
      ok: true,
      value: {
        capabilities: { edit: false, managePages: false },
        pages: [{ id: page.id, capabilities: { edit: false, view: true } }],
      },
    });
    expect(await journal.getPage(player, created.value.id, page.id)).toMatchObject({
      ok: true,
      value: { id: page.id, position: 0 },
    });
  });

  it('enforces page structure capabilities, last-page protection, and exclusive leases', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    const shared = await journal.updateNotePermissions({ kind: 'gm' }, {
      entryId: created.value.id,
      expectedPermissionRevision: created.value.permissionRevision,
      permissions: { allPlayers: 'none', overrides: [{ access: 'edit', userId: playerId }] },
    });
    if (!shared.ok) throw new Error('setup failed');
    const firstId = shared.value.pages[0]!.id;
    const playerPage = await journal.getPage(player, shared.value.id, firstId);
    expect(playerPage).toMatchObject({ ok: true, value: { capabilities: { delete: false, edit: true } } });
    const lease = await journal.acquireLease(player, shared.value.id, firstId);
    expect(lease.ok).toBe(true);
    expect(await journal.acquireLease(player, shared.value.id, firstId)).toMatchObject({
      error: { code: 'locked', holderName: 'Alice' },
      ok: false,
    });
    expect(await journal.acquireLease({ kind: 'gm' }, shared.value.id, firstId)).toMatchObject({ ok: false, error: { code: 'locked', holderName: 'Alice' } });
    if (lease.ok) await journal.releaseLease(player, firstId, lease.value.leaseId);
    const second = await journal.createPage(player, shared.value.id, shared.value.revision);
    expect(second.ok).toBe(true);
    const afterCreate = await journal.getNote(player, shared.value.id);
    expect(afterCreate.ok && afterCreate.value.pages.every(({ capabilities }) => capabilities.delete)).toBe(true);
  });

  it('keeps hidden pages as fixed anchors while a player reorders editable pages', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    let note = created.value;
    for (let index = 0; index < 2; index += 1) {
      const made = await journal.createPage({ kind: 'gm' }, note.id, note.revision);
      if (!made.ok) throw new Error('setup failed');
      const refreshed = await journal.getNote({ kind: 'gm' }, note.id);
      if (!refreshed.ok) throw new Error('setup failed');
      note = refreshed.value;
    }
    const granted = await journal.updateNotePermissions({ kind: 'gm' }, {
      entryId: note.id,
      expectedPermissionRevision: note.permissionRevision,
      permissions: { allPlayers: 'none', overrides: [{ access: 'edit', userId: playerId }] },
    });
    if (!granted.ok) throw new Error('setup failed');
    const anchor = granted.value.pages[1]!;
    await journal.updatePagePermissions({ kind: 'gm' }, {
      entryId: note.id,
      expectedPermissionRevision: anchor.permissionRevision,
      pageId: anchor.id,
      permissions: { allPlayers: 'none', overrides: [] },
    });
    const playerProjection = await journal.getNote(player, note.id);
    if (!playerProjection.ok) throw new Error('setup failed');
    const ordered = [...playerProjection.value.pages].reverse().map(({ id }) => id);
    const reordered = await journal.reorderPages(player, {
      entryId: note.id,
      expectedEntryRevision: playerProjection.value.revision,
      orderedPageIds: ordered,
    });
    expect(reordered.ok).toBe(true);
    const visibleLast = await journal.getPage(
      player,
      note.id,
      playerProjection.value.pages[0]!.id,
    );
    expect(visibleLast).toMatchObject({ ok: true, value: { position: 1 } });
    const gm = await journal.getNote({ kind: 'gm' }, note.id);
    expect(gm.ok && gm.value.pages[1]!.id).toBe(anchor.id);
  });

  it('does not invalidate an edit lease when pages are reordered or permissions change', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    const made = await journal.createPage({ kind: 'gm' }, created.value.id, created.value.revision);
    if (!made.ok) throw new Error('setup failed');
    const current = await journal.getNote({ kind: 'gm' }, created.value.id);
    if (!current.ok) throw new Error('setup failed');
    const first = current.value.pages[0]!;
    const lease = await journal.acquireLease({ kind: 'gm' }, current.value.id, first.id);
    if (!lease.ok) throw new Error('setup failed');

    const reordered = await journal.reorderPages({ kind: 'gm' }, {
      entryId: current.value.id,
      expectedEntryRevision: current.value.revision,
      orderedPageIds: [...current.value.pages].reverse().map(({ id }) => id),
    });
    expect(reordered.ok).toBe(true);
    const permissions = await journal.updatePagePermissions({ kind: 'gm' }, {
      entryId: current.value.id,
      expectedPermissionRevision: first.permissionRevision,
      pageId: first.id,
      permissions: { allPlayers: 'view', overrides: [] },
    });
    expect(permissions.ok).toBe(true);
    const saved = await journal.updatePage(
      { kind: 'gm' },
      current.value.id,
      first.id,
      lease.value.leaseId,
      'Still editable',
      first.titleStyle,
      emptyRichTextDocument(),
      first.revision,
    );
    expect(saved).toMatchObject({ ok: true, value: { title: 'Still editable' } });
  });

  it('indexes embedded page assets transactionally', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    const page = created.value.pages[0]!;
    const assetId = '77777777-7777-4777-8777-777777777777';
    database.connection.prepare(
      `INSERT INTO assets (id, position, record_json, default_access, permission_revision)
       VALUES (?, 0, ?, 'none', 0)`,
    ).run(assetId, '{}');
    const lease = await journal.acquireLease({ kind: 'gm' }, created.value.id, page.id);
    if (!lease.ok) throw new Error('setup failed');
    const content = {
      doc: {
        content: [{ attrs: { assetId }, type: 'assetImage' as const }],
        type: 'doc' as const,
      },
    };
    const saved = await journal.updatePage(
      { kind: 'gm' },
      created.value.id,
      page.id,
      lease.value.leaseId,
      page.title,
      page.titleStyle,
      content,
      page.revision,
    );
    expect(saved.ok).toBe(true);
    await expect(journal.findAssetDependents(assetId)).resolves.toEqual([
      { entryId: created.value.id, pageId: page.id, title: page.title },
    ]);
    await journal.releaseLease({ kind: 'gm' }, page.id, lease.value.leaseId);
    expect(await journal.detachAsset(assetId)).toEqual({ ok: true, value: null });
    await expect(journal.findAssetDependents(assetId)).resolves.toEqual([]);
  });
});
