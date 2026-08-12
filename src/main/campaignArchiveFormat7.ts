import type { DatabaseSync } from 'node:sqlite';
import { addDefaultDnd5eSkillOffsets } from './campaignArchiveCharacterSkills';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-7 Character Skills into today's editable shape. */
export function convertCampaignArchiveFormat7(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = addDefaultDnd5eSkillOffsets(connection, 7);
  });
  return warnings;
}
