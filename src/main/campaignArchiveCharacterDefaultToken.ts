import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

const DEFAULT_TOKEN: Dnd5eCharacterData['defaultToken'] = {
  imageAssetId: null,
  inspector: { fieldIds: ['health', 'armor-class'] },
  size: { height: 1, width: 1 },
  type: 'linked',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function addDefaultDnd5eTokenToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (!isRecord(value) || Object.hasOwn(value, 'defaultToken')) return null;
  const converted = { ...value, defaultToken: structuredClone(DEFAULT_TOKEN) };
  return isDnd5eCharacterData(converted as JsonValue)
    ? converted as unknown as Dnd5eCharacterData
    : null;
}

export function isDnd5eCharacterDataBeforeDefaultToken(
  value: unknown,
): boolean {
  return addDefaultDnd5eTokenToValue(value) !== null;
}

export function defaultTokenImportReport(
  characterCount: number,
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15,
): string[] {
  return characterCount === 0
    ? []
    : [
        `Added a 1-by-1 default token using built-in artwork to ${characterCount} D&D ${
          characterCount === 1 ? 'character' : 'characters'
        } imported from archive format ${formatVersion}.`,
      ];
}

export function addDefaultDnd5eCharacterTokens(
  connection: DatabaseSync,
  formatVersion: 13 | 14 | 15,
): string[] {
  const rows = connection.prepare(
    `SELECT id, name, data_json
     FROM journal_entries
     WHERE type_id = ?
     ORDER BY position`,
  ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as Array<{
    data_json: string;
    id: string;
    name: string;
  }>;
  const update = connection.prepare(
    'UPDATE journal_entries SET data_json = ? WHERE id = ?',
  );
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      parsed = null;
    }
    const converted = addDefaultDnd5eTokenToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format ${formatVersion} contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return defaultTokenImportReport(rows.length, formatVersion);
}
