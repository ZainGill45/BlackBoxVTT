import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

/**
 * Replaces the exact pre-reference Spellcasting shape with today's empty list.
 *
 * A manual total cannot identify which standalone Spell entries it represented,
 * so formats 11 and 12 deliberately carry no membership across this boundary.
 */
export function addEmptyDnd5eCharacterSpellReferencesToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const spellcasting = 'spellcasting' in value && value.spellcasting &&
    typeof value.spellcasting === 'object' &&
    !Array.isArray(value.spellcasting)
    ? value.spellcasting as Record<string, unknown>
    : null;
  if (
    !spellcasting ||
    !Object.hasOwn(spellcasting, 'preparedCurrent') ||
    Object.hasOwn(spellcasting, 'spells') ||
    !Number.isSafeInteger(spellcasting.preparedCurrent) ||
    (spellcasting.preparedCurrent as number) < 0
  ) return null;

  const remainingSpellcasting = Object.fromEntries(
    Object.entries(spellcasting).filter(([key]) => key !== 'preparedCurrent'),
  );
  const converted = {
    ...value,
    spellcasting: {
      ...remainingSpellcasting,
      spells: [],
    },
  };
  return isDnd5eCharacterData(converted as JsonValue)
    ? converted as unknown as Dnd5eCharacterData
    : null;
}

export function spellReferencesImportReport(
  characterCount: number,
  formatVersion: 11 | 12,
): string[] {
  if (characterCount === 0) return [];
  return [
    `Replaced manual Prepared Spells counts with empty spell lists for ${
      characterCount
    } D&D ${characterCount === 1 ? 'character' : 'characters'} imported ` +
      `from archive format ${formatVersion}; a count cannot identify specific ` +
      'Spell entries.',
  ];
}

/** Directly converts format-11/12 Character spell membership to today's shape. */
export function addEmptyDnd5eCharacterSpellReferences(
  connection: DatabaseSync,
  formatVersion: 11 | 12,
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
    const converted = addEmptyDnd5eCharacterSpellReferencesToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return spellReferencesImportReport(rows.length, formatVersion);
}
