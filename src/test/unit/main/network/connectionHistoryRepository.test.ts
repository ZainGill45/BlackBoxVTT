import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionHistoryRepository } from '../../../../main/network/connectionHistoryRepository';

const temporaryDirectories: string[] = [];
const campaignId = '11111111-1111-4111-8111-111111111111';
const aliceId = '22222222-2222-4222-8222-222222222222';
const bobId = '33333333-3333-4333-8333-333333333333';

const secureStorage = {
  async decryptStringAsync(encrypted: Buffer) {
    return {
      result: Buffer.from(
        encrypted.toString('utf8').replace(/^cipher:/, ''),
        'base64',
      ).toString('utf8'),
      shouldReEncrypt: false,
    };
  },
  async encryptStringAsync(value: string) {
    return Buffer.from(
      `cipher:${Buffer.from(value, 'utf8').toString('base64')}`,
      'utf8',
    );
  },
};

let historyPath: string;
let repository: ConnectionHistoryRepository;

beforeEach(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-history-'));
  temporaryDirectories.push(directory);
  historyPath = path.join(directory, 'connections.json');
  repository = new ConnectionHistoryRepository(historyPath, secureStorage);

  const common = {
    campaignId,
    campaignName: 'Iron Meridian',
    certificateFingerprint: 'AA:BB',
    host: 'vtt.example',
    port: 30_000,
  };
  await repository.commitSuccessfulConnection({
    ...common,
    password: 'alice secret',
    userId: aliceId,
    username: 'Alice',
  });
  await repository.commitSuccessfulConnection({
    ...common,
    password: 'bob secret',
    userId: bobId,
    username: 'Bob',
  });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('ConnectionHistoryRepository profiles', () => {
  it('keeps every account that has signed in to the campaign', async () => {
    const listed = await repository.list();

    expect(listed.ok && listed.value[0].profiles).toEqual([
      { hasSavedPassword: true, userId: aliceId, username: 'Alice' },
      { hasSavedPassword: true, userId: bobId, username: 'Bob' },
    ]);
  });

  it('returns the saved password for the account that owns it', async () => {
    expect(await repository.getPassword(campaignId, aliceId)).toBe(
      'alice secret',
    );
  });

  it('never writes a password to disk in the clear', async () => {
    expect(await readFile(historyPath, 'utf8')).not.toContain('alice secret');
  });
});

describe('ConnectionHistoryRepository trust', () => {
  it('remembers the certificate the campaign was trusted with', async () => {
    expect((await repository.find(campaignId))?.certificateFingerprint).toBe(
      'AA:BB',
    );
  });

  it('discards trust along with the history when the entry is deleted', async () => {
    await repository.delete(campaignId);

    expect(await repository.find(campaignId)).toBeNull();
  });
});
