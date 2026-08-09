import { mkdtemp, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AssetActor,
} from '../../../shared/assets';
import { AssetRepository } from '../../../main/assetRepository';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const temporaryDirectories: string[] = [];
const databases: CampaignDatabase[] = [];
const actor: AssetActor = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'player',
};

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-assets-test-'));
  temporaryDirectories.push(root);
  const campaignDirectory = path.join(root, 'campaign');
  await mkdir(path.join(campaignDirectory, 'content'), { recursive: true });
  const timestamp = '2026-07-31T12:00:00.000Z';
  const database = CampaignDatabase.create(campaignDirectory, {
    createdAt: timestamp,
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Iron Meridian',
    system: TEST_CAMPAIGN_SYSTEM,
    updatedAt: timestamp,
  });
  databases.push(database);
  const trashed: string[] = [];
  const touchCampaign = vi.fn(async () => undefined);
  const repository = new AssetRepository({
    database,
    touchCampaign,
    trashItem: async (target) => {
      trashed.push(target);
    },
  });
  return {
    campaignDirectory,
    database,
    repository,
    touchCampaign,
    trashed,
  };
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
  for (const database of databases.splice(0)) {
    database.close();
  }
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('AssetRepository', () => {
  it('starts with an empty database-backed manifest', async () => {
    const { campaignDirectory, repository } = await createFixture();

    expect(await repository.readManifest()).toEqual({
      assets: [],
      revision: 0,
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

  it('reorders one kind group in place and persists it as position', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const sources = await Promise.all([
      writePng(campaignDirectory, 'One.png', '1'),
      writePng(campaignDirectory, 'Two.png', '2'),
      writePng(campaignDirectory, 'Three.png', '3'),
    ]);
    const imported = await repository.importFiles(sources, actor);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const [one, two, three] = imported.value.map(({ id }) => id);

    const reordered = await repository.reorderAssets('image', [three, one, two]);
    expect(reordered.ok).toBe(true);

    /* Read back through readManifest so the assertion covers the ORDER BY
       position round-trip, not just the in-memory array. */
    const manifest = await repository.readManifest();
    expect(manifest.assets.map(({ id }) => id)).toEqual([three, one, two]);
    expect(manifest.revision).toBe(
      (reordered.ok ? reordered.value.revision : 0),
    );
  });

  it('leaves other kinds where they are when one group is reordered', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const png = await writePng(campaignDirectory, 'Map.png', 'm');
    const notes = path.join(campaignDirectory, 'Notes.md');
    await writeFile(notes, '# Notes');
    const second = await writePng(campaignDirectory, 'Token.png', 't');
    const imported = await repository.importFiles([png, notes, second], actor);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const before = (await repository.readManifest()).assets;
    const images = before.filter(({ kind }) => kind === 'image');
    const documentSlot = before.findIndex(({ kind }) => kind === 'document');

    const result = await repository.reorderAssets(
      'image',
      [images[1].id, images[0].id],
    );
    expect(result.ok).toBe(true);

    const after = (await repository.readManifest()).assets;
    expect(after.findIndex(({ kind }) => kind === 'document')).toBe(documentSlot);
    expect(after.filter(({ kind }) => kind === 'image').map(({ id }) => id))
      .toEqual([images[1].id, images[0].id]);
  });

  it('refuses an order that does not match the kind group exactly', async () => {
    const { campaignDirectory, repository } = await createFixture();
    const sources = await Promise.all([
      writePng(campaignDirectory, 'One.png', '1'),
      writePng(campaignDirectory, 'Two.png', '2'),
    ]);
    const imported = await repository.importFiles(sources, actor);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const [one, two] = imported.value.map(({ id }) => id);
    const original = (await repository.readManifest()).assets.map(({ id }) => id);

    /* Short of the group: stands in for an asset imported by someone else
       between the menu opening and the order being committed. */
    await expect(repository.reorderAssets('image', [one])).resolves.toMatchObject({
      error: { code: 'invalid_input' },
      ok: false,
    });
    /* Right length, duplicated member. */
    await expect(
      repository.reorderAssets('image', [one, one]),
    ).resolves.toMatchObject({ error: { code: 'invalid_input' }, ok: false });
    /* Right length, an id from no group at all. */
    await expect(
      repository.reorderAssets('image', [one, '00000000-0000-4000-8000-000000000000']),
    ).resolves.toMatchObject({ error: { code: 'invalid_input' }, ok: false });

    expect((await repository.readManifest()).assets.map(({ id }) => id))
      .toEqual(original);
    expect(two).toBeDefined();
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
    expect((await repository.readManifest()).assets).toHaveLength(1);
  });

  it('finishes a database-recorded deletion after an interrupted file operation', async () => {
    const { campaignDirectory, database, repository, trashed } =
      await createFixture();
    const source = await writePng(campaignDirectory, 'Old Map.png');
    const imported = await repository.importFiles([source], actor);
    if (!imported.ok || imported.value.length !== 1) {
      throw new Error('Fixture import failed.');
    }
    const previousManifest = await repository.readManifest();
    const record = imported.value[0];
    const stagingName = `${record.id}.deleted`;
    const stagingPath = path.join(
      campaignDirectory,
      'content',
      '.asset-staging',
      stagingName,
    );
    await rename(repository.resolveAssetPath(record), stagingPath);
    database.connection
      .prepare(
        `INSERT INTO asset_file_operations (
           operation_id, kind, payload_json
         ) VALUES (?, 'delete', ?)`,
      )
      .run(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        JSON.stringify({
          files: [
            {
              finalName: `${record.id}.${record.extension}`,
              stagingName,
            },
          ],
          nextManifest: {
            assets: [],
            revision: previousManifest.revision + 1,
          },
          previousManifest,
        }),
      );
    const reopened = new AssetRepository({
      database,
      trashItem: async (target) => {
        trashed.push(target);
      },
    });

    expect((await reopened.readManifest()).assets).toEqual([]);
    expect(trashed).toContain(stagingPath);
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM asset_file_operations')
        .get(),
    ).toEqual({ count: 0 });
  });
});
