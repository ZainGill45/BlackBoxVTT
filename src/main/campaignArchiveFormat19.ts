import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

function isDnd5eCharacterDataFromFormat19(
  value: unknown,
): value is Dnd5eCharacterData {
  if (!isDnd5eCharacterData(value as JsonValue)) return false;
  const data = value as Dnd5eCharacterData;
  return data.actions.every((action) => action.steps.every((step) => (
    step.purpose === 'save'
      ? step.dcTerms.every((term) => term.kind !== 'spell-save-dc')
      : true
  )));
}

/**
 * Format 19's authored data is already a strict subset of today's shape.
 * Validate that frozen shape directly; no stored values need adjustment.
 */
export function convertCampaignArchiveFormat19(
  connection: DatabaseSync,
): string[] {
  const rows = [
    ...connection.prepare(
      `SELECT name, data_json FROM journal_entries
       WHERE type_id = ? ORDER BY position`,
    ).all(DND5E_CHARACTER_ENTRY_TYPE_ID),
    ...connection.prepare(
      `SELECT name, data_json FROM scene_token_snapshots
       WHERE type_id = ? ORDER BY id`,
    ).all(DND5E_CHARACTER_ENTRY_TYPE_ID),
  ] as unknown as Array<{ data_json: string; name: string }>;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      throw new Error(
        `Archive format 19 contains malformed Character data for ${row.name}.`,
      );
    }
    if (!isDnd5eCharacterDataFromFormat19(parsed)) {
      throw new Error(
        `Archive format 19 contains invalid Character data for ${row.name}.`,
      );
    }
  }
  if (connection.prepare('PRAGMA foreign_key_check').get()) {
    throw new Error('Archive conversion produced invalid foreign keys.');
  }
  return [];
}
