import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionHistoryRepository } from './connectionHistoryRepository';

const temporaryDirectories: string[] = [];
const campaignId = '11111111-1111-4111-8111-111111111111';

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('ConnectionHistoryRepository', () => {
  it('keeps multiple encrypted profiles and deletes trust with history', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'blackbox-history-'),
    );
    temporaryDirectories.push(directory);
    const historyPath = path.join(directory, 'connections.json');
    const repository = new ConnectionHistoryRepository(
      historyPath,
      secureStorage,
    );
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
      userId: '22222222-2222-4222-8222-222222222222',
      username: 'Alice',
    });
    await repository.commitSuccessfulConnection({
      ...common,
      password: 'bob secret',
      userId: '33333333-3333-4333-8333-333333333333',
      username: 'Bob',
    });

    const listed = await repository.list();
    expect(listed.ok && listed.value[0].profiles).toEqual([
      {
        hasSavedPassword: true,
        userId: '22222222-2222-4222-8222-222222222222',
        username: 'Alice',
      },
      {
        hasSavedPassword: true,
        userId: '33333333-3333-4333-8333-333333333333',
        username: 'Bob',
      },
    ]);
    expect(
      await repository.getPassword(
        campaignId,
        '22222222-2222-4222-8222-222222222222',
      ),
    ).toBe('alice secret');
    expect(await readFile(historyPath, 'utf8')).not.toContain('alice secret');
    expect((await repository.find(campaignId))?.certificateFingerprint).toBe(
      'AA:BB',
    );

    await repository.delete(campaignId);
    expect(await repository.find(campaignId)).toBeNull();
  });
});
