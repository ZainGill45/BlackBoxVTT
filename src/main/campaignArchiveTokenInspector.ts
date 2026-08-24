import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

const DEFAULT_INSPECTOR = { fieldIds: ['health', 'armor-class'] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function addDefaultDnd5eTokenInspectorToValue(
  value: unknown,
): Dnd5eCharacterData | null {
  if (
    !isRecord(value) ||
    !isRecord(value.defaultToken) ||
    Object.hasOwn(value.defaultToken, 'inspector')
  ) return null;
  const converted = {
    ...value,
    defaultToken: {
      ...value.defaultToken,
      inspector: structuredClone(DEFAULT_INSPECTOR),
    },
  };
  return isDnd5eCharacterData(converted as JsonValue)
    ? converted as unknown as Dnd5eCharacterData
    : null;
}

export function isDnd5eCharacterDataBeforeTokenInspector(
  value: unknown,
): boolean {
  return addDefaultDnd5eTokenInspectorToValue(value) !== null;
}

function addToRows(
  connection: DatabaseSync,
  table: 'journal_entries' | 'scene_token_snapshots',
): number {
  const rows = connection.prepare(
    `SELECT id, data_json FROM ${table}
     WHERE type_id = ? ORDER BY id`,
  ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as Array<{
    data_json: string;
    id: string;
  }>;
  const update = connection.prepare(
    `UPDATE ${table} SET data_json = ? WHERE id = ?`,
  );
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      parsed = null;
    }
    const converted = addDefaultDnd5eTokenInspectorToValue(parsed);
    if (!converted) {
      throw new Error(
        `Archive format 18 contains invalid Character data for ${row.id}.`,
      );
    }
    update.run(JSON.stringify(converted), row.id);
  }
  return rows.length;
}

export function addDefaultDnd5eTokenInspectors(
  connection: DatabaseSync,
): string[] {
  const characters = addToRows(connection, 'journal_entries');
  const snapshots = addToRows(connection, 'scene_token_snapshots');
  return characters === 0 && snapshots === 0
    ? []
    : [
        `Added default Token Inspector fields to ${characters} D&D ${
          characters === 1 ? 'character' : 'characters'
        } and ${snapshots} Template token ${
          snapshots === 1 ? 'snapshot' : 'snapshots'
        } imported from archive format 18.`,
      ];
}
