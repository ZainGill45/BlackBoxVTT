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
import type { CampaignSystemState } from '../../shared/gameSystems';
import {
  createDefaultCampaignSystemState,
  parseCampaignSystemState,
} from '../../systems/catalog';
import {
  JOURNAL_ENTRY_TYPE_NOTE,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_TITLE_GRAPHEMES,
  MAX_NOTE_PAGES,
  RICH_TEXT_SCHEMA_VERSION,
  countGraphemes,
  defaultJournalTitleStyle,
  extractJournalAssetIds,
  isJournalTitleStyle,
  isRichTextDocument,
} from '../../shared/journal';

export const CAMPAIGN_DATABASE_FILENAME = 'campaign.sqlite';
export const CAMPAIGN_DATABASE_SCHEMA_VERSION = 12;

interface CampaignMetadataRow {
  campaign_id: string;
  created_at: string;
  name: string;
  updated_at: string;
}

interface CampaignSystemRow {
  schema_version: number;
  settings_json: string;
  system_id: string;
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
      let version = Number(
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
      } else {
        if (initialManifest) {
          throw new Error(`Unsupported campaign schema version ${version}.`);
        }
        while (version < CAMPAIGN_DATABASE_SCHEMA_VERSION) {
          if (version === 7) {
            this.migrateVersion7To8();
            version = 8;
          } else if (version === 8) {
            this.migrateVersion8To9();
            version = 9;
          } else if (version === 9) {
            this.migrateVersion9To10();
            version = 10;
          } else if (version === 10) {
            this.migrateVersion10To11();
            version = 11;
          } else if (version === 11) {
            this.migrateVersion11To12();
            version = 12;
          } else {
            throw new Error(`Unsupported campaign schema version ${version}.`);
          }
        }
        if (version !== CAMPAIGN_DATABASE_SCHEMA_VERSION) {
          throw new Error(`Unsupported campaign schema version ${version}.`);
        }
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
      system: this.readSystem(),
      updatedAt: row.updated_at,
    };
  }

  readSystem(): CampaignSystemState {
    const row = this.connection
      .prepare(
        `SELECT system_id, schema_version, settings_json
         FROM campaign_system
         WHERE singleton = 1`,
      )
      .get() as CampaignSystemRow | undefined;
    if (!row) {
      throw new Error('Campaign system metadata is missing.');
    }
    let settings: unknown;
    try {
      settings = JSON.parse(row.settings_json);
    } catch {
      throw new Error('Campaign system settings are invalid.');
    }
    const system = parseCampaignSystemState({
      id: row.system_id,
      schemaVersion: row.schema_version,
      settings,
    });
    if (!system) {
      throw new Error('Campaign game system is unsupported or invalid.');
    }
    return system;
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
    const system = parseCampaignSystemState(manifest.system);
    if (!system) {
      throw new Error('Campaign game system is unsupported or invalid.');
    }
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
        CREATE TABLE campaign_system (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          system_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
          settings_json TEXT NOT NULL
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
        CREATE TABLE journal_manifest (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          revision INTEGER NOT NULL CHECK (revision >= 0)
        ) STRICT;
        CREATE TABLE journal_entries (
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
          name_style_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE journal_entry_permissions (
          entry_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
          PRIMARY KEY (entry_id, user_id),
          FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_entry_permissions_user
          ON journal_entry_permissions (user_id, entry_id);
        CREATE TABLE journal_pages (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
          default_access TEXT NOT NULL CHECK (
            default_access IN ('inherit', 'none', 'view', 'edit')
          ),
          content_schema_version INTEGER NOT NULL CHECK (
            content_schema_version >= 1
          ),
          content_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          title_style_json TEXT NOT NULL,
          permission_revision INTEGER NOT NULL CHECK (permission_revision >= 0),
          UNIQUE (entry_id, position),
          FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE journal_page_permissions (
          page_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access TEXT NOT NULL CHECK (
            access IN ('inherit', 'none', 'view', 'edit')
          ),
          PRIMARY KEY (page_id, user_id),
          FOREIGN KEY (page_id) REFERENCES journal_pages(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_page_permissions_user
          ON journal_page_permissions (user_id, page_id);
        CREATE TABLE journal_page_assets (
          page_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          PRIMARY KEY (page_id, asset_id),
          FOREIGN KEY (page_id) REFERENCES journal_pages(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_page_assets_asset
          ON journal_page_assets (asset_id, page_id);
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
          `INSERT INTO campaign_system (
             singleton, system_id, schema_version, settings_json
           ) VALUES (1, ?, ?, ?)`,
        )
        .run(
          system.id,
          system.schemaVersion,
          JSON.stringify(system.settings),
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
        `INSERT INTO journal_manifest (singleton, revision)
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
      campaign_system: [
        'singleton',
        'system_id',
        'schema_version',
        'settings_json',
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
      journal_manifest: ['singleton', 'revision'],
      journal_entries: [
        'id',
        'type_id',
        'position',
        'name',
        'default_access',
        'revision',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
        'name_style_json',
      ],
      journal_entry_permissions: ['entry_id', 'user_id', 'access'],
      journal_pages: [
        'id',
        'entry_id',
        'position',
        'title',
        'default_access',
        'content_schema_version',
        'content_json',
        'revision',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
        'title_style_json',
        'permission_revision',
      ],
      journal_page_permissions: ['page_id', 'user_id', 'access'],
      journal_page_assets: ['page_id', 'asset_id'],
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
      'campaign_system',
      'journal_manifest',
      'scene_manifest',
    ]) {
      const row = this.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count?: unknown } | undefined;
      if (row?.count !== 1) {
        throw new Error(`Campaign database singleton ${table} is invalid.`);
      }
    }
    const foreignKeyFailure = this.connection.prepare('PRAGMA foreign_key_check').get();
    if (foreignKeyFailure) throw new Error('Campaign database foreign keys are invalid.');
    this.validateJournalState();
  }

  private validateJournalState(): void {
    const entries = this.connection.prepare(
      `SELECT id, type_id, position, name, name_style_json, created_at, updated_at
       FROM journal_entries ORDER BY position`,
    ).all() as Array<Record<string, unknown>>;
    if (entries.length > MAX_JOURNAL_ENTRIES) throw new Error('Campaign Journal exceeds its note limit.');
    for (const [position, entry] of entries.entries()) {
      let nameStyle: unknown;
      try { nameStyle = JSON.parse(String(entry.name_style_json)); } catch { throw new Error('Campaign Journal note style is invalid.'); }
      if (
        typeof entry.id !== 'string' || !UUID_PATTERN.test(entry.id) ||
        entry.type_id !== JOURNAL_ENTRY_TYPE_NOTE || entry.position !== position ||
        typeof entry.name !== 'string' || entry.name.normalize('NFKC').trim() !== entry.name ||
        countGraphemes(entry.name) < 1 || countGraphemes(entry.name) > MAX_JOURNAL_TITLE_GRAPHEMES ||
        !isJournalTitleStyle(nameStyle) ||
        typeof entry.created_at !== 'string' || !validTimestamp(entry.created_at) ||
        typeof entry.updated_at !== 'string' || !validTimestamp(entry.updated_at)
      ) throw new Error('Campaign Journal contains a malformed note.');
      const pages = this.connection.prepare(
        `SELECT id, position, title, title_style_json, content_schema_version, content_json,
                revision, permission_revision, created_at, updated_at
         FROM journal_pages WHERE entry_id = ? ORDER BY position`,
      ).all(entry.id as string) as Array<Record<string, unknown>>;
      if (pages.length < 1 || pages.length > MAX_NOTE_PAGES) {
        throw new Error('Campaign Journal note has an invalid page count.');
      }
      for (const [pagePosition, page] of pages.entries()) {
        let content: unknown;
        let titleStyle: unknown;
        try { content = JSON.parse(String(page.content_json)); } catch { throw new Error('Campaign Journal page content is invalid.'); }
        try { titleStyle = JSON.parse(String(page.title_style_json)); } catch { throw new Error('Campaign Journal page style is invalid.'); }
        if (
          typeof page.id !== 'string' || !UUID_PATTERN.test(page.id) ||
          page.position !== pagePosition ||
          typeof page.title !== 'string' || page.title.normalize('NFKC').trim() !== page.title ||
          countGraphemes(page.title) < 1 || countGraphemes(page.title) > MAX_JOURNAL_TITLE_GRAPHEMES ||
          !isJournalTitleStyle(titleStyle) ||
          page.content_schema_version !== RICH_TEXT_SCHEMA_VERSION || !isRichTextDocument(content) ||
          !Number.isInteger(page.revision) || Number(page.revision) < 0 ||
          !Number.isInteger(page.permission_revision) || Number(page.permission_revision) < 0 ||
          typeof page.created_at !== 'string' || !validTimestamp(page.created_at) ||
          typeof page.updated_at !== 'string' || !validTimestamp(page.updated_at)
        ) throw new Error('Campaign Journal contains a malformed page.');
        const indexedAssetIds = (this.connection.prepare(
          'SELECT asset_id FROM journal_page_assets WHERE page_id = ? ORDER BY asset_id',
        ).all(page.id as string) as Array<{ asset_id: string }>).map(({ asset_id }) => asset_id);
        const contentAssetIds = extractJournalAssetIds(content as Parameters<typeof extractJournalAssetIds>[0]).sort();
        if (
          indexedAssetIds.length !== contentAssetIds.length ||
          indexedAssetIds.some((assetId, index) => assetId !== contentAssetIds[index])
        ) throw new Error('Campaign Journal page asset references are invalid.');
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
        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateVersion8To9(): void {
    const system = createDefaultCampaignSystemState();
    if (!system) {
      throw new Error('The default game system is unavailable.');
    }
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE campaign_system (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          system_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
          settings_json TEXT NOT NULL
        ) STRICT;
      `);
      this.connection
        .prepare(
          `INSERT INTO campaign_system (
             singleton, system_id, schema_version, settings_json
           ) VALUES (1, ?, ?, ?)`,
        )
        .run(
          system.id,
          system.schemaVersion,
          JSON.stringify(system.settings),
        );
      this.connection.exec(`
        PRAGMA user_version = 9;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateVersion9To10(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE journal_manifest (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          revision INTEGER NOT NULL CHECK (revision >= 0)
        ) STRICT;
        CREATE TABLE journal_entries (
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
          updated_by TEXT NOT NULL
        ) STRICT;
        CREATE TABLE journal_entry_permissions (
          entry_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
          PRIMARY KEY (entry_id, user_id),
          FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_entry_permissions_user
          ON journal_entry_permissions (user_id, entry_id);
        CREATE TABLE journal_pages (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
          default_access TEXT NOT NULL CHECK (
            default_access IN ('inherit', 'none', 'view', 'edit')
          ),
          content_schema_version INTEGER NOT NULL CHECK (
            content_schema_version >= 1
          ),
          content_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          UNIQUE (entry_id, position),
          FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE journal_page_permissions (
          page_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          access TEXT NOT NULL CHECK (
            access IN ('inherit', 'none', 'view', 'edit')
          ),
          PRIMARY KEY (page_id, user_id),
          FOREIGN KEY (page_id) REFERENCES journal_pages(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES campaign_users(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_page_permissions_user
          ON journal_page_permissions (user_id, page_id);
        INSERT INTO journal_manifest (singleton, revision) VALUES (1, 0);
        PRAGMA user_version = 10;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateVersion10To11(): void {
    const styleJson = JSON.stringify(defaultJournalTitleStyle()).replaceAll("'", "''");
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        ALTER TABLE journal_entries
          ADD COLUMN name_style_json TEXT NOT NULL DEFAULT '${styleJson}';
        ALTER TABLE journal_pages
          ADD COLUMN title_style_json TEXT NOT NULL DEFAULT '${styleJson}';
        PRAGMA user_version = 11;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateVersion11To12(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        ALTER TABLE journal_pages
          ADD COLUMN permission_revision INTEGER NOT NULL DEFAULT 0
            CHECK (permission_revision >= 0);
        CREATE TABLE journal_page_assets (
          page_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          PRIMARY KEY (page_id, asset_id),
          FOREIGN KEY (page_id) REFERENCES journal_pages(id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX journal_page_assets_asset
          ON journal_page_assets (asset_id, page_id);
      `);
      const pages = this.connection.prepare(
        'SELECT id, content_json FROM journal_pages',
      ).all() as Array<{ content_json: string; id: string }>;
      const insert = this.connection.prepare(
        'INSERT INTO journal_page_assets (page_id, asset_id) VALUES (?, ?)',
      );
      for (const page of pages) {
        const content: unknown = JSON.parse(page.content_json);
        if (!isRichTextDocument(content)) {
          throw new Error('Campaign Journal page content is invalid.');
        }
        for (const assetId of extractJournalAssetIds(content)) {
          insert.run(page.id, assetId);
        }
      }
      this.connection.exec('PRAGMA user_version = 12');
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
