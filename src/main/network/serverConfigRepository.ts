import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MAX_MAX_CHAT_MESSAGE_CHARACTERS,
  MIN_MAX_CHAT_MESSAGE_CHARACTERS,
} from '../../shared/chat';
import {
  MAX_MANAGED_USERS,
  MAX_TRANSFORM_PREVIEW_RATE,
  MIN_TRANSFORM_PREVIEW_RATE,
  type ManagedUserView,
  type NetworkResult,
  type ServerSettingsView,
} from '../../shared/network';
import { fail } from '../../shared/result';
import { CampaignDatabase } from '../storage/campaignDatabase';
import { MutationQueue } from '../storage/mutationQueue';
import {
  hashPassword,
  type StoredPasswordHash,
} from './passwords';

const SERVER_CONFIG_SCHEMA_VERSION = 3 as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const passwordHashSchema = z.object({
  algorithm: z.literal('scrypt'),
  blockSize: z.literal(8),
  cost: z.literal(32_768),
  hash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  keyLength: z.literal(32),
  parallelization: z.literal(1),
  salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
});

export interface StoredManagedUser {
  id: string;
  password: StoredPasswordHash;
  username: string;
}

export interface ChatConfigurationSnapshot {
  maxMessageCharacters: number;
  users: StoredManagedUser[];
}

interface StoredServerConfig {
  maxChatMessageCharacters: number;
  port: number;
  schemaVersion: typeof SERVER_CONFIG_SCHEMA_VERSION;
  users: StoredManagedUser[];
  transformPreviewRate: number;
}

interface SettingsRow {
  max_chat_message_characters: number;
  port: number;
  transform_preview_rate: number;
}

interface UserRow {
  id: string;
  password_algorithm: string;
  password_block_size: number;
  password_cost: number;
  password_hash: string;
  password_key_length: number;
  password_parallelization: number;
  password_salt: string;
  username: string;
}

function failure<T>(
  code: 'duplicate_username' | 'invalid_input' | 'storage_error',
  message: string,
): NetworkResult<T> {
  return fail({ code, message });
}

export function normalizeUsername(username: string): string {
  return username.normalize('NFKC').trim();
}

function usernameKey(username: string): string {
  return normalizeUsername(username).toLocaleLowerCase('en-US');
}

export class ServerConfigRepository {
  private readonly mutations = new MutationQueue();

  constructor(private readonly database: CampaignDatabase) {}

  async load(): Promise<StoredServerConfig> {
    const settings = this.database.connection
      .prepare(
        `SELECT port, transform_preview_rate, max_chat_message_characters
         FROM campaign_server_settings
         WHERE singleton = 1`,
      )
      .get() as SettingsRow | undefined;
    if (!settings) {
      throw new Error('Campaign server settings are missing.');
    }
    const rows = this.database.connection
      .prepare(
        `SELECT id, username, password_algorithm, password_block_size,
                password_cost, password_hash, password_key_length,
                password_parallelization, password_salt
         FROM campaign_users
         ORDER BY rowid`,
      )
      .all() as unknown as UserRow[];
    const users = rows.map((row) => ({
      id: row.id,
      password: passwordHashSchema.parse({
        algorithm: row.password_algorithm,
        blockSize: row.password_block_size,
        cost: row.password_cost,
        hash: row.password_hash,
        keyLength: row.password_key_length,
        parallelization: row.password_parallelization,
        salt: row.password_salt,
      }),
      username: row.username,
    }));
    return {
      maxChatMessageCharacters: settings.max_chat_message_characters,
      port: settings.port,
      schemaVersion: SERVER_CONFIG_SCHEMA_VERSION,
      transformPreviewRate: settings.transform_preview_rate,
      users,
    };
  }

  async getView(
    isConnected: (userId: string) => boolean = () => false,
  ): Promise<NetworkResult<ServerSettingsView>> {
    try {
      const config = await this.load();
      return {
        ok: true,
        value: {
          maxChatMessageCharacters: config.maxChatMessageCharacters,
          port: config.port,
          transformPreviewRate: config.transformPreviewRate,
          users: config.users.map((user) =>
            this.toView(user, isConnected(user.id)),
          ),
        },
      };
    } catch {
      return failure('storage_error', 'Server settings could not be loaded.');
    }
  }

  createUser(
    usernameInput: string,
    password: string,
  ): Promise<NetworkResult<StoredManagedUser>> {
    return this.mutations.run(async () => {
      const username = normalizeUsername(usernameInput);
      if (
        username.length < 1 ||
        username.length > 64 ||
        password.length === 0
      ) {
        return failure(
          'invalid_input',
          'Username must be between 1 and 64 characters and password must not be empty.',
        );
      }
      try {
        const config = await this.load();
        if (config.users.length >= MAX_MANAGED_USERS) {
          return failure(
            'invalid_input',
            `A campaign can have at most ${MAX_MANAGED_USERS} users.`,
          );
        }
        if (
          config.users.some(
            (user) => usernameKey(user.username) === usernameKey(username),
          )
        ) {
          return failure(
            'duplicate_username',
            `A user named “${username}” already exists.`,
          );
        }
        const user: StoredManagedUser = {
          id: randomUUID(),
          password: await hashPassword(password),
          username,
        };
        this.insertUser(user);
        return { ok: true, value: user };
      } catch {
        return failure('storage_error', 'User could not be created.');
      }
    });
  }

  updateUsername(
    userId: string,
    usernameInput: string,
  ): Promise<NetworkResult<StoredManagedUser>> {
    return this.mutations.run(async () => {
      const username = normalizeUsername(usernameInput);
      if (
        !UUID_PATTERN.test(userId) ||
        username.length < 1 ||
        username.length > 64
      ) {
        return failure(
          'invalid_input',
          'Username must be between 1 and 64 characters.',
        );
      }
      try {
        const config = await this.load();
        const existing = config.users.find((user) => user.id === userId);
        if (!existing) {
          return failure('invalid_input', 'User could not be found.');
        }
        if (
          config.users.some(
            (user) =>
              user.id !== userId &&
              usernameKey(user.username) === usernameKey(username),
          )
        ) {
          return failure(
            'duplicate_username',
            `A user named “${username}” already exists.`,
          );
        }
        this.database.connection
          .prepare(
            `UPDATE campaign_users
             SET username = ?, username_key = ?
             WHERE id = ?`,
          )
          .run(username, usernameKey(username), userId);
        return { ok: true, value: { ...existing, username } };
      } catch {
        return failure('storage_error', 'Username could not be updated.');
      }
    });
  }

  resetPassword(
    userId: string,
    password: string,
  ): Promise<NetworkResult<null>> {
    return this.mutations.run(async () => {
      if (!UUID_PATTERN.test(userId) || password.length === 0) {
        return failure('invalid_input', 'Password must not be empty.');
      }
      try {
        const exists = this.database.connection
          .prepare('SELECT 1 AS found FROM campaign_users WHERE id = ?')
          .get(userId) as { found?: unknown } | undefined;
        if (exists?.found !== 1) {
          return failure('invalid_input', 'User could not be found.');
        }
        const stored = await hashPassword(password);
        this.database.connection
          .prepare(
            `UPDATE campaign_users
             SET password_algorithm = ?, password_block_size = ?,
                 password_cost = ?, password_hash = ?,
                 password_key_length = ?, password_parallelization = ?,
                 password_salt = ?
             WHERE id = ?`,
          )
          .run(
            stored.algorithm,
            stored.blockSize,
            stored.cost,
            stored.hash,
            stored.keyLength,
            stored.parallelization,
            stored.salt,
            userId,
          );
        return { ok: true, value: null };
      } catch {
        return failure('storage_error', 'Password could not be reset.');
      }
    });
  }

  deleteUser(userId: string): Promise<NetworkResult<null>> {
    return this.mutations.run(async () => {
      if (!UUID_PATTERN.test(userId)) {
        return failure('invalid_input', 'User could not be found.');
      }
      try {
        const result = this.database.connection
          .prepare('DELETE FROM campaign_users WHERE id = ?')
          .run(userId);
        return Number(result.changes) === 1
          ? { ok: true, value: null }
          : failure('invalid_input', 'User could not be found.');
      } catch {
        return failure('storage_error', 'User could not be deleted.');
      }
    });
  }

  setPort(port: number): Promise<NetworkResult<number>> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      return Promise.resolve(
        failure('invalid_input', 'Port must be between 1 and 65535.'),
      );
    }
    return this.updateSetting(
      'port',
      port,
      'Server port could not be saved.',
    );
  }

  setTransformPreviewRate(rate: number): Promise<NetworkResult<number>> {
    if (
      !Number.isInteger(rate) ||
      rate < MIN_TRANSFORM_PREVIEW_RATE ||
      rate > MAX_TRANSFORM_PREVIEW_RATE
    ) {
      return Promise.resolve(
        failure(
          'invalid_input',
          `Transform preview rate must be between ${MIN_TRANSFORM_PREVIEW_RATE} and ${MAX_TRANSFORM_PREVIEW_RATE}.`,
        ),
      );
    }
    return this.updateSetting(
      'transform_preview_rate',
      rate,
      'Transform preview rate could not be saved.',
    );
  }

  withChatConfiguration<T>(
    useConfiguration: (
      snapshot: ChatConfigurationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return this.mutations.run(async () => {
      const config = await this.load();
      return useConfiguration({
        maxMessageCharacters: config.maxChatMessageCharacters,
        users: structuredClone(config.users),
      });
    });
  }

  setMaxChatMessageCharacters(
    maxMessageCharacters: number,
  ): Promise<NetworkResult<number>> {
    if (
      !Number.isInteger(maxMessageCharacters) ||
      maxMessageCharacters < MIN_MAX_CHAT_MESSAGE_CHARACTERS ||
      maxMessageCharacters > MAX_MAX_CHAT_MESSAGE_CHARACTERS
    ) {
      return Promise.resolve(
        failure(
          'invalid_input',
          `Maximum chat message length must be between ${MIN_MAX_CHAT_MESSAGE_CHARACTERS} and ${MAX_MAX_CHAT_MESSAGE_CHARACTERS}.`,
        ),
      );
    }
    return this.updateSetting(
      'max_chat_message_characters',
      maxMessageCharacters,
      'Chat settings could not be saved.',
    );
  }

  toView(user: StoredManagedUser, connected: boolean): ManagedUserView {
    return {
      connected,
      hasPassword: true,
      id: user.id,
      username: user.username,
    };
  }

  private insertUser(user: StoredManagedUser): void {
    this.database.connection
      .prepare(
        `INSERT INTO campaign_users (
           id, username, username_key, password_algorithm,
           password_block_size, password_cost, password_hash,
           password_key_length, password_parallelization, password_salt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.username,
        usernameKey(user.username),
        user.password.algorithm,
        user.password.blockSize,
        user.password.cost,
        user.password.hash,
        user.password.keyLength,
        user.password.parallelization,
        user.password.salt,
      );
  }

  private updateSetting(
    column:
      | 'max_chat_message_characters'
      | 'port'
      | 'transform_preview_rate',
    value: number,
    errorMessage: string,
  ): Promise<NetworkResult<number>> {
    return this.mutations.run(async () => {
      try {
        this.database.connection
          .prepare(
            `UPDATE campaign_server_settings
             SET ${column} = ?
             WHERE singleton = 1`,
          )
          .run(value);
        return { ok: true, value };
      } catch {
        return failure('storage_error', errorMessage);
      }
    });
  }
}
