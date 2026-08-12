import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eDeathSaves } from './campaignArchiveCharacterHealth';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-8 Character Health into today's shape. */
export function convertCampaignArchiveFormat8(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = removeDnd5eDeathSaves(connection, 8);
  });
  return warnings;
}
