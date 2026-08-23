import type { DatabaseSync } from 'node:sqlite';
import { addDefaultDnd5eCharacterTokens } from './campaignArchiveCharacterDefaultToken';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly adds Character default-token definitions to format 15. */
export function convertCampaignArchiveFormat15(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () =>
    addDefaultDnd5eCharacterTokens(connection, 15),
  );
}
