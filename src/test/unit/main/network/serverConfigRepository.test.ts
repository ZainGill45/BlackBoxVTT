import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerConfigRepository } from '../../../../main/network/serverConfigRepository';
import { verifyPassword } from '../../../../main/network/passwords';

const temporaryDirectories: string[] = [];

async function createCampaignDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-network-'));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, 'content'));
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('ServerConfigRepository', () => {
  it('persists normalized users with scrypt hashes and no plaintext password', async () => {
    const directory = await createCampaignDirectory();
    const repository = new ServerConfigRepository(directory);
    const created = await repository.createUser('  \uFF21lice  ', ' secret ');

    expect(created.ok && created.value.username).toBe('Alice');
    const config = await repository.load();
    expect(config.users[0].password.algorithm).toBe('scrypt');
    expect(
      await verifyPassword(' secret ', config.users[0].password),
    ).toBe(true);
    expect(
      await readFile(path.join(directory, 'content', 'server.json'), 'utf8'),
    ).not.toContain(' secret ');
  });

  it('rejects duplicate normalized usernames and enforces port bounds', async () => {
    const repository = new ServerConfigRepository(
      await createCampaignDirectory(),
    );
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

  it('persists the default preview rate while migrating version-one configs', async () => {
    const directory = await createCampaignDirectory();
    const configPath = path.join(directory, 'content', 'server.json');
    await writeFile(
      configPath,
      JSON.stringify({ port: 31_000, schemaVersion: 1, users: [] }),
      'utf8',
    );
    const repository = new ServerConfigRepository(directory);

    expect(await repository.load()).toMatchObject({
      maxChatMessageCharacters: 10_000,
      port: 31_000,
      schemaVersion: 3,
      transformPreviewRate: 60,
    });
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      maxChatMessageCharacters: 10_000,
      schemaVersion: 3,
      transformPreviewRate: 60,
    });
  });
});
