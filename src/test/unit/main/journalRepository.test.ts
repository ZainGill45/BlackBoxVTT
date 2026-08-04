import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRepository } from '../../../main/assetRepository';
import { JournalRepository } from '../../../main/journalRepository';
import type { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { CAMPAIGN_SCHEMA_VERSION } from '../../../shared/campaigns';
import { emptyRichTextDocument } from '../../../shared/journal';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const campaignId = '99999999-9999-4999-8999-999999999999';
const playerId = '88888888-8888-4888-8888-888888888888';
const player = { kind: 'player' as const, userId: playerId, username: 'Alice' };
let directory = '';
let database: CampaignDatabase;
let counter = 0;

function repository() {
  const assets = {
    readManifest: vi.fn(async () => ({ assets: [], revision: 0, schemaVersion: 1 })),
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
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
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

  it('refuses malformed persisted rich-text state on reopen', async () => {
    const journal = repository();
    const created = await journal.createNote({ kind: 'gm' });
    if (!created.ok) throw new Error('setup failed');
    database.connection.prepare('UPDATE journal_pages SET content_json = ? WHERE id = ?').run(
      JSON.stringify({ doc: { content: [{ attrs: { src: 'https://bad.example/image.png' }, type: 'image' }], type: 'doc' }, schemaVersion: 1 }),
      created.value.pages[0]!.id,
    );
    expect(() => CampaignDatabase.open(directory)).toThrow(/malformed page|content is invalid/u);
  });

  it('applies the parent hard gate and page inheritance or overrides', async () => {
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
      expectedRevision: created.value.pages[0]!.revision,
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
      expectedRevision: anchor.revision,
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
    const gm = await journal.getNote({ kind: 'gm' }, note.id);
    expect(gm.ok && gm.value.pages[1]!.id).toBe(anchor.id);
  });
});
