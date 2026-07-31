import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CampaignIdentityRepository } from './campaignIdentity';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('CampaignIdentityRepository', () => {
  it('creates and reuses a persistent ECDSA P-256 identity', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'blackbox-identity-'),
    );
    temporaryDirectories.push(directory);
    const repository = new CampaignIdentityRepository(
      directory,
      '11111111-1111-4111-8111-111111111111',
      'Iron Meridian',
    );

    const first = await repository.loadOrCreate();
    const second = await repository.loadOrCreate();
    const certificate = new X509Certificate(first.certificatePem);

    expect(first.certificateFingerprint).toMatch(
      /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    );
    expect(second).toEqual(first);
    expect(certificate.publicKey.asymmetricKeyType).toBe('ec');
    expect(certificate.ca).toBe(false);
  });
});
