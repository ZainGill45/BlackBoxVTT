import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { existsSync } from 'node:fs';
import {
  CAMPAIGN_SCHEMA_VERSION,
  type CampaignManifest,
} from '../../shared/campaigns';
import {
  DEFAULT_MAX_CHAT_MESSAGE_CHARACTERS,
  MAX_MAX_CHAT_MESSAGE_CHARACTERS,
  MIN_MAX_CHAT_MESSAGE_CHARACTERS,
} from '../../shared/chat';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_TRANSFORM_PREVIEW_RATE,
  MAX_TRANSFORM_PREVIEW_RATE,
  MIN_TRANSFORM_PREVIEW_RATE,
} from '../../shared/network';

export const CAMPAIGN_DATABASE_FILENAME = 'campaign.sqlite';
export const CAMPAIGN_DATABASE_SCHEMA_VERSION = 8;

interface CampaignMetadataRow {
  campaign_id: string;
  created_at: string;
  name: string;
  updated_at: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export class CampaignDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;

  private constructor(
    campaignDirectory: string,
    initialManifest?: CampaignManifest,
  ) {
    this.path = path.join(
      path.resolve(campaignDirectory),
      CAMPAIGN_DATABASE_FILENAME,
    );
    const connection = new DatabaseSync(this.path, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.connection = connection;
    try {
      connection.exec('PRAGMA journal_mode = WAL');
      connection.exec('PRAGMA synchronous = FULL');
      connection.exec('PRAGMA secure_delete = ON');
      const version = Number(
        (
          connection.prepare('PRAGMA user_version').get() as
            | { user_version?: unknown }
            | undefined
        )?.user_version ?? 0,
      );
      if (version === 0) {
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
        if (count !== 0 || !initialManifest) {
          throw new Error(
            'Campaign database is unversioned or missing metadata.',
          );
        }
        this.initialize(initialManifest);
      } else if (version === 7 && !initialManifest) {
        this.migrateVersion7To8();
      } else if (version !== CAMPAIGN_DATABASE_SCHEMA_VERSION || initialManifest) {
        throw new Error(`Unsupported campaign schema version ${version}.`);
      }
      this.validateSchema();
      this.readManifest();
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  static create(
    campaignDirectory: string,
    manifest: CampaignManifest,
  ): CampaignDatabase {
    return new CampaignDatabase(campaignDirectory, manifest);
  }

  static open(campaignDirectory: string): CampaignDatabase {
    const databasePath = path.join(
      path.resolve(campaignDirectory),
      CAMPAIGN_DATABASE_FILENAME,
    );
    if (!existsSync(databasePath)) {
      throw new Error('Campaign database does not exist.');
    }
    return new CampaignDatabase(campaignDirectory);
  }

  readManifest(): CampaignManifest {
    const row = this.connection
      .prepare(
        `SELECT campaign_id, name, created_at, updated_at
         FROM campaign_metadata
         WHERE singleton = 1`,
      )
      .get() as CampaignMetadataRow | undefined;
    if (
      !row ||
      !UUID_PATTERN.test(row.campaign_id) ||
      row.name.normalize('NFKC').trim() !== row.name ||
      row.name.length < 1 ||
      row.name.length > 64 ||
      !validTimestamp(row.created_at) ||
      !validTimestamp(row.updated_at)
    ) {
      throw new Error('Campaign database metadata is invalid.');
    }
    return {
      createdAt: row.created_at,
      id: row.campaign_id,
      name: row.name,
      schemaVersion: CAMPAIGN_SCHEMA_VERSION,
      updatedAt: row.updated_at,
    };
  }

  touch(updatedAt: string): CampaignManifest {
    if (!validTimestamp(updatedAt)) {
      throw new Error('Campaign update timestamp is invalid.');
    }
    this.connection
      .prepare(
        `UPDATE campaign_metadata
         SET updated_at = ?
         WHERE singleton = 1`,
      )
      .run(updatedAt);
    return this.readManifest();
  }

  close(): void {
    this.connection.close();
  }

  private initialize(manifest: CampaignManifest): void {
    this.connection.exec('PRAGMA auto_vacuum = FULL');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE campaign_metadata (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          campaign_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE campaign_server_settings (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
          transform_preview_rate INTEGER NOT NULL CHECK (
            transform_preview_rate BETWEEN ${MIN_TRANSFORM_PREVIEW_RATE}
              AND ${MAX_TRANSFORM_PREVIEW_RATE}
          ),
          max_chat_message_characters INTEGER NOT NULL CHECK (
            max_chat_message_characters BETWEEN ${MIN_MAX_CHAT_MESSAGE_CHARACTERS}
              AND ${MAX_MAX_CHAT_MESSAGE_CHARACTERS}
          )
        ) STRICT;
        CREATE TABLE campaign_users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL,
          username_key TEXT UNIQUE NOT NULL,
          password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'scrypt'),
          password_block_size INTEGER NOT NULL,
          password_cost INTEGER NOT NULL,
          password_hash TEXT NOT NULL,
          password_key_length INTEGER NOT NULL,
          password_parallelization INTEGER NOT NULL,
          password_salt TEXT NOT NULL
        ) STRICT;
        CREATE TABLE chat_metadata (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE chat_messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT UNIQUE NOT NULL,
          client_message_id TEXT NOT NULL,
          generation TEXT NOT NULL,
          accepted_at TEXT NOT NULL,
          sender_key TEXT NOT NULL,
          sender_kind TEXT NOT NULL CHECK (sender_kind IN ('gm', 'player')),
          sender_user_id TEXT,
          sender_name TEXT NOT NULL,
          recipient_key TEXT,
          recipient_kind TEXT CHECK (
            recipient_kind IS NULL OR recipient_kind IN ('gm', 'player')
          ),
          recipient_user_id TEXT,
          recipient_name TEXT,
          message_kind TEXT NOT NULL CHECK (message_kind IN ('text', 'roll')),
          payload_json TEXT NOT NULL,
          UNIQUE (sender_key, client_message_id),
          CHECK (
            (recipient_key IS NULL AND recipient_kind IS NULL
              AND recipient_user_id IS NULL AND recipient_name IS NULL)
            OR
            (recipient_key IS NOT NULL AND recipient_kind IS NOT NULL
              AND recipient_name IS NOT NULL)
          )
        ) STRICT;
        CREATE INDEX chat_messages_sender_sequence
          ON chat_messages (sender_key, sequence);
        CREATE INDEX chat_messages_recipient_sequence
          ON chat_messages (recipient_key, sequence);
        CREATE TABLE scene_manifest (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          active_scene_id TEXT,
          revision INTEGER NOT NULL CHECK (revision >= 0)
        ) STRICT;
        CREATE TABLE scenes (
          id TEXT PRIMARY KEY NOT NULL,
          position INTEGER UNIQUE NOT NULL CHECK (position >= 0),
          record_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE asset_manifest (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          revision INTEGER NOT NULL CHECK (revision >= 0)
        ) STRICT;
        CREATE TABLE assets (
          id TEXT PRIMARY KEY NOT NULL,
          position INTEGER UNIQUE NOT NULL CHECK (position >= 0),
          record_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE asset_file_operations (
          operation_id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('delete', 'import')),
          payload_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE scene_operations (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_key TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          scene_id TEXT NOT NULL,
          completed_at TEXT NOT NULL,
          UNIQUE (actor_key, operation_id)
        ) STRICT;
      `);
      this.connection
        .prepare(
          `INSERT INTO campaign_metadata (
             singleton, campaign_id, name, created_at, updated_at
           ) VALUES (1, ?, ?, ?, ?)`,
        )
        .run(
          manifest.id,
          manifest.name,
          manifest.createdAt,
          manifest.updatedAt,
        );
      this.connection
        .prepare(
          `INSERT INTO campaign_server_settings (
             singleton, port, transform_preview_rate,
             max_chat_message_characters
           ) VALUES (1, ?, ?, ?)`,
        )
        .run(
          DEFAULT_SERVER_PORT,
          DEFAULT_TRANSFORM_PREVIEW_RATE,
          DEFAULT_MAX_CHAT_MESSAGE_CHARACTERS,
        );
      this.connection
        .prepare(
          `INSERT INTO chat_metadata (key, value)
           VALUES ('history_generation', ?)`,
        )
        .run(randomUUID());
      this.connection.exec(
        `INSERT INTO scene_manifest (singleton, active_scene_id, revision)
         VALUES (1, NULL, 0)`,
      );
      this.connection.exec(
        `INSERT INTO asset_manifest (singleton, revision)
         VALUES (1, 0)`,
      );
      this.connection.exec(
        `PRAGMA user_version = ${CAMPAIGN_DATABASE_SCHEMA_VERSION}`,
      );
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
      throw new Error('Campaign database integrity check failed.');
    }
    const expected = {
      campaign_metadata: [
        'singleton',
        'campaign_id',
        'name',
        'created_at',
        'updated_at',
      ],
      campaign_server_settings: [
        'singleton',
        'port',
        'transform_preview_rate',
        'max_chat_message_characters',
      ],
      campaign_users: [
        'id',
        'username',
        'username_key',
        'password_algorithm',
        'password_block_size',
        'password_cost',
        'password_hash',
        'password_key_length',
        'password_parallelization',
        'password_salt',
      ],
      chat_messages: [
        'sequence',
        'id',
        'client_message_id',
        'generation',
        'accepted_at',
        'sender_key',
        'sender_kind',
        'sender_user_id',
        'sender_name',
        'recipient_key',
        'recipient_kind',
        'recipient_user_id',
        'recipient_name',
        'message_kind',
        'payload_json',
      ],
      chat_metadata: ['key', 'value'],
      scene_manifest: ['singleton', 'active_scene_id', 'revision'],
      scenes: ['id', 'position', 'record_json'],
      asset_manifest: ['singleton', 'revision'],
      assets: ['id', 'position', 'record_json'],
      asset_file_operations: ['operation_id', 'kind', 'payload_json'],
      scene_operations: [
        'sequence',
        'actor_key',
        'operation_id',
        'scene_id',
        'completed_at',
      ],
    } as const;
    for (const [table, names] of Object.entries(expected)) {
      const columns = this.connection
        .prepare(`PRAGMA table_info('${table}')`)
        .all() as Array<{ name?: unknown }>;
      if (
        columns.length !== names.length ||
        columns.some((column, index) => column.name !== names[index])
      ) {
        throw new Error(`Campaign database table ${table} is malformed.`);
      }
    }
    const indexes = this.connection
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'index'
           AND name IN (
             'chat_messages_sender_sequence',
             'chat_messages_recipient_sequence'
           )`,
      )
      .all() as Array<{ name?: unknown }>;
    if (new Set(indexes.map((index) => index.name)).size !== 2) {
      throw new Error('Campaign database chat indexes are missing.');
    }
    const uniqueIndexes = this.connection
      .prepare(`PRAGMA index_list('chat_messages')`)
      .all() as Array<{ name?: unknown; unique?: unknown }>;
    const hasIdempotencyConstraint = uniqueIndexes.some((index) => {
      if (index.unique !== 1 || typeof index.name !== 'string') {
        return false;
      }
      const columns = this.connection
        .prepare(`PRAGMA index_info('${index.name.replaceAll("'", "''")}')`)
        .all() as Array<{ name?: unknown }>;
      return (
        columns.length === 2 &&
        columns[0]?.name === 'sender_key' &&
        columns[1]?.name === 'client_message_id'
      );
    });
    if (!hasIdempotencyConstraint) {
      throw new Error('Campaign database chat idempotency is missing.');
    }
    for (const table of [
      'asset_manifest',
      'campaign_metadata',
      'campaign_server_settings',
      'scene_manifest',
    ]) {
      const row = this.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count?: unknown } | undefined;
      if (row?.count !== 1) {
        throw new Error(`Campaign database singleton ${table} is invalid.`);
      }
    }
  }

  private migrateVersion7To8(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        ALTER TABLE chat_messages RENAME TO chat_messages_v7;
        CREATE TABLE chat_messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT UNIQUE NOT NULL,
          client_message_id TEXT NOT NULL,
          generation TEXT NOT NULL,
          accepted_at TEXT NOT NULL,
          sender_key TEXT NOT NULL,
          sender_kind TEXT NOT NULL CHECK (sender_kind IN ('gm', 'player')),
          sender_user_id TEXT,
          sender_name TEXT NOT NULL,
          recipient_key TEXT,
          recipient_kind TEXT CHECK (
            recipient_kind IS NULL OR recipient_kind IN ('gm', 'player')
          ),
          recipient_user_id TEXT,
          recipient_name TEXT,
          message_kind TEXT NOT NULL CHECK (message_kind IN ('text', 'roll')),
          payload_json TEXT NOT NULL,
          UNIQUE (sender_key, client_message_id),
          CHECK (
            (recipient_key IS NULL AND recipient_kind IS NULL
              AND recipient_user_id IS NULL AND recipient_name IS NULL)
            OR
            (recipient_key IS NOT NULL AND recipient_kind IS NOT NULL
              AND recipient_name IS NOT NULL)
          )
        ) STRICT;
      `);
      const rows = this.connection
        .prepare('SELECT * FROM chat_messages_v7 ORDER BY sequence ASC')
        .all() as Array<Record<string, unknown>>;
      const insert = this.connection.prepare(`
        INSERT INTO chat_messages (
          sequence, id, client_message_id, generation, accepted_at,
          sender_key, sender_kind, sender_user_id, sender_name,
          recipient_key, recipient_kind, recipient_user_id, recipient_name,
          message_kind, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'text', ?)
      `);
      for (const row of rows) {
        if (typeof row.content !== 'string') {
          throw new Error('Campaign chat migration found invalid text content.');
        }
        insert.run(
          ...([
            row.sequence, row.id, row.client_message_id, row.generation,
            row.accepted_at, row.sender_key, row.sender_kind,
            row.sender_user_id, row.sender_name, row.recipient_key,
            row.recipient_kind, row.recipient_user_id, row.recipient_name,
            JSON.stringify({ kind: 'text', text: row.content }),
          ] as SQLInputValue[]),
        );
      }
      this.connection.exec(`
        DROP TABLE chat_messages_v7;
        CREATE INDEX chat_messages_sender_sequence
          ON chat_messages (sender_key, sequence);
        CREATE INDEX chat_messages_recipient_sequence
          ON chat_messages (recipient_key, sequence);
        PRAGMA user_version = ${CAMPAIGN_DATABASE_SCHEMA_VERSION};
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
