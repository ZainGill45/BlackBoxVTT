import type { DatabaseSync } from 'node:sqlite';

/**
 * Reproduces the exact permission schema written by the intermediate build
 * that existed before format 4 settled on its canonical CHECK constraints.
 * Keep its SQL formatting frozen: salvage recognition fingerprints the full
 * SQLite schema rather than accepting a loose collection of columns.
 */
export function addIntermediatePermissionSchema(
  connection: DatabaseSync,
): void {
  connection.exec(`
     ALTER TABLE journal_entries
       ADD COLUMN permission_revision INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE assets
       ADD COLUMN default_access TEXT NOT NULL DEFAULT 'none';
     ALTER TABLE assets
       ADD COLUMN permission_revision INTEGER NOT NULL DEFAULT 0;
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
     ALTER TABLE scenes
       ADD COLUMN default_access TEXT NOT NULL DEFAULT 'none';
     ALTER TABLE scenes
       ADD COLUMN permission_revision INTEGER NOT NULL DEFAULT 0;
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
}
