import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_MANIFEST_SCHEMA_VERSION,
  type AssetActor,
} from '../../../shared/assets';
import { AssetRepository } from '../../../main/assetRepository';

const temporaryDirectories: string[] = [];
const actor: AssetActor = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'player',
};

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-assets-test-'));
  temporaryDirectories.push(root);
  const campaignDirectory = path.join(root, 'campaign');
  await mkdir(path.join(campaignDirectory, 'content'), { recursive: true });
  const trashed: string[] = [];
  const touchCampaign = vi.fn(async () => undefined);
  const repository = new AssetRepository({
    campaignDirectory,
    touchCampaign,
    trashItem: async (target) => {
      trashed.push(target);
    },
  });
  return { campaignDirectory, repository, touchCampaign, trashed };
}

async function writePng(directory: string, name: string, suffix = '') {
  const filePath = path.join(directory, name);
  await writeFile(
    filePath,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(suffix),
    ]),
  );
  return filePath;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('AssetRepository', () => {
  it('treats a missing manifest as empty and creates it lazily', async () => {
    const { campaignDirectory, repository } = await createFixture();

    expect(await repository.readManifest()).toEqual({
      assets: [],
      revision: 0,
      schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
    });
    await expect(
      stat(path.join(campaignDirectory, 'content', 'assets.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('imports UUID-backed files with hashes and actor metadata', async () => {
    const { campaignDirectory, repository, touchCampaign } =
      await createFixture();
    const source = await writePng(campaignDirectory, 'Forest.png', 'map');

    const result = await repository.importFiles([source], actor);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      createdBy: actor.id,
      displayName: 'Forest.png',
      extension: 'png',
      format: 'png',
      kind: 'image',
      lastModifiedBy: actor.id,
      originalFilename: 'Forest.png',
      revision: 1,
    });
    expect(result.value[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value[0].chunkHashes).toHaveLength(1);
    await expect(
      stat(
        path.join(
          campaignDirectory,
          'content',
          'assets',
          `${result.value[0].id}.png`,
        ),
      ),
    ).resolves.toMatchObject({ size: 11 });
    expect(touchCampaign).toHaveBeenCalledOnce();
  });

  it('silently skips unsupported, duplicate-content, and duplicate-name imports', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const first = await writePng(campaignDirectory, 'Map.png', 'same');
    const sameContent = await writePng(
      campaignDirectory,
      'Copy.png',
      'same',
    );
    const conflictingName = await writePng(
      path.join(campaignDirectory, 'content'),
      'map.png',
      'different',
    );
    const unsupported = path.join(campaignDirectory, 'notes.docx');
    await writeFile(unsupported, 'unsupported');

    const initial = await repository.importFiles([first], actor);
    expect(initial.ok).toBe(true);
    const skipped = await repository.importFiles(
      [sameContent, conflictingName, unsupported],
      actor,
    );

    expect(skipped).toEqual({ ok: true, value: [] });
    expect((await repository.readManifest()).assets).toHaveLength(1);
  });

  it('rejects encrypted PDFs and invalid UTF-8 as expected skips', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const pdf = path.join(campaignDirectory, 'secret.pdf');
    const text = path.join(campaignDirectory, 'binary.txt');
    await writeFile(pdf, '%PDF-1.7\n/Encrypt 12 0 R\n%%EOF');
    await writeFile(text, Buffer.from([0xff, 0xfe, 0xfd]));

    await expect(repository.importFiles([pdf, text], actor)).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it('serializes unique renames and moves deleted bytes to trash', async () => {
    const { campaignDirectory, repository, trashed } = await createFixture();
    const first = await writePng(campaignDirectory, 'One.png', '1');
    const second = await writePng(campaignDirectory, 'Two.png', '2');
    const imported = await repository.importFiles([first, second], actor);
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }

    const renamed = await repository.renameAsset(
      imported.value[0].id,
      '  Main Map  ',
      imported.value[0].revision,
      actor,
    );
    expect(renamed).toMatchObject({
      ok: true,
      value: { displayName: 'Main Map', revision: 2 },
    });
    const conflict = await repository.renameAsset(
      imported.value[1].id,
      'main map',
      imported.value[1].revision,
      actor,
    );
    expect(conflict).toMatchObject({
      error: { code: 'conflict' },
      ok: false,
    });

    const deleted = await repository.trashAsset(
      imported.value[1].id,
      imported.value[1].revision,
    );
    expect(deleted).toEqual({ ok: true, value: null });
    expect(trashed).toHaveLength(1);
    expect((await repository.readManifest()).assets).toHaveLength(1);
  });

  it('marks an indexed file unavailable when its bytes disappear', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const source = await writePng(campaignDirectory, 'Missing.png');
    const imported = await repository.importFiles([source], actor);
    if (!imported.ok) {
      throw new Error('Fixture import failed.');
    }
    const { rm } = await import('node:fs/promises');
    await rm(repository.resolveAssetPath(imported.value[0]));

    expect(await repository.list()).toEqual([
      { available: false, record: imported.value[0] },
    ]);
    const stored = JSON.parse(
      await readFile(
        path.join(campaignDirectory, 'content', 'assets.json'),
        'utf8',
      ),
    );
    expect(stored.assets).toHaveLength(1);
  });
});
