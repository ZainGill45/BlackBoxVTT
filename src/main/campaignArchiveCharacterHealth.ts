import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import {
  addEmptyDnd5eCustomSkillsToValue,
  emptyCustomSkillsImportReport,
} from './campaignArchiveCharacterCustomSkills';
import { spellcastingDefaultsImportReport } from './campaignArchiveCharacterSpellcasting';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

const FORMAT_1_TO_8_HEALTH_KEYS = [
  'currentHitDice',
  'currentHitPoints',
  'deathSaveFailures',
  'deathSaveSuccesses',
  'hitDie',
  'maximumHitDice',
  'maximumHitPoints',
  'temporaryHitPoints',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Removes Death Saves from one exact historical Health shape. */
export function removeDnd5eDeathSavesFromValue(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.health)) return null;
  const health = value.health;
  const actualKeys = Object.keys(health).sort();
  const expectedKeys = [...FORMAT_1_TO_8_HEALTH_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key, index) => key === actualKeys[index]) ||
    !FORMAT_1_TO_8_HEALTH_KEYS.every((key) => typeof health[key] === 'string') ||
    !['0', '1', '2', '3'].includes(health.deathSaveFailures as string) ||
    !['0', '1', '2', '3'].includes(health.deathSaveSuccesses as string)
  ) {
    return null;
  }
  const currentHealth = {
    currentHitDice: health.currentHitDice,
    currentHitPoints: health.currentHitPoints,
    hitDie: health.hitDie,
    maximumHitDice: health.maximumHitDice,
    maximumHitPoints: health.maximumHitPoints,
    temporaryHitPoints: health.temporaryHitPoints,
  };
  return { ...value, health: currentHealth };
}

/** Converts an otherwise-current format-8 Character without accepting near matches. */
export function convertDnd5eCharacterDataFromArchiveFormat8(
  value: unknown,
): Dnd5eCharacterData | null {
  const withoutDeathSaves = removeDnd5eDeathSavesFromValue(value);
  const converted = withoutDeathSaves
    ? addEmptyDnd5eCustomSkillsToValue(withoutDeathSaves)
    : null;
  return converted && isDnd5eCharacterData(converted as JsonValue)
    ? converted
    : null;
}

export function deathSavesRemovalImportReport(
  characterCount: number,
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): string[] {
  if (characterCount === 0) return [];
  return [
    `Removed Death Save counters from ${characterCount} D&D ${
      characterCount === 1 ? 'character' : 'characters'
    } imported from archive format ${formatVersion}.`,
  ];
}

/** Directly removes format-8 Death Save counters from otherwise-current Characters. */
export function removeDnd5eDeathSaves(
  connection: DatabaseSync,
  formatVersion: 8,
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
    const converted = convertDnd5eCharacterDataFromArchiveFormat8(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return [
    ...deathSavesRemovalImportReport(rows.length, formatVersion),
    ...emptyCustomSkillsImportReport(rows.length, formatVersion),
    ...spellcastingDefaultsImportReport(rows.length, formatVersion),
  ];
}
