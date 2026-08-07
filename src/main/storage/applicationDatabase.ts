import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class ApplicationDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;

  constructor(databasePath: string) {
    this.path = path.resolve(databasePath);
    mkdirSync(path.dirname(this.path), { recursive: true });
    const existed = existsSync(this.path);
    const connection = new DatabaseSync(this.path, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.connection = connection;
    try {
      if (!existed) {
        chmodSync(this.path, 0o600);
      }
      connection.exec('PRAGMA journal_mode = WAL');
      connection.exec('PRAGMA synchronous = FULL');
      connection.exec('PRAGMA secure_delete = ON');
      const count = Number(
        (
          connection
            .prepare(
              `SELECT COUNT(*) AS count
               FROM sqlite_schema
               WHERE name NOT LIKE 'sqlite_%'`,
            )
            .get() as { count?: unknown } | undefined
        )?.count ?? 0,
      );
      if (count === 0) {
        this.initialize();
      }
      this.validateSchema();
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }

  private initialize(): void {
    this.connection.exec('PRAGMA auto_vacuum = FULL');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE saved_connections (
          campaign_id TEXT PRIMARY KEY NOT NULL,
          campaign_name TEXT NOT NULL CHECK (length(campaign_name) BETWEEN 1 AND 64),
          certificate_fingerprint TEXT NOT NULL,
          host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
          last_connected_at TEXT NOT NULL,
          last_user_id TEXT NOT NULL,
          port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
        ) STRICT;
        CREATE TABLE saved_connection_profiles (
          campaign_id TEXT NOT NULL REFERENCES saved_connections(campaign_id)
            ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 64),
          encrypted_password BLOB NOT NULL,
          PRIMARY KEY (campaign_id, user_id)
        ) STRICT;
        CREATE INDEX saved_connections_recent
          ON saved_connections (last_connected_at DESC, campaign_id);
        CREATE TABLE remote_asset_manifests (
          campaign_id TEXT PRIMARY KEY NOT NULL,
          manifest_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE remote_asset_files (
          campaign_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          file_modified_at_ms REAL NOT NULL,
          sha256 TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
          PRIMARY KEY (campaign_id, asset_id)
        ) STRICT;
        CREATE TABLE remote_asset_partials (
          campaign_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          state_json TEXT NOT NULL,
          PRIMARY KEY (campaign_id, asset_id)
        ) STRICT;
      `);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private validateSchema(): void {
    const quickCheck = this.connection
      .prepare('PRAGMA quick_check(1)')
      .get() as Record<string, unknown> | undefined;
    if (!quickCheck || !Object.values(quickCheck).includes('ok')) {
      throw new Error('Application database integrity check failed.');
    }
    const expected = {
      saved_connection_profiles: [
        'campaign_id',
        'user_id',
        'username',
        'encrypted_password',
      ],
      saved_connections: [
        'campaign_id',
        'campaign_name',
        'certificate_fingerprint',
        'host',
        'last_connected_at',
        'last_user_id',
        'port',
      ],
      remote_asset_manifests: ['campaign_id', 'manifest_json'],
      remote_asset_files: [
        'campaign_id',
        'asset_id',
        'file_modified_at_ms',
        'sha256',
        'size_bytes',
      ],
      remote_asset_partials: ['campaign_id', 'asset_id', 'state_json'],
    } as const;
    for (const [table, names] of Object.entries(expected)) {
      const columns = this.connection
        .prepare(`PRAGMA table_info('${table}')`)
        .all() as Array<{ name?: unknown }>;
      if (
        columns.length !== names.length ||
        columns.some((column, index) => column.name !== names[index])
      ) {
        throw new Error(`Application database table ${table} is malformed.`);
      }
    }
    const recentIndex = this.connection
      .prepare(
        `SELECT 1 AS found
         FROM sqlite_schema
         WHERE type = 'index' AND name = 'saved_connections_recent'`,
      )
      .get() as { found?: unknown } | undefined;
    if (recentIndex?.found !== 1) {
      throw new Error('Application database history index is missing.');
    }
  }
}
