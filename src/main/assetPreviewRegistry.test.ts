import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetPreviewRegistry } from './assetPreviewRegistry';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('AssetPreviewRegistry', () => {
  it('serves opaque full and ranged responses and revokes grants', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'blackbox-preview-test-'),
    );
    directories.push(directory);
    const filePath = path.join(directory, 'asset.txt');
    await writeFile(filePath, '0123456789', 'utf8');
    const registry = new AssetPreviewRegistry();
    const assetId = '11111111-1111-4111-8111-111111111111';
    const token = registry.create({
      assetId,
      campaignId: '22222222-2222-4222-8222-222222222222',
      filePath,
      mimeType: 'text/plain',
    });
    const url = `blackbox-asset://${token}/${assetId}`;

    const full = await registry.handle(new Request(url));
    expect(full.status).toBe(200);
    expect(full.headers.get('access-control-allow-origin')).toBe('*');
    expect(full.headers.get('content-type')).toBe('text/plain');
    expect(await full.text()).toBe('0123456789');

    const range = await registry.handle(
      new Request(url, { headers: { Range: 'bytes=2-5' } }),
    );
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await range.text()).toBe('2345');

    registry.release(token);
    await expect(registry.handle(new Request(url))).resolves.toMatchObject({
      status: 404,
    });
  });
});
