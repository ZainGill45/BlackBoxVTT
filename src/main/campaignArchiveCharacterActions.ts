import type { DatabaseSync } from 'node:sqlite';
import {
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import { deathSavesRemovalImportReport } from './campaignArchiveCharacterHealth';
import { emptyCustomSkillsImportReport } from './campaignArchiveCharacterCustomSkills';
import { spellcastingDefaultsImportReport } from './campaignArchiveCharacterSpellcasting';
import {
  addDefaultDnd5eSkillOffsetsToValue,
  skillOffsetsImportReport,
} from './campaignArchiveCharacterSkills';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

export function addEmptyDnd5eCharacterActionsToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.hasOwn(value, 'actions')
  ) return null;
  const converted = { ...(value as Record<string, unknown>), actions: [] };
  return addDefaultDnd5eSkillOffsetsToValue(converted);
}

export function emptyActionsImportReport(
  characterCount: number,
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6,
): string[] {
  if (characterCount === 0) return [];
  return [
    `Added an empty Actions collection to ${characterCount} D&D ${
      characterCount === 1 ? 'character' : 'characters'
    } imported from archive format ${formatVersion}.`,
  ];
}

/** Directly adds the current empty Actions collection to format-6 Characters. */
export function addEmptyDnd5eCharacterActions(
  connection: DatabaseSync,
  formatVersion: 6,
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
    const converted = addEmptyDnd5eCharacterActionsToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return [
    ...emptyActionsImportReport(rows.length, formatVersion),
    ...skillOffsetsImportReport(rows.length, formatVersion),
    ...deathSavesRemovalImportReport(rows.length, formatVersion),
    ...emptyCustomSkillsImportReport(rows.length, formatVersion),
    ...spellcastingDefaultsImportReport(rows.length, formatVersion),
  ];
}
