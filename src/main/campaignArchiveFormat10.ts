import type { DatabaseSync } from 'node:sqlite';
import { addDefaultDnd5eSpellcasting } from './campaignArchiveCharacterSpellcasting';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-10 Character data into today's shape. */
export function convertCampaignArchiveFormat10(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = addDefaultDnd5eSpellcasting(connection, 10);
  });
  return warnings;
}
