import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetPreviewRegistry } from '../../../main/assetPreviewRegistry';

const directories: string[] = [];
const assetId = '11111111-1111-4111-8111-111111111111';

let registry: AssetPreviewRegistry;
let token: string;
let url: string;

beforeEach(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-preview-test-'));
  directories.push(directory);
  const filePath = path.join(directory, 'asset.txt');
  await writeFile(filePath, '0123456789', 'utf8');

  registry = new AssetPreviewRegistry();
  token = registry.create({
    assetId,
    campaignId: '22222222-2222-4222-8222-222222222222',
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
