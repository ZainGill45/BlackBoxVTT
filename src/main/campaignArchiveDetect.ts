import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseCampaignSystemState } from '../systems/catalog';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from '../systems/dnd5e/ids';

/**
 * Reading a campaign database that this release cannot open.
 *
 * Salvage starts where import does not: a local campaign directory carries no
 * export manifest, so nothing in it declares which release wrote it. The shape
 * of the database has to answer that instead, and it answers conservatively —
 * an exact match against a frozen historical schema, or no answer at all. A
 * near match is not a match: running a converter against a shape it was not
 * written for produces plausible-looking wreckage, which is worse for the
 * Game Master than being turned away.
 */

export type HistoricalCampaignFormatVersion = 1 | 2 | 3 | 4;

export type CampaignSalvageConversion =
  | 1
  | 2
  | 3
  | 'permission-defaults';

export type CampaignFormatDetection =
  | { ok: true; version: 1 | 2 | 3 }
  | { conversion: 'permission-defaults'; ok: true; version: 4 }
  | { ok: false; reason: string };

type TableColumns = Readonly<Record<string, readonly string[]>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Exact sqlite_schema fingerprint shared by the untouched format 1, 2, and 3
 * fixtures. Unlike a column inventory, it covers table constraints, STRICT
 * declarations, foreign keys, and explicit indexes as well as column names.
 * Historical fingerprints are permitted only at this archive boundary.
 */
const HISTORICAL_SCHEMA_FINGERPRINT =
  'cfee25290bb4e5b885855a8b8f5d8186a42a5983dc8d4756d7aa8c9a86a9bdaf';

/**
 * An exact intermediate schema briefly written while unified permissions were
 * being developed. It already has the format-4 columns and permission tables,
 * but the columns added with ALTER TABLE retain defaults and lack today's
 * canonical CHECK constraints. Recognizing only this frozen fingerprint keeps
 * the compatibility exception at the salvage boundary.
 */
const INTERMEDIATE_PERMISSION_SCHEMA_FINGERPRINT =
  'bd4db2dae28afa69a369503018a8c043cb8a40c8d2da5bb5d1552228157da56e';

function schemaFingerprint(connection: DatabaseSync): string {
  const rows = connection
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
         AND type IN ('table', 'index', 'trigger')
         AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all() as unknown as Array<{
    name: string;
    sql: string;
    tbl_name: string;
    type: string;
  }>;
  const canonical = rows.map(({ name, sql, tbl_name, type }) => [
    type,
    name,
    tbl_name,
    sql,
  ]);
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

function readTableColumns(connection: DatabaseSync): TableColumns {
  const tables = connection
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as unknown as Array<{ name: string }>;
  const schema: Record<string, string[]> = {};
  for (const { name } of tables) {
    schema[name] = (
      connection
        .prepare(`PRAGMA table_info('${name.replaceAll("'", "''")}')`)
        .all() as unknown as Array<{ name: string }>
    ).map((column) => column.name);
  }
  return schema;
}

/**
 * Whether the database already carries everything today's schema added.
 *
 * This only picks a clearer refusal message. It never selects a converter: a
 * campaign that reaches here is unreadable for some reason other than its age,
 * and saying so beats telling the Game Master their campaign is simply too old.
 */
function looksCurrent(schema: TableColumns): boolean {
  return (
    Object.hasOwn(schema, 'asset_permissions') &&
    (schema.assets?.includes('default_access') ?? false) &&
    (schema.journal_entries?.includes('permission_revision') ?? false) &&
    Object.hasOwn(schema, 'scene_permissions') &&
    (schema.scenes?.includes('default_access') ?? false)
  );
}

/**
 * Formats 1, 2, and 3 share one schema and part only over D&D character data:
 * 1 kept neither Resources nor Features, 2 kept Resources, 3 kept both.
 */
function detectCharacterEra(
  connection: DatabaseSync,
): CampaignFormatDetection {
  const rows = connection
    .prepare(
      `SELECT name, data_json FROM journal_entries
       WHERE type_id = ?
       ORDER BY position`,
    )
    .all(DND5E_CHARACTER_ENTRY_TYPE_ID) as unknown as Array<{
    data_json: string;
    name: string;
  }>;
  if (rows.length === 0) {
    /* With no characters the three formats are the same campaign and convert
       identically, so any of them is the right answer. Reporting the newest
       claims the least about a release nothing here can distinguish. */
    return { ok: true, version: 3 };
  }
  const shapes = new Set<string>();
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      return {
        ok: false,
        reason: `This campaign’s character “${row.name}” cannot be read.`,
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        reason: `This campaign’s character “${row.name}” cannot be read.`,
      };
    }
    shapes.add(
      `${Object.hasOwn(parsed, 'resources') ? 'r' : '-'}` +
        `${Object.hasOwn(parsed, 'features') ? 'f' : '-'}`,
    );
  }
  if (shapes.size !== 1) {
    return {
      ok: false,
      reason:
        'This campaign’s characters were not all written by the same ' +
        'release, so Salvage cannot tell which one to convert from.',
    };
  }
  switch ([...shapes][0]) {
    case '--':
      return { ok: true, version: 1 };
    case 'r-':
      return { ok: true, version: 2 };
    case 'rf':
      return { ok: true, version: 3 };
    default:
      return {
        ok: false,
        reason:
          'This campaign’s character data matches no release that Salvage ' +
          'can convert.',
      };
  }
}

/** Which superseded release wrote this campaign, if any release did. */
export function detectCampaignFormatVersion(
  connection: DatabaseSync,
): CampaignFormatDetection {
  const fingerprint = schemaFingerprint(connection);
  if (fingerprint === HISTORICAL_SCHEMA_FINGERPRINT) {
    return detectCharacterEra(connection);
  }
  if (fingerprint === INTERMEDIATE_PERMISSION_SCHEMA_FINGERPRINT) {
    return {
      conversion: 'permission-defaults',
      ok: true,
      version: 4,
    };
  }
  const schema = readTableColumns(connection);
  return {
    ok: false,
    reason: looksCurrent(schema)
      ? 'This campaign’s structure is already current, so an outdated ' +
        'format is not what makes it unreadable.'
      : 'This campaign’s structure matches no earlier release that Salvage ' +
        'can convert.',
  };
}

/** The reason this campaign's game system cannot be opened here, or null. */
export function findUnsupportedSystemReason(
  connection: DatabaseSync,
): string | null {
  const row = connection
    .prepare(
      `SELECT system_id, settings_json FROM campaign_system
       WHERE singleton = 1`,
    )
    .get() as { settings_json?: unknown; system_id?: unknown } | undefined;
  if (typeof row?.system_id !== 'string' || typeof row.settings_json !== 'string') {
    return 'This campaign does not record which game system it uses.';
  }
  let settings: unknown;
  try {
    settings = JSON.parse(row.settings_json);
  } catch {
    settings = null;
  }
  return parseCampaignSystemState({ id: row.system_id, settings })
    ? null
    : `This campaign’s game system (“${row.system_id}”) is not one this ` +
        'version of BlackBox VTT can open.';
}

/**
 * The campaign's own ID and name, read without the canonical validators.
 *
 * Salvage carries these forward so the converted database can be checked
 * against what the original claimed, the same way an import is checked against
 * its export manifest.
 */
export function readCampaignIdentity(
  connection: DatabaseSync,
): { id: string; name: string } | null {
  const row = connection
    .prepare(
      `SELECT campaign_id, name FROM campaign_metadata WHERE singleton = 1`,
    )
    .get() as { campaign_id?: unknown; name?: unknown } | undefined;
  if (
    typeof row?.campaign_id !== 'string' ||
    !UUID_PATTERN.test(row.campaign_id) ||
    typeof row.name !== 'string' ||
    row.name.normalize('NFKC').trim() !== row.name ||
    row.name.length < 1 ||
    row.name.length > 64
  ) {
    return null;
  }
  return { id: row.campaign_id, name: row.name };
}
