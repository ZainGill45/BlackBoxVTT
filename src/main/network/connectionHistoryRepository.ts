import { z } from 'zod';
import type {
  NetworkResult,
  SavedConnection,
} from '../../shared/network';
import { fail } from '../../shared/result';
import { ApplicationDatabase } from '../storage/applicationDatabase';
import { MutationQueue } from '../storage/mutationQueue';

const storedProfileSchema = z.object({
  encryptedPassword: z.string().min(1),
  userId: z.string().uuid(),
  username: z.string().min(1).max(64),
});

const storedConnectionSchema = z.object({
  campaignId: z.string().uuid(),
  campaignName: z.string().min(1).max(64),
  certificateFingerprint: z.string().min(1),
  host: z.string().min(1).max(253),
  lastConnectedAt: z.string().datetime(),
  lastUserId: z.string().uuid(),
  port: z.number().int().min(1).max(65_535),
  profiles: z.array(storedProfileSchema),
});

interface StoredProfile {
  encryptedPassword: string;
  userId: string;
  username: string;
}

export interface StoredConnection {
  campaignId: string;
  campaignName: string;
  certificateFingerprint: string;
  host: string;
  lastConnectedAt: string;
  lastUserId: string;
  port: number;
  profiles: StoredProfile[];
}

interface SecureStorageAdapter {
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
  encryptStringAsync(value: string): Promise<Buffer>;
}

interface ConnectionRow {
  campaign_id: string;
  campaign_name: string;
  certificate_fingerprint: string;
  host: string;
  last_connected_at: string;
  last_user_id: string;
  port: number;
}

interface ProfileRow {
  encrypted_password: Uint8Array;
  user_id: string;
  username: string;
}

function failure<T>(message: string): NetworkResult<T> {
  return fail({ code: 'storage_error', message });
}

export class ConnectionHistoryRepository {
  readonly applicationDatabase: ApplicationDatabase;
  private readonly mutations = new MutationQueue();

  constructor(
    databasePath: string,
    private readonly secureStorage: SecureStorageAdapter,
  ) {
    this.applicationDatabase = new ApplicationDatabase(databasePath);
  }

  async list(): Promise<NetworkResult<SavedConnection[]>> {
    try {
      return {
        ok: true,
        value: this.readConnections().map((entry) => ({
          campaignId: entry.campaignId,
          campaignName: entry.campaignName,
          host: entry.host,
          lastConnectedAt: entry.lastConnectedAt,
          lastUserId: entry.lastUserId,
          port: entry.port,
          profiles: entry.profiles.map((profile) => ({
            hasSavedPassword: true,
            userId: profile.userId,
            username: profile.username,
          })),
        })),
      };
    } catch {
      return failure('Connection history could not be loaded.');
    }
  }

  async find(campaignId: string): Promise<StoredConnection | null> {
    const row = this.applicationDatabase.connection
      .prepare(
        `SELECT campaign_id, campaign_name, certificate_fingerprint,
                host, last_connected_at, last_user_id, port
         FROM saved_connections
         WHERE campaign_id = ?`,
      )
      .get(campaignId) as ConnectionRow | undefined;
    return row ? this.toStoredConnection(row) : null;
  }

  async getPassword(
    campaignId: string,
    userId: string,
  ): Promise<string | null> {
    const profile = this.applicationDatabase.connection
      .prepare(
        `SELECT encrypted_password
         FROM saved_connection_profiles
         WHERE campaign_id = ? AND user_id = ?`,
      )
      .get(campaignId, userId) as
      | { encrypted_password: Uint8Array }
      | undefined;
    if (!profile) {
      return null;
    }
    return (
      await this.secureStorage.decryptStringAsync(
        Buffer.from(profile.encrypted_password),
      )
    ).result;
  }

  commitSuccessfulConnection(input: {
    campaignId: string;
    campaignName: string;
    certificateFingerprint: string;
    host: string;
    password: string;
    port: number;
    userId: string;
    username: string;
  }): Promise<NetworkResult<null>> {
    return this.mutations.run(async () => {
      try {
        const encryptedPassword =
          await this.secureStorage.encryptStringAsync(input.password);
        const lastConnectedAt = new Date().toISOString();
        storedConnectionSchema.parse({
          campaignId: input.campaignId,
          campaignName: input.campaignName,
          certificateFingerprint: input.certificateFingerprint,
          host: input.host,
          lastConnectedAt,
          lastUserId: input.userId,
          port: input.port,
          profiles: [
            {
              encryptedPassword: encryptedPassword.toString('base64'),
              userId: input.userId,
              username: input.username,
            },
          ],
        });
        const database = this.applicationDatabase.connection;
        database.exec('BEGIN IMMEDIATE');
        try {
          database
            .prepare(
              `INSERT INTO saved_connections (
                 campaign_id, campaign_name, certificate_fingerprint,
                 host, last_connected_at, last_user_id, port
               ) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(campaign_id) DO UPDATE SET
                 campaign_name = excluded.campaign_name,
                 certificate_fingerprint = excluded.certificate_fingerprint,
                 host = excluded.host,
                 last_connected_at = excluded.last_connected_at,
                 last_user_id = excluded.last_user_id,
                 port = excluded.port`,
            )
            .run(
              input.campaignId,
              input.campaignName,
              input.certificateFingerprint,
              input.host,
              lastConnectedAt,
              input.userId,
              input.port,
            );
          database
            .prepare(
              `INSERT INTO saved_connection_profiles (
                 campaign_id, user_id, username, encrypted_password
               ) VALUES (?, ?, ?, ?)
               ON CONFLICT(campaign_id, user_id) DO UPDATE SET
                 username = excluded.username,
                 encrypted_password = excluded.encrypted_password`,
            )
            .run(
              input.campaignId,
              input.userId,
              input.username,
              encryptedPassword,
            );
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
        return { ok: true, value: null };
      } catch {
        return failure('Connection history could not be saved.');
      }
    });
  }

  delete(campaignId: string): Promise<NetworkResult<null>> {
    return this.mutations.run(async () => {
      try {
        this.applicationDatabase.connection
          .prepare('DELETE FROM saved_connections WHERE campaign_id = ?')
          .run(campaignId);
        return { ok: true, value: null };
      } catch {
        return failure('Connection history could not be deleted.');
      }
    });
  }

  close(): void {
    this.applicationDatabase.close();
  }

  private readConnections(): StoredConnection[] {
    const rows = this.applicationDatabase.connection
      .prepare(
        `SELECT campaign_id, campaign_name, certificate_fingerprint,
                host, last_connected_at, last_user_id, port
         FROM saved_connections
         ORDER BY last_connected_at DESC, campaign_id`,
      )
      .all() as unknown as ConnectionRow[];
    return rows.map((row) => this.toStoredConnection(row));
  }

  private toStoredConnection(row: ConnectionRow): StoredConnection {
    const profiles = this.applicationDatabase.connection
      .prepare(
        `SELECT user_id, username, encrypted_password
         FROM saved_connection_profiles
         WHERE campaign_id = ?
         ORDER BY rowid`,
      )
      .all(row.campaign_id) as unknown as ProfileRow[];
    return storedConnectionSchema.parse({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      certificateFingerprint: row.certificate_fingerprint,
      host: row.host,
      lastConnectedAt: row.last_connected_at,
      lastUserId: row.last_user_id,
      port: row.port,
      profiles: profiles.map((profile) => ({
        encryptedPassword: Buffer.from(profile.encrypted_password).toString(
          'base64',
        ),
        userId: profile.user_id,
        username: profile.username,
      })),
    });
  }
}
