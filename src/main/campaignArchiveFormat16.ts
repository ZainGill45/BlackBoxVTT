import type { DatabaseSync } from 'node:sqlite';
import { addLinkedDnd5eCharacterTokenTypes } from './campaignArchiveCharacterTokenType';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly adds the Character Token Type written from format 17 onward. */
export function convertCampaignArchiveFormat16(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () =>
    addLinkedDnd5eCharacterTokenTypes(connection),
  );
}
