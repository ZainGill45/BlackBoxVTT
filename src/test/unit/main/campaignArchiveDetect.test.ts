import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extract as extractTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectCampaignFormatVersion,
  findUnsupportedSystemReason,
  readCampaignIdentity,
} from '../../../main/campaignArchiveDetect';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import { createDefaultDnd5eCharacterData } from '../../../systems/dnd5e/characterData';
import { addIntermediatePermissionSchema } from '../../support/campaignArchive';

const temporaryDirectories: string[] = [];

/**
 * Unpacks a frozen archive fixture and hands back its database.
 *
 * The fixtures are the only surviving record of what each superseded release
 * actually wrote, so detection is measured against them rather than against a
 * schema written out a second time in a test.
 */
async function openFixture(version: number): Promise<DatabaseSync> {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'blackbox-detect-test-'),
  );
  temporaryDirectories.push(directory);
  await extractTar({
    cwd: directory,
    file: path.resolve(
      `src/test/fixtures/archives/dnd5e-character-format-${version}.blackbox-campaign`,
    ),
    gzip: true,
    strict: true,
  });
  return new DatabaseSync(path.join(directory, 'campaign.sqlite'));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('detectCampaignFormatVersion', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'recognizes the frozen format-%i fixture from its data alone',
    async (version) => {
      const connection = await openFixture(version);
      try {
        expect(detectCampaignFormatVersion(connection)).toEqual({
          ok: true,
          version,
        });
      } finally {
        connection.close();
      }
    },
  );

  /*
   * Built by the canonical creator rather than written out here, so "current"
   * can never quietly fall behind what the release actually writes. A hand-made
   * copy of today's schema stops being today's schema the moment one is added,
   * and then reports the newest superseded format as current.
   */
  it('refuses a campaign already carrying everything today’s schema added', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'blackbox-detect-current-'),
    );
    temporaryDirectories.push(directory);
    const database = CampaignDatabase.create(directory, {
      createdAt: '2026-08-06T22:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Already Current',
      system: { id: 'dnd5e', settings: { defaultRulesVersion: '5.5e' } },
      updatedAt: '2026-08-06T22:00:00.000Z',
    });
    try {
      expect(detectCampaignFormatVersion(database.connection)).toEqual({
        ok: false,
        reason:
          'This campaign’s structure is already current, so an outdated ' +
          'format is not what makes it unreadable.',
      });
    } finally {
      database.close();
    }
  });

  it('refuses a shape no release ever wrote rather than guessing at one', async () => {
    const connection = await openFixture(3);
    try {
      connection.exec('CREATE TABLE experiment (id TEXT PRIMARY KEY) STRICT');

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason:
          'This campaign’s structure matches no earlier release that ' +
          'Salvage can convert.',
      });
    } finally {
      connection.close();
    }
  });

  it('recognizes the exact intermediate permission schema as format 4', async () => {
    const connection = await openFixture(3);
    try {
      addIntermediatePermissionSchema(connection);

      expect(detectCampaignFormatVersion(connection)).toEqual({
        conversion: 'permission-defaults',
        ok: true,
        version: 4,
      });
    } finally {
      connection.close();
    }
  });

  it('refuses format-4 Character data with a near-match or mixed newer shape', async () => {
    const nearMatch = await openFixture(4);
    try {
      const row = nearMatch.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      nearMatch.prepare(
        `UPDATE journal_entries SET data_json = ? WHERE type_id = 'dnd5e.character'`,
      ).run(JSON.stringify({ ...JSON.parse(row.data_json), almostInventory: {} }));
      expect(detectCampaignFormatVersion(nearMatch)).toEqual({
        ok: false,
        reason: expect.stringContaining(
          'character data does not exactly match archive format 4',
        ),
      });
    } finally {
      nearMatch.close();
    }

    const mixed = await openFixture(4);
    try {
      const row = mixed.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      mixed.prepare(
        `INSERT INTO journal_entries (
           id, type_id, position, name, default_access, revision,
           created_at, created_by, updated_at, updated_by,
           name_style_json, data_json, permission_revision
         )
         SELECT '99999999-9999-4999-8999-999999999999', type_id, 1,
                'Current Hero', default_access, revision,
                created_at, created_by, updated_at, updated_by,
                name_style_json, ?, permission_revision
         FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).run(JSON.stringify({
        ...JSON.parse(row.data_json),
        inventory: createDefaultDnd5eCharacterData().inventory,
      }));
      expect(detectCampaignFormatVersion(mixed)).toEqual({
        ok: false,
        reason: expect.stringContaining(
          'characters mix archive formats 4, 5, 6, 7, 8, 9, 10, and 11',
        ),
      });
    } finally {
      mixed.close();
    }
  });

  it('refuses format-5 Character data with a near-match item shape', async () => {
    const connection = await openFixture(5);
    try {
      const row = connection.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      const data = JSON.parse(row.data_json);
      data.inventory.entries[0].quantity = 1;
      connection.prepare(
        `UPDATE journal_entries SET data_json = ? WHERE type_id = 'dnd5e.character'`,
      ).run(JSON.stringify(data));

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason: expect.stringContaining(
          'character data does not exactly match archive format 4, 5, 6, 7, 8, 9, 10, or 11',
        ),
      });
    } finally {
      connection.close();
    }
  });

  it('distinguishes exact format-9 Character data from a Custom Skills near match', async () => {
    const connection = await openFixture(9);
    try {
      const row = connection.prepare(
        `SELECT data_json FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      ).get() as { data_json: string };
      connection.prepare(
        `UPDATE journal_entries SET data_json = ? WHERE type_id = 'dnd5e.character'`,
      ).run(JSON.stringify({ ...JSON.parse(row.data_json), customSkills: {} }));

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason: expect.stringContaining(
          'character data does not exactly match archive format 4, 5, 6, 7, 8, 9, 10, or 11',
        ),
      });
    } finally {
      connection.close();
    }
  });

  it('refuses a near match whose indexes differ despite identical columns', async () => {
    const connection = await openFixture(3);
    try {
      connection.exec('DROP INDEX journal_page_assets_asset');

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason:
          'This campaign’s structure matches no earlier release that ' +
          'Salvage can convert.',
      });
    } finally {
      connection.close();
    }
  });

  it('names the character it cannot read', async () => {
    const connection = await openFixture(1);
    try {
      connection
        .prepare(
          `UPDATE journal_entries SET data_json = '{oops'
           WHERE type_id = 'dnd5e.character'`,
        )
        .run();

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason: 'This campaign’s character “Archive Hero” cannot be read.',
      });
    } finally {
      connection.close();
    }
  });

  it('refuses characters that disagree about which release wrote them', async () => {
    const connection = await openFixture(3);
    try {
      connection.exec(
        `INSERT INTO journal_entries (
           id, type_id, position, name, default_access, revision,
           created_at, created_by, updated_at, updated_by,
           name_style_json, data_json
         )
         SELECT '99999999-9999-4999-8999-999999999999', type_id, 1,
                'Older Hero', default_access, revision,
                created_at, created_by, updated_at, updated_by,
                name_style_json, '{}'
         FROM journal_entries WHERE type_id = 'dnd5e.character'`,
      );

      expect(detectCampaignFormatVersion(connection)).toEqual({
        ok: false,
        reason:
          'This campaign’s characters were not all written by the same ' +
          'release, so Salvage cannot tell which one to convert from.',
      });
    } finally {
      connection.close();
    }
  });
});

describe('findUnsupportedSystemReason', () => {
  it('accepts a system this release still bundles', async () => {
    const connection = await openFixture(2);
    try {
      expect(findUnsupportedSystemReason(connection)).toBeNull();
    } finally {
      connection.close();
    }
  });

  it('names a system this release does not bundle', async () => {
    const connection = await openFixture(2);
    try {
      connection
        .prepare(
          `UPDATE campaign_system SET system_id = 'pathfinder'
           WHERE singleton = 1`,
        )
        .run();

      expect(findUnsupportedSystemReason(connection)).toBe(
        'This campaign’s game system (“pathfinder”) is not one this ' +
          'version of BlackBox VTT can open.',
      );
    } finally {
      connection.close();
    }
  });
});

describe('readCampaignIdentity', () => {
  it('reads what the campaign calls itself without the canonical validators', async () => {
    const connection = await openFixture(3);
    try {
      expect(readCampaignIdentity(connection)).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Format Three Character',
      });
    } finally {
      connection.close();
    }
  });

  it('reports an unusable identity rather than carrying it forward', async () => {
    const connection = await openFixture(3);
    try {
      /* Long enough for the table's own CHECK, but not a name the canonical
         campaign would ever hold. */
      connection
        .prepare(
          `UPDATE campaign_metadata SET name = '  Padded  ' WHERE singleton = 1`,
        )
        .run();

      expect(readCampaignIdentity(connection)).toBeNull();
    } finally {
      connection.close();
    }
  });
});
