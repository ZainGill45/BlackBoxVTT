import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from '../../../main/campaignRepository';
import {
  CAMPAIGN_DATABASE_FILENAME,
  CampaignDatabase,
} from '../../../main/storage/campaignDatabase';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-07-26T04:00:00.000Z');
const temporaryDirectories: string[] = [];

async function createTemporaryRoot() {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'blackboxvtt-campaigns-'),
  );
  temporaryDirectories.push(temporaryDirectory);
  return path.join(temporaryDirectory, 'campaigns');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('CampaignRepository', () => {
  it('creates durable campaign metadata and a content container', async () => {
    const rootDirectory = await createTemporaryRoot();
    const repository = new CampaignRepository({
      createId: () => firstId,
      now: () => createdAt,
      rootDirectory,
      trashItem: vi.fn(),
    });

    const result = await repository.create({ name: '  Iron Meridian  ' });

    expect(result).toEqual({
      ok: true,
      value: {
        createdAt: createdAt.toISOString(),
        id: firstId,
        name: 'Iron Meridian',
        system: TEST_CAMPAIGN_SYSTEM,
        updatedAt: createdAt.toISOString(),
      },
    });
    await expect(
      readdir(path.join(rootDirectory, firstId, 'content')),
    ).resolves.toEqual([]);

    const database = CampaignDatabase.open(
      path.join(rootDirectory, firstId),
    );
    const manifest = database.readManifest();
    database.close();
    expect(manifest).toEqual(result.ok ? result.value : undefined);

    const restartedRepository = new CampaignRepository({
      rootDirectory,
      trashItem: vi.fn(),
    });
    await expect(restartedRepository.list()).resolves.toEqual({
      ok: true,
      value: [manifest],
    });
  });

  it('rejects normalized case-insensitive duplicate names', async () => {
    const rootDirectory = await createTemporaryRoot();
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem: vi.fn(),
    });

    await repository.create({ name: 'Iron Meridian' });
    const duplicate = await repository.create({
      name: '  ＩＲＯＮ ＭＥＲＩＤＩＡＮ  ',
    });

    expect(duplicate).toEqual({
      error: {
        code: 'duplicate_name',
        message: 'A campaign named “IRON MERIDIAN” already exists.',
      },
      ok: false,
    });
  });

  it('rejects an unsupported bundled system before creating a campaign', async () => {
    const rootDirectory = await createTemporaryRoot();
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem: vi.fn(),
    });

    await expect(
      repository.create({ name: 'Iron Meridian', systemId: 'unknown' }),
    ).resolves.toEqual({
      error: {
        code: 'unsupported_system',
        message: 'The selected game system is not supported.',
      },
      ok: false,
    });
    await expect(access(rootDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses malformed campaign system settings', async () => {
    const rootDirectory = await createTemporaryRoot();
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem: vi.fn(),
    });
    await repository.create({ name: 'Iron Meridian' });
    const directory = path.join(rootDirectory, firstId);
    const database = CampaignDatabase.open(directory);
    database.connection
      .prepare('UPDATE campaign_system SET settings_json = ? WHERE singleton = 1')
      .run(JSON.stringify({ defaultRulesVersion: 'invalid' }));
    database.close();

    expect(() => CampaignDatabase.open(directory)).toThrow(
      /unsupported or invalid/i,
    );
  });

  it('sorts campaigns by updated time and then ID', async () => {
    const rootDirectory = await createTemporaryRoot();
    const ids = [secondId, firstId];
    const timestamps = [
      new Date('2026-07-26T03:00:00.000Z'),
      new Date('2026-07-26T05:00:00.000Z'),
    ];
    const repository = new CampaignRepository({
      createId: () => ids.shift() ?? firstId,
      now: () => timestamps.shift() ?? createdAt,
      rootDirectory,
      trashItem: vi.fn(),
    });

    await repository.create({ name: 'Older' });
    await repository.create({ name: 'Newer' });

    const result = await repository.list();
    expect(result.ok && result.value.map((campaign) => campaign.name)).toEqual([
      'Newer',
      'Older',
    ]);
  });

  it('lists malformed campaign containers as unavailable', async () => {
    const rootDirectory = await createTemporaryRoot();
    const warn = vi.fn();
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem: vi.fn(),
      warn,
    });

    await repository.create({ name: 'Valid campaign' });
    await mkdir(path.join(rootDirectory, secondId));
    await writeFile(
      path.join(rootDirectory, secondId, CAMPAIGN_DATABASE_FILENAME),
      'not a database',
    );

    const result = await repository.list();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(2);
    expect(result.value.find((campaign) => campaign.id === secondId)).toEqual(
      expect.objectContaining({
        id: secondId,
        name: 'Unavailable campaign (22222222)',
        unavailableReason: 'unsupported_data',
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(secondId),
      expect.any(Error),
    );
  });

  it('rejects invalid IDs before resolving a trash target', async () => {
    const rootDirectory = await createTemporaryRoot();
    const trashItem = vi.fn();
    const repository = new CampaignRepository({
      rootDirectory,
      trashItem,
    });

    await expect(repository.trash({ id: '../outside' })).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'Campaign could not be found.',
      },
      ok: false,
    });
    expect(trashItem).not.toHaveBeenCalled();
  });

  it('allows an unavailable campaign directory to be trashed', async () => {
    const rootDirectory = await createTemporaryRoot();
    const trashItem = vi.fn();
    await mkdir(path.join(rootDirectory, firstId), { recursive: true });
    await writeFile(
      path.join(rootDirectory, firstId, CAMPAIGN_DATABASE_FILENAME),
      'not a database',
    );
    const repository = new CampaignRepository({
      rootDirectory,
      trashItem,
    });

    await expect(repository.trash({ id: firstId })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(trashItem).toHaveBeenCalledWith(
      path.resolve(rootDirectory, firstId),
    );
  });

  it('keeps a campaign when trashing fails and targets its exact folder', async () => {
    const rootDirectory = await createTemporaryRoot();
    const trashItem = vi.fn().mockRejectedValue(new Error('trash failed'));
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem,
      warn: vi.fn(),
    });

    await repository.create({ name: 'Iron Meridian' });
    const result = await repository.trash({ id: firstId });

    expect(result).toEqual({
      error: {
        code: 'storage_error',
        message: 'Campaign could not be deleted.',
      },
      ok: false,
    });
    expect(trashItem).toHaveBeenCalledWith(
      path.resolve(rootDirectory, firstId),
    );
    await expect(access(path.join(rootDirectory, firstId))).resolves.toBe(
      undefined,
    );
  });

  it('moves a validated campaign container to the trash', async () => {
    const rootDirectory = await createTemporaryRoot();
    const trashItem = vi.fn(async (targetPath: string) => {
      await rm(targetPath, { recursive: true });
    });
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem,
    });

    await repository.create({ name: 'Iron Meridian' });

    await expect(repository.trash({ id: firstId })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(trashItem).toHaveBeenCalledWith(
      path.resolve(rootDirectory, firstId),
    );
    await expect(access(path.join(rootDirectory, firstId))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('cleans its staging directory when finalization fails', async () => {
    const rootDirectory = await createTemporaryRoot();
    await mkdir(path.join(rootDirectory, firstId), { recursive: true });
    await writeFile(
      path.join(rootDirectory, firstId, 'occupied.txt'),
      'occupied',
      'utf8',
    );
    const repository = new CampaignRepository({
      createId: () => firstId,
      rootDirectory,
      trashItem: vi.fn(),
      warn: vi.fn(),
    });

    const result = await repository.create({ name: 'Iron Meridian' });

    expect(result.ok).toBe(false);
    expect(await readdir(rootDirectory)).not.toContain(`.creating-${firstId}`);
  });

  it('surfaces repository-level read failures', async () => {
    const temporaryDirectory = await createTemporaryRoot();
    const repositoryRoot = path.join(temporaryDirectory, 'not-a-directory');
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(repositoryRoot, 'file', 'utf8');
    const repository = new CampaignRepository({
      rootDirectory: repositoryRoot,
      trashItem: vi.fn(),
      warn: vi.fn(),
    });

    await expect(repository.list()).resolves.toEqual({
      error: {
        code: 'storage_error',
        message: 'Campaigns could not be loaded.',
      },
      ok: false,
    });
  });
});
