import type { DatabaseSync } from 'node:sqlite';
import { runDirectArchiveConversion } from './campaignArchiveSteps';

/** Directly accepts format-11 authored data in today's expanded system catalog. */
export function convertCampaignArchiveFormat11(
  connection: DatabaseSync,
): string[] {
  runDirectArchiveConversion(connection, () => undefined);
  return [];
}
