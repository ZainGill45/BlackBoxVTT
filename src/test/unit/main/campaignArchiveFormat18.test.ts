import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertCampaignArchiveFormat18 } from '../../../main/campaignArchiveFormat18';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import {
  createDefaultDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../../../systems/dnd5e/definition';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';
import { makeScene } from '../../support/scenes';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

describe('archive format 18 conversion', () => {
  it('adds defaults to root Characters and Template snapshots directly', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-format-18-'));
    directories.push(directory);
    const database = CampaignDatabase.create(directory, {
      createdAt: '2026-08-23T00:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Format 18',
      system: TEST_CAMPAIGN_SYSTEM,
      updatedAt: '2026-08-23T00:00:00.000Z',
    });
    const data = createDefaultDnd5eCharacterData() as Dnd5eCharacterData & {
      defaultToken: Omit<Dnd5eCharacterData['defaultToken'], 'inspector'> & {
        inspector?: never;
      };
    };
    Reflect.deleteProperty(data.defaultToken, 'inspector');
    const entryId = '22222222-2222-4222-8222-222222222222';
    const scene = makeScene({ id: '33333333-3333-4333-8333-333333333333' });
    database.connection.prepare(
      `INSERT INTO journal_entries (
         id, type_id, position, name, default_access, revision,
         created_at, created_by, updated_at, updated_by,
         name_style_json, data_json, permission_revision
       ) VALUES (?, ?, 0, 'Character', 'none', 0, ?, 'gm', ?, 'gm', '{}', ?, 0)`,
    ).run(
      entryId,
      DND5E_CHARACTER_ENTRY_TYPE_ID,
      scene.createdAt,
      scene.updatedAt,
      JSON.stringify(data),
    );
    database.connection.prepare(
      `INSERT INTO scenes (
         id, position, record_json, default_access, permission_revision
       ) VALUES (?, 0, ?, 'none', 0)`,
    ).run(scene.id, JSON.stringify(scene));
    database.connection.prepare(
      `INSERT INTO scene_token_snapshots (
         id, scene_id, root_entry_id, type_id, name, data_json,
         revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'Character', ?, 0, ?, ?)`,
    ).run(
      '44444444-4444-4444-8444-444444444444',
      scene.id,
      entryId,
      DND5E_CHARACTER_ENTRY_TYPE_ID,
      JSON.stringify(data),
      scene.createdAt,
      scene.updatedAt,
    );

    expect(convertCampaignArchiveFormat18(database.connection)).toEqual([
      'Added default Token Inspector fields to 1 D&D character and 1 Template token snapshot imported from archive format 18.',
    ]);
    const rows = [
      database.connection.prepare(
        'SELECT data_json FROM journal_entries WHERE id = ?',
      ).get(entryId),
      database.connection.prepare(
        'SELECT data_json FROM scene_token_snapshots WHERE root_entry_id = ?',
      ).get(entryId),
    ] as Array<{ data_json: string }>;
    expect(rows.map(({ data_json }) =>
      (JSON.parse(data_json) as Dnd5eCharacterData).defaultToken.inspector,
    )).toEqual([
      { fieldIds: ['health', 'armor-class'] },
      { fieldIds: ['health', 'armor-class'] },
    ]);
    database.close();
  });
});
