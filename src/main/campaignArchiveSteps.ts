import type { DatabaseSync } from 'node:sqlite';
import { addEmptyDnd5eCharacterInventories } from './campaignArchiveCharacterInventory';

/**
 * Fix-ups that more than one archive format happens to need.
 *
 * Sharing a step is not the same as chaining a conversion: every converter
 * still takes its own format straight to today's shape, and none of them runs
 * another format's converter to get there.
 */

/**
 * Runs one direct converter with foreign-key enforcement paused while parent
 * tables are rebuilt. The completed schema is checked before it commits and
 * the caller's connection setting is always restored.
 */
export function runDirectArchiveConversion<T>(
  connection: DatabaseSync,
  convert: () => T,
): T {
  const foreignKeys = connection
    .prepare('PRAGMA foreign_keys')
    .get() as { foreign_keys?: unknown } | undefined;
  const restoreForeignKeys = foreignKeys?.foreign_keys === 1;
  let transactionOpen = false;
  connection.exec('PRAGMA foreign_keys = OFF');
  try {
    connection.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    const result = convert();
    if (connection.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('Archive conversion produced invalid foreign keys.');
    }
    connection.exec('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) connection.exec('ROLLBACK');
    throw error;
  } finally {
    connection.exec(
      `PRAGMA foreign_keys = ${restoreForeignKeys ? 'ON' : 'OFF'}`,
    );
  }
}

/**
 * Journal entries gained their own permission counter when permission editing
 * became continuous, so an archive written before that carries no column.
 */
export function addJournalEntryPermissionRevision(
  connection: DatabaseSync,
): void {
  rebuildJournalEntries(connection, false);
}

function rebuildJournalEntries(
  connection: DatabaseSync,
  preservePermissionRevision: boolean,
): void {
  const permissionRevision = preservePermissionRevision
    ? 'permission_revision'
    : '0';
  connection.exec(`
    CREATE TABLE journal_entries_current (
      id TEXT PRIMARY KEY NOT NULL,
      type_id TEXT NOT NULL,
      position INTEGER UNIQUE NOT NULL CHECK (position >= 0),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
      default_access TEXT NOT NULL CHECK (
        default_access IN ('none', 'view', 'edit')
      ),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      name_style_json TEXT NOT NULL,
      data_json TEXT NOT NULL,
      permission_revision INTEGER NOT NULL CHECK (permission_revision >= 0)
    ) STRICT;
    INSERT INTO journal_entries_current (
      id, type_id, position, name, default_access, revision,
      created_at, created_by, updated_at, updated_by,
      name_style_json, data_json, permission_revision
    )
    SELECT id, type_id, position, name, default_access, revision,
           created_at, created_by, updated_at, updated_by,
           name_style_json, data_json, ${permissionRevision}
    FROM journal_entries;
    DROP TABLE journal_entries;
    ALTER TABLE journal_entries_current RENAME TO journal_entries;
  `);
}

/**
 * Storage gained per-asset access when the library became the Game Master's to
 * curate. An archive written before that has no access to carry over, so every
 * imported asset lands on the same default a newly added one would.
 */
export function addAssetPermissions(connection: DatabaseSync): string[] {
  rebuildAssets(connection, false);
  connection.exec(`
    CREATE TABLE asset_permissions (
      asset_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
      PRIMARY KEY (asset_id, user_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX asset_permissions_user
      ON asset_permissions (user_id, asset_id);
  `);
  return countRows(connection, 'assets', (count, plural) =>
    `Set ${count} Storage ${plural ? 'assets' : 'asset'} to no player ` +
    'access; grant access from Storage to share them again.',
  );
}

function rebuildAssets(
  connection: DatabaseSync,
  preservePermissions: boolean,
): void {
  const defaultAccess = preservePermissions ? 'default_access' : "'none'";
  const permissionRevision = preservePermissions ? 'permission_revision' : '0';
  connection.exec(`
    CREATE TABLE assets_current (
      id TEXT PRIMARY KEY NOT NULL,
      position INTEGER UNIQUE NOT NULL CHECK (position >= 0),
      record_json TEXT NOT NULL,
      default_access TEXT NOT NULL CHECK (
        default_access IN ('none', 'view', 'edit')
      ),
      permission_revision INTEGER NOT NULL CHECK (permission_revision >= 0)
    ) STRICT;
    INSERT INTO assets_current (
      id, position, record_json, default_access, permission_revision
    )
    SELECT id, position, record_json, ${defaultAccess}, ${permissionRevision}
    FROM assets;
    DROP TABLE assets;
    ALTER TABLE assets_current RENAME TO assets;
  `);
}

/**
 * Scenes gained per-scene access when the Scenes tab became something a player
 * could be given a place in. An archive written before that has no access to
 * carry over, so every imported scene lands on the same default a newly
 * created one would.
 */
export function addScenePermissions(connection: DatabaseSync): string[] {
  rebuildScenes(connection, false);
  connection.exec(`
    CREATE TABLE scene_permissions (
      scene_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
      PRIMARY KEY (scene_id, user_id),
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX scene_permissions_user
      ON scene_permissions (user_id, scene_id);
  `);
  return countRows(connection, 'scenes', (count, plural) =>
    `Set ${count} ${plural ? 'scenes' : 'scene'} to no player access; grant ` +
    'access from the Scenes tab to share them again.',
  );
}

function rebuildScenes(
  connection: DatabaseSync,
  preservePermissions: boolean,
): void {
  const defaultAccess = preservePermissions ? 'default_access' : "'none'";
  const permissionRevision = preservePermissions ? 'permission_revision' : '0';
  connection.exec(`
    CREATE TABLE scenes_current (
      id TEXT PRIMARY KEY NOT NULL,
      position INTEGER UNIQUE NOT NULL CHECK (position >= 0),
      record_json TEXT NOT NULL,
      default_access TEXT NOT NULL CHECK (
        default_access IN ('none', 'view', 'edit')
      ),
      permission_revision INTEGER NOT NULL CHECK (permission_revision >= 0)
    ) STRICT;
    INSERT INTO scenes_current (
      id, position, record_json, default_access, permission_revision
    )
    SELECT id, position, record_json, ${defaultAccess}, ${permissionRevision}
    FROM scenes;
    DROP TABLE scenes;
    ALTER TABLE scenes_current RENAME TO scenes;
  `);
}

/**
 * Rebuilds the exact intermediate permission schema into format 4 without
 * changing any access values or revisions. Its permission tables are already
 * present and remain attached to the canonical parent tables after the swap.
 */
export function normalizeIntermediatePermissionSchema(
  connection: DatabaseSync,
): string[] {
  let warnings: string[] = [];
  runDirectArchiveConversion(connection, () => {
    rebuildJournalEntries(connection, true);
    rebuildAssets(connection, true);
    rebuildScenes(connection, true);
    warnings = addEmptyDnd5eCharacterInventories(connection, 4);
  });
  return warnings;
}

/**
 * Says what a step did, or nothing when it had nothing to do.
 *
 * Access is the one thing these steps cannot carry over, because the archive
 * never held any, so what they silently make private is worth reporting.
 */
function countRows(
  connection: DatabaseSync,
  table: 'assets' | 'scenes',
  describe: (count: number, plural: boolean) => string,
): string[] {
  const count = (
    connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
      | { count?: number }
      | undefined
  )?.count ?? 0;
  return count === 0 ? [] : [describe(count, count !== 1)];
}
