import type { DatabaseSync } from 'node:sqlite';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import { addEmptyDnd5eCharacterInventories } from './campaignArchiveCharacterInventory';
import {
  addAssetPermissions,
  addJournalEntryPermissionRevision,
  addScenePermissions,
  runDirectArchiveConversion,
} from './campaignArchiveSteps';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

/** Directly converts format-2 authored data into today's shape. */
export function convertCampaignArchiveFormat2(
  connection: DatabaseSync,
): string[] {
  const rows = connection.prepare(
    `SELECT id, name, data_json
     FROM journal_entries
     WHERE type_id = ?
     ORDER BY position`,
  ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as CharacterRow[];
  let convertedCharacters = 0;

  const accessWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    addJournalEntryPermissionRevision(connection);
    accessWarnings.push(
      ...addAssetPermissions(connection),
      ...addScenePermissions(connection),
    );
    const update = connection.prepare(
      'UPDATE journal_entries SET data_json = ? WHERE id = ?',
    );
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data_json);
      } catch {
        throw new Error(`Archive format 2 contains malformed Character data for ${row.name}.`);
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.hasOwn(parsed, 'features')
      ) {
        throw new Error(`Archive format 2 contains invalid Character data for ${row.name}.`);
      }
      const converted = { ...parsed, features: [] };
      update.run(JSON.stringify(converted), row.id);
      convertedCharacters += 1;
    }
    accessWarnings.push(...addEmptyDnd5eCharacterInventories(connection, 2));
  });

  const characterWarnings = convertedCharacters === 0
    ? []
    : [
        `Added empty Features collections to ${convertedCharacters} D&D ${
          convertedCharacters === 1 ? 'character' : 'characters'
        } imported from archive format 2.`,
      ];
  return [...characterWarnings, ...accessWarnings];
}
