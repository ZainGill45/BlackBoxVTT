import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCharacterSpellReferences } from './campaignArchiveCharacterSpellReferences';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-12 Character spell membership into today's shape. */
export function convertCampaignArchiveFormat12(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(
    connection,
    () => addEmptyDnd5eCharacterSpellReferences(connection, 12),
  );
}
