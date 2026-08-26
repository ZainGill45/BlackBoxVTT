import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertCampaignArchiveFormat19 } from '../../../main/campaignArchiveFormat19';
import { CampaignDatabase } from '../../../main/storage/campaignDatabase';
import {
  createDefaultDnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../../../systems/dnd5e/ids';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

describe('archive format 19 conversion', () => {
  it('accepts the frozen Character Action term shape without rewriting it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-format-19-'));
    directories.push(directory);
    const database = CampaignDatabase.create(directory, {
      createdAt: '2026-08-25T00:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Format 19',
      system: TEST_CAMPAIGN_SYSTEM,
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
    const data = createDefaultDnd5eCharacterData();
    data.actions[0] = {
      activation: '',
      description: '',
      duration: '',
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Old Save',
      range: '',
      steps: [{
        ability: 'charisma',
        dcTerms: [{ kind: 'flat', value: 15 }],
        failure: '',
        id: '33333333-3333-4333-8333-333333333333',
        label: 'Resist',
        purpose: 'save',
        success: '',
      }],
      target: '',
    };
    database.connection.prepare(
      `INSERT INTO journal_entries (
         id, type_id, position, name, default_access, revision,
         created_at, created_by, updated_at, updated_by,
         name_style_json, data_json, permission_revision
       ) VALUES (?, ?, 0, 'Character', 'none', 0, ?, 'gm', ?, 'gm', '{}', ?, 0)`,
    ).run(
      '44444444-4444-4444-8444-444444444444',
      DND5E_CHARACTER_ENTRY_TYPE_ID,
      '2026-08-25T00:00:00.000Z',
      '2026-08-25T00:00:00.000Z',
      JSON.stringify(data),
    );

    expect(convertCampaignArchiveFormat19(database.connection)).toEqual([]);
    const row = database.connection.prepare(
      'SELECT data_json FROM journal_entries',
    ).get() as { data_json: string };
    expect(JSON.parse(row.data_json)).toEqual(data);
    database.close();
  });

  it('rejects a term that did not exist in format 19', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-format-19-'));
    directories.push(directory);
    const database = CampaignDatabase.create(directory, {
      createdAt: '2026-08-25T00:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Format 19',
      system: TEST_CAMPAIGN_SYSTEM,
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
    const data = createDefaultDnd5eCharacterData();
    data.actions[0] = {
      activation: '',
      description: '',
      duration: '',
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Future Save',
      range: '',
      steps: [{
        ability: 'charisma',
        dcTerms: [{ kind: 'spell-save-dc' }],
        failure: '',
        id: '33333333-3333-4333-8333-333333333333',
        label: 'Resist',
        purpose: 'save',
        success: '',
      }],
      target: '',
    };
    database.connection.prepare(
      `INSERT INTO journal_entries (
         id, type_id, position, name, default_access, revision,
         created_at, created_by, updated_at, updated_by,
         name_style_json, data_json, permission_revision
       ) VALUES (?, ?, 0, 'Character', 'none', 0, ?, 'gm', ?, 'gm', '{}', ?, 0)`,
    ).run(
      '44444444-4444-4444-8444-444444444444',
      DND5E_CHARACTER_ENTRY_TYPE_ID,
      '2026-08-25T00:00:00.000Z',
      '2026-08-25T00:00:00.000Z',
      JSON.stringify(data),
    );

    expect(() => convertCampaignArchiveFormat19(database.connection)).toThrow(
      'Archive format 19 contains invalid Character data for Character.',
    );
    database.close();
  });
});
