import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCustomSkills } from './campaignArchiveCharacterCustomSkills';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-9 Character data into today's shape. */
export function convertCampaignArchiveFormat9(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = addEmptyDnd5eCustomSkills(connection, 9);
  });
  return warnings;
}
