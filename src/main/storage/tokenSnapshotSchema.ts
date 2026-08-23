import type { DatabaseSync } from 'node:sqlite';

export const TOKEN_SNAPSHOT_TABLE = 'scene_token_snapshots';

/**
 * Template-token state belongs to the token instance rather than the Journal.
 * The root entry intentionally is not a foreign key: deleting the source may
 * leave a durable orphan whose provenance and snapshot must remain intact.
 */
export function createTokenSnapshotSchema(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE scene_token_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      scene_id TEXT NOT NULL,
      root_entry_id TEXT NOT NULL,
      type_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
      data_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX scene_token_snapshots_root
      ON scene_token_snapshots (root_entry_id, id);
    CREATE INDEX scene_token_snapshots_scene
      ON scene_token_snapshots (scene_id, id);
  `);
}
