import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CampaignIdentityRepository } from '../../../../main/network/campaignIdentity';

const temporaryDirectories: string[] = [];

let repository: CampaignIdentityRepository;

beforeEach(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-identity-'));
  temporaryDirectories.push(directory);
  repository = new CampaignIdentityRepository(
    directory,
    '11111111-1111-4111-8111-111111111111',
    'Iron Meridian',
  );
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('CampaignIdentityRepository', () => {
  it('publishes a fingerprint players can compare by eye', async () => {
    const identity = await repository.loadOrCreate();

    expect(identity.certificateFingerprint).toMatch(
      /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    );
  });

  it('reuses the stored identity instead of minting a new one', async () => {
    const first = await repository.loadOrCreate();
    const second = await repository.loadOrCreate();

    // Regenerating would invalidate every trust decision players have saved.
    expect(second).toEqual(first);
  });

  it('issues an elliptic-curve certificate', async () => {
    const identity = await repository.loadOrCreate();

    const certificate = new X509Certificate(identity.certificatePem);
    expect(certificate.publicKey.asymmetricKeyType).toBe('ec');
  });

  it('issues a leaf certificate rather than a signing authority', async () => {
    const identity = await repository.loadOrCreate();

    const certificate = new X509Certificate(identity.certificatePem);
    expect(certificate.ca).toBe(false);
  });
});
