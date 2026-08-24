import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import {
  formatDnd5eHealthDecimal,
  parseDnd5eHealthDecimal,
} from '../systems/dnd5e/tokenHealth';

interface DataRow {
  data_json: string;
  id: string;
}

function normalizeHealth(value: unknown): Dnd5eCharacterData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = structuredClone(value) as Dnd5eCharacterData;
  if (
    !candidate.health ||
    typeof candidate.health.currentHitPoints !== 'string' ||
    typeof candidate.health.maximumHitPoints !== 'string'
  ) {
    return null;
  }
  const shapeProbe = structuredClone(candidate);
  shapeProbe.health.currentHitPoints = '1';
  shapeProbe.health.maximumHitPoints = '1';
  if (!isDnd5eCharacterData(shapeProbe as JsonValue)) return null;

  const current = parseDnd5eHealthDecimal(candidate.health.currentHitPoints);
  const maximum = parseDnd5eHealthDecimal(candidate.health.maximumHitPoints);
  candidate.health.currentHitPoints = current === null
    ? '1'
    : formatDnd5eHealthDecimal(current);
  candidate.health.maximumHitPoints = maximum === null
    ? '1'
    : formatDnd5eHealthDecimal(maximum);
  return isDnd5eCharacterData(candidate as JsonValue) ? candidate : null;
}

export function isDnd5eCharacterDataFromArchiveFormat17(
  value: unknown,
): boolean {
  return normalizeHealth(value) !== null;
}

function normalizeRows(
  connection: DatabaseSync,
  table: 'journal_entries' | 'scene_token_snapshots',
): number {
  const rows = connection.prepare(
    `SELECT id, data_json FROM ${table}
     WHERE type_id = ? ORDER BY id`,
  ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as DataRow[];
  const update = connection.prepare(
    `UPDATE ${table} SET data_json = ? WHERE id = ?`,
  );
  let adjusted = 0;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      throw new Error(`Archive format 17 contains malformed Character data for ${row.id}.`);
    }
    const converted = normalizeHealth(parsed);
    if (!converted) {
      throw new Error(`Archive format 17 contains invalid Character data for ${row.id}.`);
    }
    const next = JSON.stringify(converted);
    if (next !== row.data_json) {
      update.run(next, row.id);
      adjusted += 1;
    }
  }
  return adjusted;
}

/** Directly replaces formerly free-form HP text with current fixed values. */
export function convertCampaignArchiveFormat17(
  connection: DatabaseSync,
): string[] {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const characters = normalizeRows(connection, 'journal_entries');
    const snapshots = normalizeRows(connection, 'scene_token_snapshots');
    const warnings = characters === 0 && snapshots === 0 ? [] : [
      `Replaced unsupported hit-point text in ${characters} D&D ${
        characters === 1 ? 'character' : 'characters'
      } and ${snapshots} Template token ${
        snapshots === 1 ? 'snapshot' : 'snapshots'
      } imported from archive format 17.`,
    ];
    if (connection.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('Archive conversion produced invalid foreign keys.');
    }
    connection.exec('COMMIT');
    return warnings;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}
