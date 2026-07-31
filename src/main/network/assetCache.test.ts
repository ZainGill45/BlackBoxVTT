import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_CHUNK_BYTES,
  ASSET_MANIFEST_SCHEMA_VERSION,
  type AssetManifest,
  type AssetRecord,
} from '../../shared/assets';
import { RemoteAssetCache } from './assetCache';

const roots: string[] = [];

function createRecord(bytes: Buffer): AssetRecord {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += ASSET_CHUNK_BYTES) {
    chunks.push(bytes.subarray(offset, offset + ASSET_CHUNK_BYTES));
  }
  return {
    chunkHashes: chunks.map((chunk) =>
      createHash('sha256').update(chunk).digest('hex'),
    ),
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'player',
    displayName: 'Map.png',
    extension: 'png',
    fileModifiedAtMs: 0,
    format: 'png',
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'image',
    lastModifiedAt: '2026-01-01T00:00:00.000Z',
    lastModifiedBy: 'player',
    mimeType: 'image/png',
    originalFilename: 'Map.png',
    revision: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('RemoteAssetCache', () => {
  it('downloads verified chunks once and uses the verified fast path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blackbox-cache-test-'));
    roots.push(root);
    const bytes = Buffer.alloc(ASSET_CHUNK_BYTES + 31, 7);
    const asset = createRecord(bytes);
    const manifest: AssetManifest = {
      assets: [asset],
      revision: 1,
      schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
    };
    const cache = new RemoteAssetCache(
      root,
      '22222222-2222-4222-8222-222222222222',
    );
    const fetchChunk = vi.fn(async (_asset: AssetRecord, index: number) => {
      const data = bytes.subarray(
        index * ASSET_CHUNK_BYTES,
        (index + 1) * ASSET_CHUNK_BYTES,
      );
      return { data, hash: asset.chunkHashes[index], index };
    });

    await cache.synchronize(manifest, fetchChunk, vi.fn());
    expect(fetchChunk).toHaveBeenCalledTimes(2);
    expect(await cache.getAssetPath(asset)).not.toBeNull();

    fetchChunk.mockClear();
    await cache.synchronize(manifest, fetchChunk, vi.fn());
    expect(fetchChunk).not.toHaveBeenCalled();
  });

  it('retains verified partial chunks and resumes missing chunks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blackbox-cache-test-'));
    roots.push(root);
    const bytes = Buffer.alloc(ASSET_CHUNK_BYTES + 10, 4);
    const asset = createRecord(bytes);
    const manifest: AssetManifest = {
      assets: [asset],
      revision: 1,
      schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
    };
    const cache = new RemoteAssetCache(
      root,
      '33333333-3333-4333-8333-333333333333',
    );
    let failSecond = true;
    const fetchChunk = vi.fn(async (_asset: AssetRecord, index: number) => {
      if (index === 1 && failSecond) {
        throw new Error('offline');
      }
      const data = bytes.subarray(
        index * ASSET_CHUNK_BYTES,
        (index + 1) * ASSET_CHUNK_BYTES,
      );
      return { data, hash: asset.chunkHashes[index], index };
    });

    await expect(
      cache.synchronize(manifest, fetchChunk, vi.fn()),
    ).rejects.toThrow('offline');
    failSecond = false;
    fetchChunk.mockClear();
    await cache.synchronize(manifest, fetchChunk, vi.fn());

    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(fetchChunk).toHaveBeenCalledWith(asset, 1);
  });
});
