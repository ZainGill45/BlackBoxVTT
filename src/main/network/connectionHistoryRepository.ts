import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  NetworkResult,
  SavedConnection,
} from '../../shared/network';
import { fail } from '../../shared/result';
import { writeJsonAtomic } from '../storage/atomicWrite';
import { MutationQueue } from '../storage/mutationQueue';

const HISTORY_SCHEMA_VERSION = 1 as const;

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

const historySchema = z.object({
  entries: z.array(storedConnectionSchema),
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
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

interface StoredHistory {
  entries: StoredConnection[];
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
}

interface SecureStorageAdapter {
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
  encryptStringAsync(value: string): Promise<Buffer>;
}

function failure<T>(message: string): NetworkResult<T> {
  return fail({ code: 'storage_error', message });
}

export class ConnectionHistoryRepository {
  private readonly mutations = new MutationQueue();

  constructor(
    private readonly historyPath: string,
    private readonly secureStorage: SecureStorageAdapter,
  ) {}

  async list(): Promise<NetworkResult<SavedConnection[]>> {
    try {
      const history = await this.load();
      return {
        ok: true,
        value: [...history.entries]
          .sort(
            (left, right) =>
              right.lastConnectedAt.localeCompare(left.lastConnectedAt) ||
              left.campaignId.localeCompare(right.campaignId),
          )
          .map((entry) => ({
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
    const history = await this.load();
    return (
      history.entries.find((entry) => entry.campaignId === campaignId) ?? null
    );
  }

  async getPassword(
    campaignId: string,
    userId: string,
  ): Promise<string | null> {
    const connection = await this.find(campaignId);
    const profile = connection?.profiles.find(
      (candidate) => candidate.userId === userId,
    );
    if (!profile) {
      return null;
    }

    const decrypted = await this.secureStorage.decryptStringAsync(
      Buffer.from(profile.encryptedPassword, 'base64'),
    );
    return decrypted.result;
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
        const history = await this.load();
        const encryptedPassword = (
          await this.secureStorage.encryptStringAsync(input.password)
        ).toString('base64');
        const existing = history.entries.find(
          (entry) => entry.campaignId === input.campaignId,
        );
        const profile: StoredProfile = {
          encryptedPassword,
          userId: input.userId,
          username: input.username,
        };
        const entry: StoredConnection = {
          campaignId: input.campaignId,
          campaignName: input.campaignName,
          certificateFingerprint: input.certificateFingerprint,
          host: input.host,
          lastConnectedAt: new Date().toISOString(),
          lastUserId: input.userId,
          port: input.port,
          profiles: existing
            ? [
                ...existing.profiles.filter(
                  (candidate) => candidate.userId !== input.userId,
                ),
                profile,
              ]
            : [profile],
        };
        await this.save({
          ...history,
          entries: [
            ...history.entries.filter(
              (candidate) => candidate.campaignId !== input.campaignId,
            ),
            entry,
          ],
        });
        return { ok: true, value: null };
      } catch {
        return failure('Connection history could not be saved.');
      }
    });
  }

  delete(campaignId: string): Promise<NetworkResult<null>> {
    return this.mutations.run(async () => {
      try {
        const history = await this.load();
        await this.save({
          ...history,
          entries: history.entries.filter(
            (entry) => entry.campaignId !== campaignId,
          ),
        });
        return { ok: true, value: null };
      } catch {
        return failure('Connection history could not be deleted.');
      }
    });
  }

  private async load(): Promise<StoredHistory> {
    try {
      const source = await readFile(this.historyPath, 'utf8');
      return historySchema.parse(JSON.parse(source));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], schemaVersion: HISTORY_SCHEMA_VERSION };
      }
      throw error;
    }
  }

  private async save(history: StoredHistory): Promise<void> {
    const directory = path.dirname(this.historyPath);

    // Saved passwords live here, so the file is created exclusively and stays
    // readable only by its owner.
    await writeJsonAtomic(this.historyPath, historySchema.parse(history), {
      ensureDirectory: directory,
      temporaryPath: path.join(directory, `.connections-${randomUUID()}.tmp`),
      writeOptions: { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    });
  }
}
