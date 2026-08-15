import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { addDefaultDnd5eSpellcasting } from './campaignArchiveCharacterSpellcasting';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-10 Character data into today's shape. */
export function convertCampaignArchiveFormat10(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  let effectWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    effectWarnings = removeDnd5eActionEffects(connection, 10);
    warnings = addDefaultDnd5eSpellcasting(connection, 10);
  });
  return [...warnings, ...effectWarnings];
}
