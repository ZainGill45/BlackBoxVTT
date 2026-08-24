import type { DatabaseSync } from 'node:sqlite';
import { addDefaultDnd5eTokenInspectors } from './campaignArchiveTokenInspector';

/** Directly adds system-default Token Inspector layouts to format 18. */
export function convertCampaignArchiveFormat18(
  connection: DatabaseSync,
): string[] {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const warnings = addDefaultDnd5eTokenInspectors(connection);
    if (connection.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('Archive conversion produced invalid foreign keys.');
    }
    connection.exec('COMMIT');
    return warnings;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}
