import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  DND5E_SKILLS,
  DND5E_SKILL_TRAINING_STATES,
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
  type Dnd5eSkillTraining,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import {
  deathSavesRemovalImportReport,
  removeDnd5eDeathSavesFromValue,
} from './campaignArchiveCharacterHealth';
import {
  addEmptyDnd5eCustomSkillsToValue,
  emptyCustomSkillsImportReport,
} from './campaignArchiveCharacterCustomSkills';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Adds the current zero offsets to one exact historical Skill-map shape. */
export function addDefaultDnd5eSkillOffsetsToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  const withoutDeathSaves = removeDnd5eDeathSavesFromValue(value);
  if (!withoutDeathSaves || !isRecord(withoutDeathSaves.skills)) return null;
  const historicalSkills = withoutDeathSaves.skills;
  const expectedIds = DND5E_SKILLS.map(({ id }) => id);
  const actualIds = Object.keys(historicalSkills).sort();
  if (
    actualIds.length !== expectedIds.length ||
    ![...expectedIds].sort().every((id, index) => id === actualIds[index])
  ) {
    return null;
  }
  const skills = Object.fromEntries(expectedIds.map((id) => {
    const training = historicalSkills[id];
    if (
      typeof training !== 'string' ||
      !DND5E_SKILL_TRAINING_STATES.includes(training as Dnd5eSkillTraining)
    ) {
      return [id, null];
    }
    return [id, { bonusOffset: 0, passiveOffset: 0, training }];
  }));
  if (Object.values(skills).some((skill) => skill === null)) return null;
  const converted = addEmptyDnd5eCustomSkillsToValue({
    ...withoutDeathSaves,
    skills,
  });
  return converted && isDnd5eCharacterData(converted as JsonValue)
    ? converted
    : null;
}

export function skillOffsetsImportReport(
  characterCount: number,
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7,
): string[] {
  if (characterCount === 0) return [];
  return [
    `Added zero Skill bonus and passive-score adjustments to ${characterCount} D&D ${
      characterCount === 1 ? 'character' : 'characters'
    } imported from archive format ${formatVersion}.`,
  ];
}

/** Directly adds current Skill offsets to otherwise-current historical Characters. */
export function addDefaultDnd5eSkillOffsets(
  connection: DatabaseSync,
  formatVersion: 7,
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
    const converted = addDefaultDnd5eSkillOffsetsToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return [
    ...skillOffsetsImportReport(rows.length, formatVersion),
    ...deathSavesRemovalImportReport(rows.length, formatVersion),
    ...emptyCustomSkillsImportReport(rows.length, formatVersion),
  ];
}
