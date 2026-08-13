import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  createDefaultDnd5eCharacterSpellcasting,
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

/** Adds Spellcasting only to the exact otherwise-current historical shape. */
export function addDefaultDnd5eSpellcastingToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.hasOwn(value, 'spellcasting')
  ) return null;
  const identity = 'identity' in value && value.identity &&
    typeof value.identity === 'object' && !Array.isArray(value.identity)
    ? value.identity as Record<string, unknown>
    : null;
  const className = typeof identity?.className === 'string'
    ? identity.className
    : '';
  const converted = {
    ...value,
    spellcasting: createDefaultDnd5eCharacterSpellcasting(className),
  };
  return isDnd5eCharacterData(converted as JsonValue)
    ? converted as unknown as Dnd5eCharacterData
    : null;
}

export function spellcastingDefaultsImportReport(
  characterCount: number,
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
): string[] {
  if (characterCount === 0) return [];
  return [
    `Added default Spellcasting values to ${characterCount} D&D ${
      characterCount === 1 ? 'character' : 'characters'
    } imported from archive format ${formatVersion}.`,
  ];
}

/** Directly adds the current Spellcasting shape to format-10 Characters. */
export function addDefaultDnd5eSpellcasting(
  connection: DatabaseSync,
  formatVersion: 10,
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
    const converted = addDefaultDnd5eSpellcastingToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return spellcastingDefaultsImportReport(rows.length, formatVersion);
}
