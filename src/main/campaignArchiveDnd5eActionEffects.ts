import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_SPELL_ENTRY_TYPE_ID,
} from '../systems/dnd5e/ids';
import {
  MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_SPELL_FIELD_CODE_UNITS,
  isDnd5eSpellData,
  type Dnd5eSpellData,
} from '../systems/dnd5e/spellData';

type EffectStepArchiveFormat = 7 | 8 | 9 | 10 | 11 | 12 | 13;

interface JournalRow {
  data_json: string;
  id: string;
  name: string;
}

interface StrippedValue {
  removedCount: number;
  value: unknown;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isLegacyEffectStep(
  value: Record<string, unknown>,
  maximumLabelLength: number,
  maximumTextLength: number,
): boolean {
  return hasExactKeys(value, ['id', 'label', 'purpose', 'text']) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.label === 'string' &&
    value.label.length <= maximumLabelLength &&
    value.purpose === 'effect' &&
    typeof value.text === 'string' &&
    value.text.length <= maximumTextLength;
}

function stripSteps(
  values: readonly unknown[],
  maximumLabelLength: number,
  maximumTextLength: number,
): { removedCount: number; values: unknown[] } | null {
  let removedCount = 0;
  const retained: unknown[] = [];
  for (const value of values) {
    if (!isRecord(value) || value.purpose !== 'effect') {
      retained.push(value);
      continue;
    }
    if (!isLegacyEffectStep(value, maximumLabelLength, maximumTextLength)) {
      return null;
    }
    removedCount += 1;
  }
  return { removedCount, values: removedCount > 0 ? retained : [...values] };
}

/** Removes only the exact Character Action Effect shape written by format 13. */
export function stripDnd5eCharacterActionEffects(
  value: unknown,
): StrippedValue | null {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    return { removedCount: 0, value };
  }
  let removedCount = 0;
  let changed = false;
  const actions = value.actions.map((action) => {
    if (!isRecord(action) || !Array.isArray(action.steps)) return action;
    const stripped = stripSteps(
      action.steps,
      MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
      MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
    );
    if (!stripped) return null;
    removedCount += stripped.removedCount;
    changed ||= stripped.removedCount > 0;
    return stripped.removedCount > 0
      ? { ...action, steps: stripped.values }
      : action;
  });
  if (actions.some((action) => action === null)) return null;
  return {
    removedCount,
    value: changed ? { ...value, actions } : value,
  };
}

/** Removes only the exact Spell Roll Action Effect shape written by format 13. */
export function stripDnd5eSpellRollActionEffects(
  value: unknown,
): StrippedValue | null {
  if (!isRecord(value) || !Array.isArray(value.rollSteps)) {
    return { removedCount: 0, value };
  }
  const stripped = stripSteps(
    value.rollSteps,
    MAX_DND5E_SPELL_FIELD_CODE_UNITS,
    MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS,
  );
  if (!stripped) return null;
  return {
    removedCount: stripped.removedCount,
    value: stripped.removedCount > 0
      ? { ...value, rollSteps: stripped.values }
      : value,
  };
}

export function convertDnd5eCharacterActionEffectsFromFormat13(
  value: unknown,
): { data: Dnd5eCharacterData; removedCount: number } | null {
  const stripped = stripDnd5eCharacterActionEffects(value);
  if (!stripped || !isDnd5eCharacterData(stripped.value as JsonValue)) return null;
  return {
    data: stripped.value as Dnd5eCharacterData,
    removedCount: stripped.removedCount,
  };
}

export function convertDnd5eSpellRollActionEffectsFromFormat13(
  value: unknown,
): { data: Dnd5eSpellData; removedCount: number } | null {
  const stripped = stripDnd5eSpellRollActionEffects(value);
  if (!stripped || !isDnd5eSpellData(stripped.value as JsonValue)) return null;
  return {
    data: stripped.value as Dnd5eSpellData,
    removedCount: stripped.removedCount,
  };
}

function removalWarning(
  count: number,
  subject: 'Character Actions' | 'Spell Roll Actions',
  formatVersion: EffectStepArchiveFormat,
): string[] {
  if (count === 0) return [];
  return [
    `Removed ${count} authored Effect ${count === 1 ? 'step' : 'steps'} ` +
      `from D&D ${subject} imported from archive format ${formatVersion}.`,
  ];
}

/** Removes superseded authored Effect steps before a direct archive conversion. */
export function removeDnd5eActionEffects(
  connection: DatabaseSync,
  formatVersion: EffectStepArchiveFormat,
): string[] {
  const update = connection.prepare(
    'UPDATE journal_entries SET data_json = ? WHERE id = ?',
  );
  let characterCount = 0;
  let spellCount = 0;
  for (const [typeId, strip] of [
    [DND5E_CHARACTER_ENTRY_TYPE_ID, stripDnd5eCharacterActionEffects],
    [DND5E_SPELL_ENTRY_TYPE_ID, stripDnd5eSpellRollActionEffects],
  ] as const) {
    const rows = connection.prepare(
      `SELECT id, name, data_json
       FROM journal_entries
       WHERE type_id = ?
       ORDER BY position`,
    ).all(typeId) as unknown as JournalRow[];
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data_json);
      } catch {
        throw new Error(
          `Archive format ${formatVersion} contains malformed ${
            typeId === DND5E_CHARACTER_ENTRY_TYPE_ID ? 'Character' : 'Spell'
          } data for ${row.name}.`,
        );
      }
      const stripped = strip(parsed);
      if (!stripped) {
        throw new Error(
          `Archive format ${formatVersion} contains an invalid authored ` +
            `Effect step for ${row.name}.`,
        );
      }
      if (stripped.removedCount === 0) continue;
      update.run(JSON.stringify(stripped.value), row.id);
      if (typeId === DND5E_CHARACTER_ENTRY_TYPE_ID) {
        characterCount += stripped.removedCount;
      } else {
        spellCount += stripped.removedCount;
      }
    }
  }
  return [
    ...removalWarning(characterCount, 'Character Actions', formatVersion),
    ...removalWarning(spellCount, 'Spell Roll Actions', formatVersion),
  ];
}

/** Ensures the final format-13 conversion produced today's D&D authored data. */
export function assertCurrentDnd5eActionData(
  connection: DatabaseSync,
  formatVersion: 13,
): void {
  for (const [typeId, validate, kind] of [
    [DND5E_CHARACTER_ENTRY_TYPE_ID, isDnd5eCharacterData, 'Character'],
    [DND5E_SPELL_ENTRY_TYPE_ID, isDnd5eSpellData, 'Spell'],
  ] as const) {
    const rows = connection.prepare(
      `SELECT name, data_json
       FROM journal_entries
       WHERE type_id = ?
       ORDER BY position`,
    ).all(typeId) as unknown as Array<Pick<JournalRow, 'data_json' | 'name'>>;
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data_json);
      } catch {
        parsed = null;
      }
      if (!validate(parsed as JsonValue)) {
        throw new Error(
          `Archive format ${formatVersion} contains invalid ${kind} data for ${row.name}.`,
        );
      }
    }
  }
}
