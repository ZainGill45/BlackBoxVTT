import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetPreviewRegistry } from '../../../main/assetPreviewRegistry';

const directories: string[] = [];
const assetId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';

let filePath: string;
let registry: AssetPreviewRegistry;
let token: string;
let url: string;

beforeEach(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-preview-test-'));
  directories.push(directory);
  filePath = path.join(directory, 'asset.txt');
  await writeFile(filePath, '0123456789', 'utf8');

  registry = new AssetPreviewRegistry();
  token = registry.create({
    assetId,
    campaignId,
    filePath,
    mimeType: 'text/plain',
  });
  url = `blackbox-asset://${token}/${assetId}`;
});

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('AssetPreviewRegistry full responses', () => {
  it('serves the whole asset with its recorded type', async () => {
    const full = await registry.handle(new Request(url));

    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('text/plain');
    expect(await full.text()).toBe('0123456789');
  });

  it('allows the renderer to read the response cross-origin', async () => {
    const full = await registry.handle(new Request(url));

    expect(full.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('AssetPreviewRegistry ranged responses', () => {
  it('returns only the requested byte range', async () => {
    const range = await registry.handle(
      new Request(url, { headers: { Range: 'bytes=2-5' } }),
    );

    expect(range.status).toBe(206);
    expect(await range.text()).toBe('2345');
  });

  it('reports the range it served against the total size', async () => {
    const range = await registry.handle(
      new Request(url, { headers: { Range: 'bytes=2-5' } }),
    );

    // Media playback seeks against this header, so the total has to be exact.
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
  });
});

describe('AssetPreviewRegistry grants', () => {
  it('stops serving the asset once its grant is released', async () => {
    registry.release(token);

    await expect(registry.handle(new Request(url))).resolves.toMatchObject({
      status: 404,
    });
  });
});

describe('AssetPreviewRegistry prepared payloads', () => {
  const cacheKey = `${campaignId}:${assetId}:content-hash`;

  it('serves full, range, and HEAD responses from RAM after the file is gone', async () => {
    const preparedToken = await registry.prepare({
      assetId,
      cacheKey,
      campaignId,
      filePath,
      mimeType: 'text/plain',
    });
    const preparedUrl = `blackbox-asset://${preparedToken}/${assetId}`;
    await rm(filePath);

    const full = await registry.handle(new Request(preparedUrl));
    const range = await registry.handle(
      new Request(preparedUrl, { headers: { Range: 'bytes=3-6' } }),
    );
    const head = await registry.handle(
      new Request(preparedUrl, { method: 'HEAD' }),
    );

    expect(await full.text()).toBe('0123456789');
    expect(await range.text()).toBe('3456');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
  });

  it('deduplicates concurrent grants and keeps bytes until the last grant releases', async () => {
    const grant = {
      assetId,
      cacheKey,
      campaignId,
      filePath,
      mimeType: 'text/plain',
    };
    const [first, second] = await Promise.all([
      registry.prepare(grant),
      registry.prepare(grant),
    ]);
    await rm(filePath);

    registry.release(first);
    const remainingUrl = `blackbox-asset://${second}/${assetId}`;
    expect(await (await registry.handle(new Request(remainingUrl))).text()).toBe(
      '0123456789',
    );
  });

  it('revokes stale grants when an authoritative manifest changes revision', async () => {
    const preparedToken = await registry.prepare({
      assetId,
      cacheKey,
      campaignId,
      filePath,
      mimeType: 'text/plain',
    });
    const preparedUrl = `blackbox-asset://${preparedToken}/${assetId}`;

    registry.reconcileCampaign(campaignId, [
      { id: assetId, sha256: 'new-content-hash' },
    ]);

    await expect(
      registry.handle(new Request(preparedUrl)),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('releases every grant and payload when the campaign closes', async () => {
    const preparedToken = await registry.prepare({
      assetId,
      cacheKey,
      campaignId,
      filePath,
      mimeType: 'text/plain',
    });
    registry.releaseCampaign(campaignId);

    await expect(
      registry.handle(
        new Request(`blackbox-asset://${preparedToken}/${assetId}`),
      ),
    ).resolves.toMatchObject({ status: 404 });
  });
});
