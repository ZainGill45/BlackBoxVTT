import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerConfigRepository } from '../../../../main/network/serverConfigRepository';
import { verifyPassword } from '../../../../main/network/passwords';
import {
  CAMPAIGN_DATABASE_FILENAME,
  CampaignDatabase,
} from '../../../../main/storage/campaignDatabase';
import { CAMPAIGN_SCHEMA_VERSION } from '../../../../shared/campaigns';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';

const temporaryDirectories: string[] = [];
const databases: CampaignDatabase[] = [];
const campaignId = '11111111-1111-4111-8111-111111111111';

async function createCampaignDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-network-'));
  temporaryDirectories.push(directory);
  const timestamp = '2026-07-31T12:00:00.000Z';
  const database = CampaignDatabase.create(directory, {
    createdAt: timestamp,
    id: campaignId,
    name: 'Iron Meridian',
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: timestamp,
  });
  databases.push(database);
  return { database, directory };
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('ServerConfigRepository', () => {
  it('persists normalized users with scrypt hashes and no plaintext password', async () => {
    const { database, directory } = await createCampaignDatabase();
    const repository = new ServerConfigRepository(database);
    const created = await repository.createUser('  \uFF21lice  ', ' secret ');

    expect(created.ok && created.value.username).toBe('Alice');
    const config = await repository.load();
    expect(config.users[0].password.algorithm).toBe('scrypt');
    expect(
      await verifyPassword(' secret ', config.users[0].password),
    ).toBe(true);
    expect(
      await readFile(
        path.join(directory, CAMPAIGN_DATABASE_FILENAME),
        'utf8',
      ),
    ).not.toContain(' secret ');
  });

  it('rejects duplicate normalized usernames and enforces setting bounds', async () => {
    const { database } = await createCampaignDatabase();
    const repository = new ServerConfigRepository(database);
    await repository.createUser('Alice', 'one');
    const duplicate = await repository.createUser(' alice ', 'two');

    expect(duplicate.ok).toBe(false);
    expect(await repository.setPort(0)).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(await repository.setTransformPreviewRate(129)).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(
      await repository.setMaxChatMessageCharacters(99),
    ).toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    expect(
      await repository.setMaxChatMessageCharacters(50_000),
    ).toEqual({ ok: true, value: 50_000 });
    expect((await repository.load()).maxChatMessageCharacters).toBe(50_000);
  });

  it('initializes all settings with their current defaults', async () => {
    const { database } = await createCampaignDatabase();
    const repository = new ServerConfigRepository(database);

    expect(await repository.load()).toEqual({
      maxChatMessageCharacters: 10_000,
      port: 30_000,
      schemaVersion: 3,
      transformPreviewRate: 60,
      users: [],
    });
  });
});
