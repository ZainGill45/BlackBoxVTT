import type { DatabaseSync } from 'node:sqlite';
import { markFixedDnd5eSpellFlatScaling } from './campaignArchiveSpellFlatScaling';
import { runDirectArchiveConversion } from './campaignArchiveSteps';
import { addDefaultDnd5eCharacterTokens } from './campaignArchiveCharacterDefaultToken';

/** Directly marks format-14 Spell Flat Values as fixed in today's shape. */
export function convertCampaignArchiveFormat14(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () => {
    const warnings = markFixedDnd5eSpellFlatScaling(connection, 14);
    const tokenWarnings = addDefaultDnd5eCharacterTokens(connection, 14);
    return [...warnings, ...tokenWarnings];
  });
}
