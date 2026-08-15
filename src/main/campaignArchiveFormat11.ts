import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { addEmptyDnd5eCharacterSpellReferences } from './campaignArchiveCharacterSpellReferences';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-11 Character spell membership into today's shape. */
export function convertCampaignArchiveFormat11(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () => {
    const effectWarnings = removeDnd5eActionEffects(connection, 11);
    return [
      ...addEmptyDnd5eCharacterSpellReferences(connection, 11),
      ...effectWarnings,
    ];
  });
}
