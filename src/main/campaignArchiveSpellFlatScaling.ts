import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import { DND5E_SPELL_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import {
  isDnd5eSpellData,
  type Dnd5eSpellData,
} from '../systems/dnd5e/spellData';

interface JournalRow {
  data_json: string;
  id: string;
  name: string;
}

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

/** Converts only the exact Flat Value shape written through archive format 14. */
export function convertDnd5eSpellFlatScalingFromFormat14(
  value: unknown,
): { convertedCount: number; data: Dnd5eSpellData } | null {
  if (!isRecord(value) || !Array.isArray(value.rollSteps)) return null;
  let convertedCount = 0;
  let invalidFlatTerm = false;
  const rollSteps = value.rollSteps.map((step) => {
    if (!isRecord(step) || !Array.isArray(step.terms)) return step;
    const terms = step.terms.map((term) => {
      if (!isRecord(term) || term.kind !== 'flat') return term;
      if (
        !hasExactKeys(term, ['kind', 'value']) ||
        !Number.isSafeInteger(term.value)
      ) {
        invalidFlatTerm = true;
        return term;
      }
      convertedCount += 1;
      return {
        kind: 'flat',
        scaling: 'fixed',
        tiers: [],
        value: term.value,
      };
    });
    return { ...step, terms };
  });
  const converted = { ...value, rollSteps };
  if (
    invalidFlatTerm ||
    !isDnd5eSpellData(converted as JsonValue)
  ) {
    return null;
  }
  return { convertedCount, data: converted as Dnd5eSpellData };
}

/** Marks legacy Spell Flat Values as fixed in a direct archive conversion. */
export function markFixedDnd5eSpellFlatScaling(
  connection: DatabaseSync,
  formatVersion: 12 | 13 | 14,
): string[] {
  const rows = connection.prepare(
    `SELECT id, name, data_json
     FROM journal_entries
     WHERE type_id = ?
     ORDER BY position`,
  ).all(DND5E_SPELL_ENTRY_TYPE_ID) as unknown as JournalRow[];
  const update = connection.prepare(
    'UPDATE journal_entries SET data_json = ? WHERE id = ?',
  );
  let convertedCount = 0;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      throw new Error(
        `Archive format ${formatVersion} contains malformed Spell data for ${row.name}.`,
      );
    }
    const converted = convertDnd5eSpellFlatScalingFromFormat14(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Spell data for ${row.name}.`,
      );
    }
    convertedCount += converted.convertedCount;
    if (converted.convertedCount > 0) {
      update.run(JSON.stringify(converted.data), row.id);
    }
  }
  if (convertedCount === 0) return [];
  return [
    `Marked ${convertedCount} D&D Spell Flat Value ${
      convertedCount === 1 ? 'term' : 'terms'
    } as fixed when importing archive format ${formatVersion}.`,
  ];
}
