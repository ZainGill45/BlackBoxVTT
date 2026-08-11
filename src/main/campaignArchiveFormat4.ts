import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCharacterInventories } from './campaignArchiveCharacterInventory';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-4 Character data into today's shape. */
export function convertCampaignArchiveFormat4(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = addEmptyDnd5eCharacterInventories(connection, 4);
  });
  return warnings;
}
