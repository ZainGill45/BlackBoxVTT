import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  createDefaultDnd5eCharacterInventory,
  isDnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import { emptyActionsImportReport } from './campaignArchiveCharacterActions';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

/** Adds the current empty Inventory to one already-normalized historical shape. */
export function addEmptyDnd5eCharacterInventories(
  connection: DatabaseSync,
  formatVersion: 1 | 2 | 3 | 4,
): string[] {
  const rows = connection.prepare(
    `SELECT id, name, data_json
     FROM journal_entries
     WHERE type_id = ?
     ORDER BY position`,
  ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as CharacterRow[];
  const update = connection.prepare(
    'UPDATE journal_entries SET data_json = ? WHERE id = ?',
  );
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      throw new Error(
        `Archive format ${formatVersion} contains malformed Character data for ${row.name}.`,
      );
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.hasOwn(parsed, 'inventory')
    ) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    const converted = {
      ...parsed,
      actions: [],
      inventory: createDefaultDnd5eCharacterInventory(),
    };
    if (!isDnd5eCharacterData(converted as JsonValue)) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  if (rows.length === 0) return [];
  return [
    `Added an empty Inventory to ${rows.length} D&D ${
      rows.length === 1 ? 'character' : 'characters'
    } imported from archive format ${formatVersion}.`,
    ...emptyActionsImportReport(rows.length, formatVersion),
  ];
}
