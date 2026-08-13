import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { create as createTar, extract as extractTar } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetRepository } from '../../../main/assetRepository';
import { CampaignArchiveService } from '../../../main/campaignArchiveService';
import { CampaignRepository } from '../../../main/campaignRepository';
import { JournalRepository } from '../../../main/journalRepository';
import type { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { addIntermediatePermissionSchema } from '../../support/campaignArchive';
import {
  createDefaultDnd5eCharacterData,
  createDefaultDnd5eCharacterSpellcasting,
  type Dnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_SPELL_ENTRY_TYPE_ID,
} from '../../../systems/dnd5e/definition';
import {
  createDefaultDnd5eSpellData,
  createDefaultDnd5eSpellRollStep,
} from '../../../systems/dnd5e/spellData';

const sourceId = '11111111-1111-4111-8111-111111111111';
const importedId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const unreadableId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-08-06T22:00:00.000Z');
const salvagedIdentityWarning =
  'Server identity was not carried over; a new TLS identity will be ' +
  'generated, and players will be asked to trust this campaign again.';
const temporaryDirectories: string[] = [];

/**
 * Lays a frozen archive down as a campaign directory this release cannot open.
 *
 * The export manifest is dropped on the way in, because that is the whole
 * difference salvage exists to cover: a campaign on disk carries no envelope,
 * so nothing declares the format its data was written in.
 */
async function layUnreadableCampaign(
  rootDirectory: string,
  fixtureName: string,
): Promise<string> {
  const directory = path.join(rootDirectory, unreadableId);
  await mkdir(directory, { recursive: true });
  await extractTar({
    cwd: directory,
    file: path.resolve(`src/test/fixtures/archives/${fixtureName}`),
    gzip: true,
    strict: true,
  });
  await rm(path.join(directory, 'export.json'), { force: true });
  return directory;
}

async function fixture() {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'blackbox-campaign-archive-test-'),
  );
  temporaryDirectories.push(temporaryDirectory);
  const rootDirectory = path.join(temporaryDirectory, 'campaigns');
  const trashItem = vi.fn(async () => undefined);
  const campaigns = new CampaignRepository({
    createId: () => sourceId,
    now: () => new Date('2026-08-01T12:00:00.000Z'),
    rootDirectory,
    trashItem,
  });
  const created = await campaigns.create({ name: 'Iron Meridian' });
  if (!created.ok) throw new Error(created.error.message);
  const campaignDirectory = path.join(rootDirectory, sourceId);
  const database = CampaignDatabase.open(campaignDirectory);
  const assets = new AssetRepository({
    database,
    trashItem: (targetPath) => rm(targetPath, { force: true, recursive: true }),
  });
  const sourceAsset = path.join(temporaryDirectory, 'map.png');
  await writeFile(
    sourceAsset,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  );
  const importedAsset = await assets.importFiles([sourceAsset], {
    id: actorId,
    role: 'gm',
  });
  if (!importedAsset.ok || !importedAsset.value[0]) {
    throw new Error('Asset fixture could not be created.');
  }
  const asset = importedAsset.value[0];
  const journalIds = [
    '44444444-4444-4444-8444-444444444444',
    '66666666-6666-4666-8666-666666666666',
  ];
  const journal = new JournalRepository({
    assets,
    createId: () => journalIds.shift()!,
    database,
    now: () => new Date('2026-08-01T12:00:00.000Z'),
    scenes: {
      findDependents: vi.fn(async () => ({ ok: true as const, value: [] })),
    } as unknown as SceneRepository,
    touchCampaign: vi.fn(async () => undefined),
  });
  const createdCharacter = await journal.createEntry(
    { kind: 'gm' },
    DND5E_CHARACTER_ENTRY_TYPE_ID,
  );
  if (!createdCharacter.ok || createdCharacter.value.kind !== 'system') {
    throw new Error('Character fixture could not be created.');
  }
  const characterData = createDefaultDnd5eCharacterData();
  characterData.features = [{
    description: 'A current archive feature.',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Archive Feature',
    source: 'Fixture',
    sourceType: 'Test',
    type: 'feature',
  }];
  const updatedCharacter = await journal.updateEntryData({ kind: 'gm' }, {
    data: characterData,
    entryId: createdCharacter.value.id,
    expectedRevision: createdCharacter.value.revision,
  });
  if (!updatedCharacter.ok) throw new Error('Character fixture could not be updated.');
  const createdSpell = await journal.createEntry(
    { kind: 'gm' },
    DND5E_SPELL_ENTRY_TYPE_ID,
  );
  if (!createdSpell.ok || createdSpell.value.kind !== 'system') {
    throw new Error('Spell fixture could not be created.');
  }
  const spellData = createDefaultDnd5eSpellData();
  spellData.classes = ['Sorcerer', 'Wizard'];
  spellData.description = 'A representative authored archive Spell.';
  spellData.level = 3;
  spellData.school = 'Evocation';
  const damage = createDefaultDnd5eSpellRollStep(
    'damage',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  );
  if (damage.purpose !== 'damage') throw new Error('Damage fixture is invalid.');
  damage.damageType = 'fire';
  damage.terms = [{
    count: 8,
    kind: 'dice',
    scaling: 'cast-level',
    sides: 6,
    tiers: [
      { count: 8, minimum: 3 },
      { count: 9, minimum: 4 },
    ],
  }];
  spellData.rollSteps = [damage];
  const updatedSpell = await journal.updateEntryData({ kind: 'gm' }, {
    data: spellData,
    entryId: createdSpell.value.id,
    expectedRevision: createdSpell.value.revision,
  });
  if (!updatedSpell.ok) throw new Error('Spell fixture could not be updated.');
  database.close();
  const networkDirectory = path.join(campaignDirectory, 'content', 'network');
  await mkdir(networkDirectory, { recursive: true });
  await writeFile(path.join(networkDirectory, 'campaign-key.pem'), 'private');

  const archiveWithoutExtension = path.join(temporaryDirectory, 'Iron Meridian');
  const archivePath = `${archiveWithoutExtension}.blackbox-campaign`;
  const dialogs = {
    chooseExportPath: vi.fn(
      async (): Promise<string | null> => archiveWithoutExtension,
    ),
    chooseImportPath: vi.fn(async (): Promise<string | null> => archivePath),
  };
  const service = new CampaignArchiveService({
    campaigns,
    createId: () => importedId,
    dialogs,
    now: () => now,
    rootDirectory,
    sourceRelease: '1.0.0-dev',
    warn: vi.fn(),
  });
  return {
    archivePath,
    asset,
    campaignDirectory,
    campaigns,
    dialogs,
    rootDirectory,
    service,
    temporaryDirectory,
    trashItem,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('CampaignArchiveService', () => {
  it('exports and reconstructs a fresh canonical campaign with its assets', async () => {
    const {
      archivePath,
      asset,
      campaignDirectory,
      campaigns,
      dialogs,
      rootDirectory,
      service,
      temporaryDirectory,
    } = await fixture();

    await expect(service.exportCampaign({ id: sourceId })).resolves.toEqual({
      ok: true,
      value: { fileName: 'Iron Meridian.blackbox-campaign' },
    });
    await expect(access(archivePath)).resolves.toBeUndefined();
    expect(dialogs.chooseExportPath).toHaveBeenCalledWith(
      'Iron Meridian.blackbox-campaign',
    );
    const inspectionDirectory = path.join(temporaryDirectory, 'archive-inspection');
    await mkdir(inspectionDirectory);
    await extractTar({
      cwd: inspectionDirectory,
      file: archivePath,
      gzip: true,
      strict: true,
    });
    expect(JSON.parse(await readFile(
      path.join(inspectionDirectory, 'export.json'),
      'utf8',
    ))).toMatchObject({ formatVersion: 13 });

    const imported = await service.importCampaign();
    expect(imported).toEqual({
      ok: true,
      value: {
        campaign: {
          createdAt: '2026-08-01T12:00:00.000Z',
          id: importedId,
          name: 'Iron Meridian (Imported)',
          system: {
            id: 'dnd5e',
            settings: { defaultRulesVersion: '5.5e' },
          },
          updatedAt: now.toISOString(),
        },
        report: {
          sourceRelease: '1.0.0-dev',
          warnings: [
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });

    const importedDirectory = path.join(rootDirectory, importedId);
    const importedDatabase = CampaignDatabase.open(importedDirectory);
    const importedAssets = new AssetRepository({
      database: importedDatabase,
      trashItem: vi.fn(),
    });
    await expect(importedAssets.readManifest()).resolves.toMatchObject({
      assets: [
        {
          id: asset.id,
          sha256: asset.sha256,
          sizeBytes: asset.sizeBytes,
        },
      ],
    });
    const characterRow = importedDatabase.connection.prepare(
      `SELECT data_json FROM journal_entries
       WHERE type_id = 'dnd5e.character' AND name = 'New Character'`,
    ).get() as { data_json: string } | undefined;
    expect(JSON.parse(characterRow!.data_json)).toMatchObject({
      features: [{
        description: 'A current archive feature.',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Archive Feature',
        source: 'Fixture',
        sourceType: 'Test',
        type: 'feature',
      }],
    });
    const spellRow = importedDatabase.connection.prepare(
      `SELECT data_json, default_access FROM journal_entries
       WHERE type_id = 'dnd5e.spell' AND name = 'New Spell'`,
    ).get() as { data_json: string; default_access: string } | undefined;
    expect(spellRow?.default_access).toBe('view');
    expect(JSON.parse(spellRow!.data_json)).toMatchObject({
      classes: ['Sorcerer', 'Wizard'],
      level: 3,
      rollSteps: [{ damageType: 'fire', purpose: 'damage' }],
      school: 'Evocation',
    });
    importedDatabase.close();
    await expect(
      access(
        path.join(
          importedDirectory,
          'content',
          'assets',
          `${asset.id}.${asset.extension}`,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(importedDirectory, 'content', 'network')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const sourceDatabase = CampaignDatabase.open(campaignDirectory);
    expect(sourceDatabase.readManifest().id).toBe(sourceId);
    sourceDatabase.close();
    const listed = await campaigns.list();
    expect(
      listed.ok ? listed.value.map((campaign) => campaign.name) : [],
    ).toEqual(['Iron Meridian (Imported)', 'Iron Meridian']);
  });

  it('rejects malformed archives without installing a campaign', async () => {
    const { archivePath, campaigns, service } = await fixture();
    await writeFile(archivePath, 'not an archive');

    await expect(service.importCampaign()).resolves.toEqual({
      error: {
        code: 'invalid_archive',
        message: 'The selected campaign archive is invalid or incomplete.',
      },
      ok: false,
    });
    const listed = await campaigns.list();
    expect(listed.ok ? listed.value.map((campaign) => campaign.id) : []).toEqual([
      sourceId,
    ]);
  });

  it('rejects unsupported archive format versions', async () => {
    const {
      archivePath,
      dialogs,
      service,
      temporaryDirectory,
    } = await fixture();
    await service.exportCampaign({ id: sourceId });
    const unsupportedDirectory = path.join(temporaryDirectory, 'unsupported');
    await mkdir(unsupportedDirectory);
    await extractTar({
      cwd: unsupportedDirectory,
      file: archivePath,
      gzip: true,
      strict: true,
    });
    const manifestPath = path.join(unsupportedDirectory, 'export.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      formatVersion: number;
    };
    manifest.formatVersion = 14;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const unsupportedPath = path.join(
      temporaryDirectory,
      'unsupported.blackbox-campaign',
    );
    await createTar({
      cwd: unsupportedDirectory,
      file: unsupportedPath,
      gzip: true,
      portable: true,
      strict: true,
    }, ['export.json', 'campaign.sqlite', 'content/assets']);
    dialogs.chooseImportPath.mockResolvedValueOnce(unsupportedPath);

    await expect(service.importCampaign()).resolves.toEqual({
      error: {
        code: 'unsupported_archive',
        message: 'This campaign archive format is not supported.',
      },
      ok: false,
    });
  });

  it('directly converts the frozen format-1 Character fixture into current data', async () => {
    const {
      campaigns,
      dialogs,
      rootDirectory,
      service,
    } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-1.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toEqual({
      ok: true,
      value: {
        campaign: {
          createdAt: '2026-08-06T22:00:00.000Z',
          id: importedId,
          name: 'Format One Character',
          system: {
            id: 'dnd5e',
            settings: { defaultRulesVersion: '5.5e' },
          },
          updatedAt: now.toISOString(),
        },
        report: {
          sourceRelease: '1.0.0-format-1-fixture',
          warnings: [
            'Added empty Resources collections to 1 D&D character imported from archive format 1.',
            'Added empty Features collections to 1 D&D character imported from archive format 1.',
            'Added an empty Inventory to 1 D&D character imported from archive format 1.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 1.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 1.',
            'Removed Death Save counters from 1 D&D character imported from archive format 1.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 1.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 1.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });

    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    const row = importedDatabase.connection.prepare(
      `SELECT data_json FROM journal_entries
       WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
    ).get() as { data_json: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.data_json)).toMatchObject({
      abilities: { strength: { score: 14 } },
      identity: { className: 'Fighter', level: 5 },
      importantStats: { armorClass: '17' },
      features: [],
      inventory: {
        currency: { copper: 0, gold: 0, platinum: 0, silver: 0 },
        entries: [],
        variantEncumbrance: false,
      },
      resources: [],
    });
    importedDatabase.close();

    const listed = await campaigns.list();
    expect(listed.ok ? listed.value.map(({ name }) => name) : []).toContain(
      'Format One Character',
    );
  });

  it('imports the frozen format-3 fixture, which predates the entry permission counter', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-3.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toEqual({
      ok: true,
      value: {
        campaign: {
          createdAt: '2026-08-06T22:00:00.000Z',
          id: importedId,
          name: 'Format Three Character',
          system: {
            id: 'dnd5e',
            settings: { defaultRulesVersion: '5.5e' },
          },
          updatedAt: now.toISOString(),
        },
        report: {
          sourceRelease: '1.0.0-format-3-fixture',
          warnings: [
            'Added an empty Inventory to 1 D&D character imported from archive format 3.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 3.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 3.',
            'Removed Death Save counters from 1 D&D character imported from archive format 3.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 3.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 3.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });

    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    const row = importedDatabase.connection.prepare(
      `SELECT name, permission_revision, default_access FROM journal_entries
       WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
    ).get() as
      | { default_access: string; name: string; permission_revision: number }
      | undefined;
    // The entry keeps the access it was exported with and starts its counter.
    expect(row).toEqual({
      default_access: 'none',
      name: 'Archive Hero',
      permission_revision: 0,
    });
    const characterData = importedDatabase.connection.prepare(
      `SELECT data_json FROM journal_entries
       WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
    ).get() as { data_json: string };
    expect(JSON.parse(characterData.data_json).inventory).toEqual(
      createDefaultDnd5eCharacterData().inventory,
    );
    for (const [table, column] of [
      ['journal_entries', 'permission_revision'],
      ['assets', 'default_access'],
      ['assets', 'permission_revision'],
      ['scenes', 'default_access'],
      ['scenes', 'permission_revision'],
    ] as const) {
      const detail = importedDatabase.connection
        .prepare(`PRAGMA table_info('${table}')`)
        .all() as Array<{ dflt_value: unknown; name: string }>;
      expect(detail.find(({ name }) => name === column)?.dflt_value).toBeNull();
    }
    /* The converter adds canonical constraints, not merely columns with the
       right names. Invalid access and revisions must be rejected just as they
       are in a freshly created campaign. */
    expect(() => importedDatabase.connection.prepare(
      `UPDATE journal_entries SET permission_revision = -1
       WHERE name = 'Archive Hero'`,
    ).run()).toThrow();
    expect(() => importedDatabase.connection.prepare(
      `INSERT INTO assets (
         id, position, record_json, default_access, permission_revision
       ) VALUES (?, 0, '{}', 'share', 0)`,
    ).run('77777777-7777-4777-8777-777777777777')).toThrow();
    expect(() => importedDatabase.connection.prepare(
      `INSERT INTO scenes (
         id, position, record_json, default_access, permission_revision
       ) VALUES (?, 0, '{}', 'none', -1)`,
    ).run('88888888-8888-4888-8888-888888888888')).toThrow();
    importedDatabase.close();
  });

  it('directly converts the frozen format-2 Character fixture and preserves Resources', async () => {
    const {
      dialogs,
      rootDirectory,
      service,
    } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-2.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toEqual({
      ok: true,
      value: {
        campaign: {
          createdAt: '2026-08-06T22:00:00.000Z',
          id: importedId,
          name: 'Format Two Character',
          system: {
            id: 'dnd5e',
            settings: { defaultRulesVersion: '5.5e' },
          },
          updatedAt: now.toISOString(),
        },
        report: {
          sourceRelease: '1.0.0-format-2-fixture',
          warnings: [
            'Added empty Features collections to 1 D&D character imported from archive format 2.',
            'Added an empty Inventory to 1 D&D character imported from archive format 2.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 2.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 2.',
            'Removed Death Save counters from 1 D&D character imported from archive format 2.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 2.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 2.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });

    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    const row = importedDatabase.connection.prepare(
      `SELECT data_json FROM journal_entries
       WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
    ).get() as { data_json: string } | undefined;
    expect(JSON.parse(row!.data_json)).toMatchObject({
      features: [],
      inventory: createDefaultDnd5eCharacterData().inventory,
      resources: [{
        current: 2,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        maximum: 3,
        name: 'Archive Resource',
      }],
    });
    importedDatabase.close();
  });

  it('directly converts the untouched format-4 Character fixture into format 13', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-4.blackbox-campaign',
    ));

    const result = await service.importCampaign();

    expect(result).toMatchObject({
      ok: true,
      value: {
        campaign: { name: 'Format Three Character' },
        report: {
          sourceRelease: '1.0.0-format-4-fixture',
          warnings: [
            'Added an empty Inventory to 1 D&D character imported from archive format 4.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 4.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 4.',
            'Removed Death Save counters from 1 D&D character imported from archive format 4.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 4.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 4.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).inventory).toEqual(
        createDefaultDnd5eCharacterData().inventory,
      );
    } finally {
      importedDatabase.close();
    }
  });

  it('directly converts the untouched format-5 Character fixture into format 13', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-5.blackbox-campaign',
    ));

    const result = await service.importCampaign();

    expect(result).toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-5-fixture',
          warnings: [
            'Set quantity to 1 for 2 Inventory items across 1 D&D character imported from archive format 5.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 5.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 5.',
            'Removed Death Save counters from 1 D&D character imported from archive format 5.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 5.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 5.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).inventory).toMatchObject({
        currency: { copper: 25, gold: 12, platinum: 1, silver: 25 },
        entries: [
          { kind: 'item', quantity: 1, weight: 2 },
          {
            contents: [{ kind: 'item', quantity: 1, weight: 1 }],
            kind: 'container',
            weight: 3,
          },
        ],
      });
    } finally {
      importedDatabase.close();
    }
  });

  it('directly converts the untouched format-6 Character fixture into format 13', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-6.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-6-fixture',
          warnings: [
            'Added an empty Actions collection to 1 D&D character imported from archive format 6.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 6.',
            'Removed Death Save counters from 1 D&D character imported from archive format 6.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 6.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 6.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'Archive Hero'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).actions).toEqual([]);
    } finally {
      importedDatabase.close();
    }
  });

  it('directly converts the untouched format-7 Character fixture into format 13', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-7.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-dev',
          warnings: [
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 7.',
            'Removed Death Save counters from 1 D&D character imported from archive format 7.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 7.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 7.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'New Character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).skills).toEqual(
        createDefaultDnd5eCharacterData().skills,
      );
    } finally {
      importedDatabase.close();
    }
  });

  it('directly removes Death Save counters from the untouched format-8 fixture', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-8.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-8-fixture',
          warnings: [
            'Removed Death Save counters from 1 D&D character imported from archive format 8.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 8.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 8.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'New Character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).health).toEqual(
        createDefaultDnd5eCharacterData().health,
      );
    } finally {
      importedDatabase.close();
    }
  });

  it('directly adds Custom Skills to the untouched format-9 fixture', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-9.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-9-fixture',
          warnings: [
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 9.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 9.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'New Character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).customSkills).toEqual([]);
    } finally {
      importedDatabase.close();
    }
  });

  it('directly adds Spellcasting values to the untouched format-10 fixture', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-10.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-10-fixture',
          warnings: [
            'Added default Spellcasting values to 1 D&D character imported from archive format 10.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character' AND name = 'New Character'`,
      ).get() as { data_json: string };
      const imported = JSON.parse(row.data_json) as Dnd5eCharacterData;
      expect(imported.identity).toMatchObject({ className: 'Wizard' });
      expect(imported.spellcasting)
        .toEqual(createDefaultDnd5eCharacterSpellcasting('Wizard'));
    } finally {
      importedDatabase.close();
    }
  });

  it('directly replaces the untouched format-11 manual prepared count', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-11.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-11-fixture',
          warnings: [
            'Replaced manual Prepared Spells counts with empty spell lists for 1 D&D character imported from archive format 11; a count cannot identify specific Spell entries.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = importedDatabase.connection.prepare(
        `SELECT name, default_access, data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string; default_access: string; name: string };
      expect(row).toMatchObject({
        default_access: 'none',
        name: 'New Character',
      });
      expect((JSON.parse(row.data_json) as Dnd5eCharacterData).spellcasting)
        .toMatchObject({ spells: [] });
    } finally {
      importedDatabase.close();
    }
  });

  it('directly converts the untouched format-12 spell-era fixture', async () => {
    const { dialogs, rootDirectory, service } = await fixture();
    dialogs.chooseImportPath.mockResolvedValueOnce(path.resolve(
      'src/test/fixtures/archives/dnd5e-character-format-12.blackbox-campaign',
    ));

    await expect(service.importCampaign()).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          sourceRelease: '1.0.0-format-12-fixture',
          warnings: [
            'Replaced manual Prepared Spells counts with empty spell lists for 1 D&D character imported from archive format 12; a count cannot identify specific Spell entries.',
            'Server identity was not imported; a new TLS identity will be generated.',
          ],
        },
      },
    });
    const importedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const character = importedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries
         WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      expect((JSON.parse(character.data_json) as Dnd5eCharacterData)
        .spellcasting.spells).toEqual([]);
      expect(importedDatabase.connection.prepare(
        `SELECT name FROM journal_entries WHERE type_id = 'dnd5e.spell'`,
      ).get()).toEqual({ name: 'Shield' });
    } finally {
      importedDatabase.close();
    }
  });

  it('treats canceled dialogs as successful no-ops', async () => {
    const { campaigns, dialogs, service } = await fixture();
    dialogs.chooseExportPath.mockResolvedValueOnce(null);
    dialogs.chooseImportPath.mockResolvedValueOnce(null);

    await expect(service.exportCampaign({ id: sourceId })).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(service.importCampaign()).resolves.toEqual({
      ok: true,
      value: null,
    });
    const listed = await campaigns.list();
    expect(listed.ok ? listed.value : []).toHaveLength(1);
  });

  it('reports the reason an archive was turned away, not that something was wrong', async () => {
    const { archivePath, dialogs, service, temporaryDirectory } =
      await fixture();
    await service.exportCampaign({ id: sourceId });
    const strippedDirectory = path.join(temporaryDirectory, 'stripped');
    await mkdir(strippedDirectory);
    await extractTar({
      cwd: strippedDirectory,
      file: archivePath,
      gzip: true,
      strict: true,
    });
    const assetDirectory = path.join(strippedDirectory, 'content', 'assets');
    for (const entry of await readdir(assetDirectory)) {
      await rm(path.join(assetDirectory, entry), { force: true });
    }
    const strippedPath = path.join(
      temporaryDirectory,
      'stripped.blackbox-campaign',
    );
    await createTar(
      {
        cwd: strippedDirectory,
        file: strippedPath,
        gzip: true,
        portable: true,
        strict: true,
      },
      ['export.json', 'campaign.sqlite', 'content/assets'],
    );
    dialogs.chooseImportPath.mockResolvedValueOnce(strippedPath);

    await expect(service.importCampaign()).resolves.toEqual({
      error: {
        code: 'invalid_archive',
        message: 'This campaign’s Storage files do not match its records.',
      },
      ok: false,
    });
  });

  it('names the game system an archive needs rather than calling it invalid', async () => {
    const { archivePath, dialogs, service, temporaryDirectory } =
      await fixture();
    await service.exportCampaign({ id: sourceId });
    const foreignDirectory = path.join(temporaryDirectory, 'foreign');
    await mkdir(foreignDirectory);
    await extractTar({
      cwd: foreignDirectory,
      file: archivePath,
      gzip: true,
      strict: true,
    });
    const connection = new DatabaseSync(
      path.join(foreignDirectory, 'campaign.sqlite'),
    );
    connection
      .prepare(
        `UPDATE campaign_system SET system_id = 'pathfinder'
         WHERE singleton = 1`,
      )
      .run();
    connection.close();
    const foreignPath = path.join(
      temporaryDirectory,
      'foreign.blackbox-campaign',
    );
    await createTar(
      {
        cwd: foreignDirectory,
        file: foreignPath,
        gzip: true,
        portable: true,
        strict: true,
      },
      ['export.json', 'campaign.sqlite', 'content/assets'],
    );
    dialogs.chooseImportPath.mockResolvedValueOnce(foreignPath);

    /* Import and salvage reach this through different doors and must give the
       reader the same answer: install a build with the system, not repair a
       file that is not broken. */
    await expect(service.importCampaign()).resolves.toEqual({
      error: {
        code: 'unsupported_system',
        message:
          'This campaign’s game system (“pathfinder”) is not one this ' +
          'version of BlackBox VTT can open.',
      },
      ok: false,
    });
  });

  it('salvages an unreadable campaign directory and trashes what it replaced', async () => {
    const { campaigns, rootDirectory, service, trashItem } = await fixture();
    const directory = await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-3.blackbox-campaign',
    );
    const before = await campaigns.list();
    expect(before.ok ? before.value.map(({ name }) => name) : []).toContain(
      'Unavailable campaign (55555555)',
    );

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toEqual({
      ok: true,
      value: {
        campaign: {
          createdAt: '2026-08-06T22:00:00.000Z',
          id: importedId,
          name: 'Format Three Character',
          system: {
            id: 'dnd5e',
            settings: { defaultRulesVersion: '5.5e' },
          },
          updatedAt: now.toISOString(),
        },
        originalTrashed: true,
        report: {
          detectedFormat: 3,
          warnings: [
            'Added an empty Inventory to 1 D&D character imported from archive format 3.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 3.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 3.',
            'Removed Death Save counters from 1 D&D character imported from archive format 3.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 3.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 3.',
            salvagedIdentityWarning,
          ],
        },
      },
    });

    expect(trashItem).toHaveBeenCalledWith(directory);
    /* Opening validates the whole schema, so reaching here already proves the
       campaign came back in today's shape rather than the one on disk. */
    const salvagedDatabase = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      expect(
        salvagedDatabase.connection
          .prepare(
            `SELECT name FROM journal_entries WHERE type_id = 'dnd5e.character'`,
          )
          .get(),
      ).toEqual({ name: 'Archive Hero' });
      const row = salvagedDatabase.connection.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).inventory).toEqual(
        createDefaultDnd5eCharacterData().inventory,
      );
    } finally {
      salvagedDatabase.close();
    }
  });

  it('salvages format-5 item quantities into the current Character shape', async () => {
    const { rootDirectory, service } = await fixture();
    await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-5.blackbox-campaign',
    );

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        originalTrashed: true,
        report: {
          detectedFormat: 5,
          warnings: [
            'Set quantity to 1 for 2 Inventory items across 1 D&D character imported from archive format 5.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 5.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 5.',
            'Removed Death Save counters from 1 D&D character imported from archive format 5.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 5.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 5.',
            salvagedIdentityWarning,
          ],
        },
      },
    });

    const salvaged = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      const row = salvaged.connection.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).inventory.entries).toMatchObject([
        { kind: 'item', quantity: 1 },
        { contents: [{ kind: 'item', quantity: 1 }], kind: 'container' },
      ]);
    } finally {
      salvaged.close();
    }
  });

  it('salvages exact format-6 Characters by supplying empty Actions', async () => {
    const { rootDirectory, service } = await fixture();
    await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-6.blackbox-campaign',
    );

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        originalTrashed: true,
        report: {
          detectedFormat: 6,
          warnings: [
            'Added an empty Actions collection to 1 D&D character imported from archive format 6.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 6.',
            'Removed Death Save counters from 1 D&D character imported from archive format 6.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 6.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 6.',
            salvagedIdentityWarning,
          ],
        },
      },
    });

    const salvaged = CampaignDatabase.open(path.join(rootDirectory, importedId));
    try {
      const row = salvaged.connection.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      expect(JSON.parse(row.data_json).actions).toEqual([]);
    } finally {
      salvaged.close();
    }
  });

  it('recognizes and directly salvages the format-12 spell era', async () => {
    const { rootDirectory, service } = await fixture();
    await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-12.blackbox-campaign',
    );

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        report: {
          detectedFormat: 12,
          warnings: [
            'Replaced manual Prepared Spells counts with empty spell lists for 1 D&D character imported from archive format 12; a count cannot identify specific Spell entries.',
            salvagedIdentityWarning,
          ],
        },
      },
    });
  });

  it('salvages the intermediate permission schema without losing access data', async () => {
    const { rootDirectory, service } = await fixture();
    const directory = await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-3.blackbox-campaign',
    );
    const intermediate = new DatabaseSync(
      path.join(directory, 'campaign.sqlite'),
    );
    addIntermediatePermissionSchema(intermediate);
    intermediate.prepare(
      `UPDATE journal_entries
       SET default_access = 'edit', permission_revision = 9
       WHERE name = 'Archive Hero'`,
    ).run();
    intermediate.close();

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        campaign: { name: 'Format Three Character' },
        originalTrashed: true,
        report: {
          detectedFormat: 4,
          warnings: [
            'Added an empty Inventory to 1 D&D character imported from archive format 4.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 4.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 4.',
            'Removed Death Save counters from 1 D&D character imported from archive format 4.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 4.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 4.',
            salvagedIdentityWarning,
          ],
        },
      },
    });

    const salvaged = CampaignDatabase.open(
      path.join(rootDirectory, importedId),
    );
    try {
      expect(salvaged.connection.prepare(
        `SELECT default_access, permission_revision
         FROM journal_entries WHERE name = 'Archive Hero'`,
      ).get()).toEqual({
        default_access: 'edit',
        permission_revision: 9,
      });
      for (const [table, column] of [
        ['journal_entries', 'permission_revision'],
        ['assets', 'default_access'],
        ['assets', 'permission_revision'],
        ['scenes', 'default_access'],
        ['scenes', 'permission_revision'],
      ] as const) {
        const columns = salvaged.connection
          .prepare(`PRAGMA table_info('${table}')`)
          .all() as Array<{ dflt_value: unknown; name: string }>;
        expect(
          columns.find(({ name }) => name === column)?.dflt_value,
        ).toBeNull();
      }
    } finally {
      salvaged.close();
    }
  });

  it('keeps the unreadable source available when moving it to trash fails', async () => {
    const { campaigns, rootDirectory, service } = await fixture();
    await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-3.blackbox-campaign',
    );
    vi.spyOn(campaigns, 'trash').mockResolvedValue({
      error: {
        code: 'storage_error',
        message: 'Campaign could not be moved to the trash.',
      },
      ok: false,
    });

    const result = await service.salvageCampaign({ id: unreadableId });

    expect(result).toMatchObject({
      ok: true,
      value: {
        originalTrashed: false,
        report: {
          warnings: [
            'Added an empty Inventory to 1 D&D character imported from archive format 3.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 3.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 3.',
            'Removed Death Save counters from 1 D&D character imported from archive format 3.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 3.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 3.',
            salvagedIdentityWarning,
            'The unreadable campaign could not be moved to the trash; ' +
              'delete it from the campaign list.',
          ],
        },
      },
    });
    const listed = await campaigns.list();
    expect(listed.ok ? listed.value.map(({ id }) => id) : []).toEqual(
      expect.arrayContaining([unreadableId, importedId]),
    );
  });

  it('carries conversion warnings through a salvage', async () => {
    const { rootDirectory, service } = await fixture();
    await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-1.blackbox-campaign',
    );

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        campaign: { name: 'Format One Character' },
        report: {
          detectedFormat: 1,
          warnings: [
            'Added empty Resources collections to 1 D&D character imported from archive format 1.',
            'Added empty Features collections to 1 D&D character imported from archive format 1.',
            'Added an empty Inventory to 1 D&D character imported from archive format 1.',
            'Added an empty Actions collection to 1 D&D character imported from archive format 1.',
            'Added zero Skill bonus and passive-score adjustments to 1 D&D character imported from archive format 1.',
            'Removed Death Save counters from 1 D&D character imported from archive format 1.',
            'Added an empty Custom Skills collection to 1 D&D character imported from archive format 1.',
            'Added default Spellcasting values to 1 D&D character imported from archive format 1.',
            salvagedIdentityWarning,
          ],
        },
      },
    });
  });

  it('refuses a campaign whose structure is already current', async () => {
    const { campaigns, service, trashItem } = await fixture();

    await expect(service.salvageCampaign({ id: sourceId })).resolves.toEqual({
      error: {
        code: 'unsalvageable',
        message:
          'This campaign’s structure is already current, so an outdated ' +
          'format is not what makes it unreadable.',
      },
      ok: false,
    });
    /* A refusal costs the Game Master nothing: the campaign it declined to
       rebuild is still exactly where it was. */
    expect(trashItem).not.toHaveBeenCalled();
    const listed = await campaigns.list();
    expect(listed.ok ? listed.value.map(({ id }) => id) : []).toEqual([
      sourceId,
    ]);
  });

  it('names the game system it cannot open rather than refusing blankly', async () => {
    const { rootDirectory, service } = await fixture();
    const directory = await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-3.blackbox-campaign',
    );
    const connection = new DatabaseSync(
      path.join(directory, 'campaign.sqlite'),
    );
    connection
      .prepare(
        `UPDATE campaign_system SET system_id = 'pathfinder'
         WHERE singleton = 1`,
      )
      .run();
    connection.close();

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toEqual({
      error: {
        code: 'unsupported_system',
        message:
          'This campaign’s game system (“pathfinder”) is not one this ' +
          'version of BlackBox VTT can open.',
      },
      ok: false,
    });
  });

  it('marks a salvaged copy as salvaged when its name is already taken', async () => {
    const { rootDirectory, service } = await fixture();
    const directory = await layUnreadableCampaign(
      rootDirectory,
      'dnd5e-character-format-3.blackbox-campaign',
    );
    const connection = new DatabaseSync(
      path.join(directory, 'campaign.sqlite'),
    );
    connection
      .prepare(
        `UPDATE campaign_metadata SET name = 'Iron Meridian'
         WHERE singleton = 1`,
      )
      .run();
    connection.close();

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { campaign: { name: 'Iron Meridian (Salvaged)' } },
    });
  });

  it('refuses a campaign that is not there', async () => {
    const { service } = await fixture();

    await expect(
      service.salvageCampaign({ id: unreadableId }),
    ).resolves.toEqual({
      error: { code: 'not_found', message: 'Campaign could not be found.' },
      ok: false,
    });
  });
});
