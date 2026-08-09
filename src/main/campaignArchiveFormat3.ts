import type { DatabaseSync } from 'node:sqlite';
import {
  addAssetPermissions,
  addJournalEntryPermissionRevision,
  addScenePermissions,
  runDirectArchiveConversion,
} from './campaignArchiveSteps';

/** Directly converts the previous archive's authored data into today's shape. */
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
  });
  /* Journal entries keep the permissions they were exported with and only
     gain a counter guarding edits to them, so the access that could not be
     carried over is all there is to report. */
  return accessWarnings;
}
