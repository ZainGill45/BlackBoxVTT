import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCharacterActions } from './campaignArchiveCharacterActions';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-6 Character data into today's shape. */
export function convertCampaignArchiveFormat6(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    warnings = addEmptyDnd5eCharacterActions(connection, 6);
  });
  return warnings;
}
