import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue } from '../shared/gameSystems';
import {
  isDnd5eCharacterData,
  type Dnd5eCharacterData,
  type Dnd5eCharacterInventoryEntry,
} from '../systems/dnd5e/characterData';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';
import {
  addEmptyDnd5eCharacterActionsToValue,
  emptyActionsImportReport,
} from './campaignArchiveCharacterActions';
import { deathSavesRemovalImportReport } from './campaignArchiveCharacterHealth';
import { emptyCustomSkillsImportReport } from './campaignArchiveCharacterCustomSkills';
import { skillOffsetsImportReport } from './campaignArchiveCharacterSkills';
import { spellcastingDefaultsImportReport } from './campaignArchiveCharacterSpellcasting';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

interface CharacterRow {
  data_json: string;
  id: string;
  name: string;
}

interface ConvertedFormat5Character {
  data: Dnd5eCharacterData;
  itemCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function convertEntry(
  value: unknown,
): { entry: Dnd5eCharacterInventoryEntry; itemCount: number } | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.weight) ||
    (value.weight as number) < 0
  ) {
    return null;
  }
  if (value.kind === 'item') {
    if (Object.hasOwn(value, 'quantity')) return null;
    return {
      entry: { ...value, quantity: 1 } as Dnd5eCharacterInventoryEntry,
      itemCount: 1,
    };
  }
  if (value.kind !== 'container' || !Array.isArray(value.contents)) return null;
  const contents: Dnd5eCharacterInventoryEntry[] = [];
  let itemCount = 0;
  for (const child of value.contents) {
    const converted = convertEntry(child);
    if (!converted) return null;
    contents.push(converted.entry);
    itemCount += converted.itemCount;
  }
  return {
    entry: { ...value, contents } as Dnd5eCharacterInventoryEntry,
    itemCount,
  };
}

/** Converts one frozen format-5 Character value without accepting near matches. */
export function convertDnd5eCharacterDataFromArchiveFormat5(
  value: unknown,
): ConvertedFormat5Character | null {
  if (!isRecord(value) || !isRecord(value.inventory)) return null;
  const entriesValue = value.inventory.entries;
  if (!Array.isArray(entriesValue)) return null;
  const entries: Dnd5eCharacterInventoryEntry[] = [];
  let itemCount = 0;
  for (const entry of entriesValue) {
    const converted = convertEntry(entry);
    if (!converted) return null;
    entries.push(converted.entry);
    itemCount += converted.itemCount;
  }
  const converted = {
    ...value,
    inventory: { ...value.inventory, entries },
  };
  const withActions = addEmptyDnd5eCharacterActionsToValue(converted);
  if (!withActions || !isDnd5eCharacterData(withActions as unknown as JsonValue)) return null;
  return { data: withActions, itemCount };
}

/** Directly converts format-5 item quantities into today's Character shape. */
export function convertCampaignArchiveFormat5(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () => {
    const rows = connection.prepare(
      `SELECT id, name, data_json
       FROM journal_entries
       WHERE type_id = ?
       ORDER BY position`,
    ).all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as CharacterRow[];
    const update = connection.prepare(
      'UPDATE journal_entries SET data_json = ? WHERE id = ?',
    );
    let adjustedCharacters = 0;
    let adjustedItems = 0;
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data_json);
      } catch {
        throw new Error(
          `Archive format 5 contains malformed Character data for ${row.name}.`,
        );
      }
      const converted = convertDnd5eCharacterDataFromArchiveFormat5(parsed);
      if (!converted) {
        throw new Error(
          `Archive format 5 contains invalid Character data for ${row.name}.`,
        );
      }
      update.run(JSON.stringify(converted.data), row.id);
      if (converted.itemCount > 0) {
        adjustedCharacters += 1;
        adjustedItems += converted.itemCount;
      }
    }
    const warnings = [
      ...emptyActionsImportReport(rows.length, 5),
      ...skillOffsetsImportReport(rows.length, 5),
      ...deathSavesRemovalImportReport(rows.length, 5),
      ...emptyCustomSkillsImportReport(rows.length, 5),
      ...spellcastingDefaultsImportReport(rows.length, 5),
    ];
    if (adjustedItems > 0) warnings.unshift(
      `Set quantity to 1 for ${adjustedItems} Inventory ${
        adjustedItems === 1 ? 'item' : 'items'
      } across ${adjustedCharacters} D&D ${
        adjustedCharacters === 1 ? 'character' : 'characters'
      } imported from archive format 5.`,
    );
    return warnings;
  });
}
