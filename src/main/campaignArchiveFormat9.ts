import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { addEmptyDnd5eCustomSkills } from './campaignArchiveCharacterCustomSkills';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-9 Character data into today's shape. */
export function convertCampaignArchiveFormat9(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  let effectWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    effectWarnings = removeDnd5eActionEffects(connection, 9);
    warnings = addEmptyDnd5eCustomSkills(connection, 9);
  });
  return [...warnings, ...effectWarnings];
}
