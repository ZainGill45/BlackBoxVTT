import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { addDefaultDnd5eSkillOffsets } from './campaignArchiveCharacterSkills';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-7 Character Skills into today's editable shape. */
export function convertCampaignArchiveFormat7(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  let effectWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    effectWarnings = removeDnd5eActionEffects(connection, 7);
    warnings = addDefaultDnd5eSkillOffsets(connection, 7);
  });
  return [...warnings, ...effectWarnings];
}
