import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function addLinkedDnd5eTokenTypeToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (!isRecord(value) || !isRecord(value.defaultToken) ||
    Object.hasOwn(value.defaultToken, 'type')) {
    return null;
  }
  const converted = {
    ...value,
    defaultToken: {
      ...value.defaultToken,
      inspector: { fieldIds: ['health', 'armor-class'] },
      type: 'linked',
    },
  };
  return isDnd5eCharacterData(converted as JsonValue)
    ? converted as unknown as Dnd5eCharacterData
    : null;
}

export function isDnd5eCharacterDataBeforeTokenType(value: unknown): boolean {
  return addLinkedDnd5eTokenTypeToValue(value) !== null;
}

export function addLinkedDnd5eCharacterTokenTypes(
  connection: DatabaseSync,
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
    const converted = addLinkedDnd5eTokenTypeToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format 16 contains invalid Character data for ${row.name}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return rows.length === 0
    ? []
    : [
        `Set ${rows.length} D&D ${
          rows.length === 1 ? 'character' : 'characters'
        } to use Linked tokens when importing archive format 16.`,
      ];
}
