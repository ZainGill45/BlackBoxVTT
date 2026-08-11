import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCharacterInventories } from './campaignArchiveCharacterInventory';
import {
  addAssetPermissions,
  addJournalEntryPermissionRevision,
  addScenePermissions,
  runDirectArchiveConversion,
} from './campaignArchiveSteps';

/** Directly converts format-3 authored data into today's shape. */
export function convertCampaignArchiveFormat3(
  connection: DatabaseSync,
): string[] {
  const accessWarnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    addJournalEntryPermissionRevision(connection);
    accessWarnings.push(
      ...addAssetPermissions(connection),
      ...addScenePermissions(connection),
    );
    accessWarnings.push(...addEmptyDnd5eCharacterInventories(connection, 3));
  });
  /* Journal entries keep the permissions they were exported with and only
     gain a counter guarding edits to them. Character inventories are added
     explicitly above and reported alongside any access adjustments. */
  return accessWarnings;
}
