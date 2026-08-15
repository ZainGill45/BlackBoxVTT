import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { removeDnd5eDeathSaves } from './campaignArchiveCharacterHealth';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-8 Character Health into today's shape. */
export function convertCampaignArchiveFormat8(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  let effectWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    effectWarnings = removeDnd5eActionEffects(connection, 8);
    warnings = removeDnd5eDeathSaves(connection, 8);
  });
  return [...warnings, ...effectWarnings];
}
