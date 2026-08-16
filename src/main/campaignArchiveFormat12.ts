import type { DatabaseSync } from 'node:sqlite';
import { removeDnd5eActionEffects } from './campaignArchiveDnd5eActionEffects';
import { addEmptyDnd5eCharacterSpellReferences } from './campaignArchiveCharacterSpellReferences';
import { markFixedDnd5eSpellFlatScaling } from './campaignArchiveSpellFlatScaling';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly converts format-12 Character spell membership into today's shape. */
export function convertCampaignArchiveFormat12(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () => {
    const effectWarnings = removeDnd5eActionEffects(connection, 12);
    return [
      ...addEmptyDnd5eCharacterSpellReferences(connection, 12),
      ...effectWarnings,
      ...markFixedDnd5eSpellFlatScaling(connection, 12),
    ];
  });
}
