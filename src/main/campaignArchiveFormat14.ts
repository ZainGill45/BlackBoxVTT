import type { DatabaseSync } from 'node:sqlite';
import { markFixedDnd5eSpellFlatScaling } from './campaignArchiveSpellFlatScaling';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly marks format-14 Spell Flat Values as fixed in today's shape. */
export function convertCampaignArchiveFormat14(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(
    connection,
    () => markFixedDnd5eSpellFlatScaling(connection, 14),
  );
}
