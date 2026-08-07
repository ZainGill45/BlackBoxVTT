import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create as createTar, extract as extractTar } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetRepository } from '../../../main/assetRepository';
import { CampaignArchiveService } from '../../../main/campaignArchiveService';
import { CampaignRepository } from '../../../main/campaignRepository';
import { JournalRepository } from '../../../main/journalRepository';
import type { SceneRepository } from '../../../main/sceneRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import {
  createDefaultDnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';

const sourceId = '11111111-1111-4111-8111-111111111111';
const importedId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-06T22:00:00.000Z');
const temporaryDirectories: string[] = [];

async function fixture() {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'blackbox-campaign-archive-test-'),
  );
  temporaryDirectories.push(temporaryDirectory);
  const rootDirectory = path.join(temporaryDirectory, 'campaigns');
  const campaigns = new CampaignRepository({
    createId: () => sourceId,
    now: () => new Date('2026-08-01T12:00:00.000Z'),
    rootDirectory,
    trashItem: vi.fn(),
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
  const journal = new JournalRepository({
    assets,
    createId: () => '44444444-4444-4444-8444-444444444444',
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
    ))).toMatchObject({ formatVersion: 3 });

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
    manifest.formatVersion = 4;
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
      resources: [],
    });
    importedDatabase.close();

    const listed = await campaigns.list();
    expect(listed.ok ? listed.value.map(({ name }) => name) : []).toContain(
      'Format One Character',
    );
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
      resources: [{
        current: 2,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        maximum: 3,
        name: 'Archive Resource',
      }],
    });
    importedDatabase.close();
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
});
