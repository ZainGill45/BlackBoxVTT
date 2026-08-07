import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRepository } from '../../../main/assetRepository';
import { JournalRepository } from '../../../main/journalRepository';
import type { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { emptyRichTextDocument } from '../../../shared/journal';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';
import {
  createDefaultDnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';

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
      expectedRevision: created.value.revision,
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
      expectedRevision: created.value.revision,
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
      expectedRevision: latest.value.revision,
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
      expectedRevision: created.value.revision,
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
      expectedRevision: note.revision,
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
      'INSERT INTO assets (id, position, record_json) VALUES (?, 0, ?)',
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
