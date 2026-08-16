import type { DatabaseSync } from 'node:sqlite';
import {
  assertCurrentDnd5eActionData,
  removeDnd5eActionEffects,
} from './campaignArchiveDnd5eActionEffects';
import { markFixedDnd5eSpellFlatScaling } from './campaignArchiveSpellFlatScaling';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly removes format-13 authored Effect steps from today's shape. */
export function convertCampaignArchiveFormat13(
  connection: DatabaseSync,
): string[] {
  return runDirectArchiveConversion(connection, () => {
    const warnings = removeDnd5eActionEffects(connection, 13);
    const flatWarnings = markFixedDnd5eSpellFlatScaling(connection, 13);
    assertCurrentDnd5eActionData(connection, 13);
    return [...warnings, ...flatWarnings];
  });
}
