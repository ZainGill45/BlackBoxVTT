import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
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
  MAX_MANAGED_USERS,
  type ManagedUserView,
  type NetworkResult,
  type ServerSettingsView,
} from '../../shared/network';
import { fail } from '../../shared/result';
import { writeJsonAtomic } from '../storage/atomicWrite';
import { MutationQueue } from '../storage/mutationQueue';
import {
  hashPassword,
  type StoredPasswordHash,
} from './passwords';

const SERVER_CONFIG_SCHEMA_VERSION = 3 as const;
const SERVER_CONFIG_FILENAME = 'server.json';
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

const storedUserSchema = z.object({
  id: z.string().regex(UUID_PATTERN),
  password: passwordHashSchema,
  username: z.string().min(1).max(64),
});

const storedServerConfigSchema = z.object({
  maxChatMessageCharacters: z
    .number()
    .int()
    .min(MIN_MAX_CHAT_MESSAGE_CHARACTERS)
    .max(MAX_MAX_CHAT_MESSAGE_CHARACTERS),
  port: z.number().int().min(1).max(65_535),
  schemaVersion: z.literal(SERVER_CONFIG_SCHEMA_VERSION),
  transformPreviewRate: z
    .number()
    .int()
    .min(MIN_TRANSFORM_PREVIEW_RATE)
    .max(MAX_TRANSFORM_PREVIEW_RATE),
  users: z.array(storedUserSchema).max(MAX_MANAGED_USERS),
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

function defaultConfig(): StoredServerConfig {
  return {
    maxChatMessageCharacters: DEFAULT_MAX_CHAT_MESSAGE_CHARACTERS,
    port: DEFAULT_SERVER_PORT,
    schemaVersion: SERVER_CONFIG_SCHEMA_VERSION,
    transformPreviewRate: DEFAULT_TRANSFORM_PREVIEW_RATE,
    users: [],
  };
}

export class ServerConfigRepository {
  private readonly configPath: string;
  private readonly mutations = new MutationQueue();

  constructor(private readonly campaignDirectory: string) {
    this.configPath = path.join(
      path.resolve(campaignDirectory),
      'content',
      SERVER_CONFIG_FILENAME,
    );
  }

  async load(): Promise<StoredServerConfig> {
    try {
      const source = await readFile(this.configPath, 'utf8');
      const raw = JSON.parse(source);
      if (raw?.schemaVersion === 1 || raw?.schemaVersion === 2) {
        const migrated = storedServerConfigSchema.parse({
          ...raw,
          maxChatMessageCharacters: DEFAULT_MAX_CHAT_MESSAGE_CHARACTERS,
          schemaVersion: SERVER_CONFIG_SCHEMA_VERSION,
          transformPreviewRate:
            raw.schemaVersion === 1
              ? DEFAULT_TRANSFORM_PREVIEW_RATE
              : raw.transformPreviewRate,
        });
        await this.save(migrated);
        return migrated;
      }
      return storedServerConfigSchema.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return defaultConfig();
      }

      throw error;
    }
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
        await this.save({ ...config, users: [...config.users, user] });
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

        const updated = { ...existing, username };
        await this.save({
          ...config,
          users: config.users.map((user) =>
            user.id === userId ? updated : user,
          ),
        });
        return { ok: true, value: updated };
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
        return failure(
          'invalid_input',
          'Password must not be empty.',
        );
      }

      try {
        const config = await this.load();

        if (!config.users.some((user) => user.id === userId)) {
          return failure('invalid_input', 'User could not be found.');
        }

        const passwordHash = await hashPassword(password);
        await this.save({
          ...config,
          users: config.users.map((user) =>
            user.id === userId
              ? { ...user, password: passwordHash }
              : user,
          ),
        });
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
        const config = await this.load();

        if (!config.users.some((user) => user.id === userId)) {
          return failure('invalid_input', 'User could not be found.');
        }

        await this.save({
          ...config,
          users: config.users.filter((user) => user.id !== userId),
        });
        return { ok: true, value: null };
      } catch {
        return failure('storage_error', 'User could not be deleted.');
      }
    });
  }

  setPort(port: number): Promise<NetworkResult<number>> {
    return this.mutations.run(async () => {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return failure('invalid_input', 'Port must be between 1 and 65535.');
      }

      try {
        const config = await this.load();
        await this.save({ ...config, port });
        return { ok: true, value: port };
      } catch {
        return failure('storage_error', 'Server port could not be saved.');
      }
    });
  }

  setTransformPreviewRate(rate: number): Promise<NetworkResult<number>> {
    return this.mutations.run(async () => {
      if (
        !Number.isInteger(rate) ||
        rate < MIN_TRANSFORM_PREVIEW_RATE ||
        rate > MAX_TRANSFORM_PREVIEW_RATE
      ) {
        return failure(
          'invalid_input',
          `Transform preview rate must be between ${MIN_TRANSFORM_PREVIEW_RATE} and ${MAX_TRANSFORM_PREVIEW_RATE}.`,
        );
      }
      try {
        const config = await this.load();
        await this.save({ ...config, transformPreviewRate: rate });
        return { ok: true, value: rate };
      } catch {
        return failure('storage_error', 'Transform preview rate could not be saved.');
      }
    });
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
    return this.mutations.run(async () => {
      if (
        !Number.isInteger(maxMessageCharacters) ||
        maxMessageCharacters < MIN_MAX_CHAT_MESSAGE_CHARACTERS ||
        maxMessageCharacters > MAX_MAX_CHAT_MESSAGE_CHARACTERS
      ) {
        return failure(
          'invalid_input',
          `Maximum chat message length must be between ${MIN_MAX_CHAT_MESSAGE_CHARACTERS} and ${MAX_MAX_CHAT_MESSAGE_CHARACTERS}.`,
        );
      }
      try {
        const config = await this.load();
        await this.save({
          ...config,
          maxChatMessageCharacters: maxMessageCharacters,
        });
        return { ok: true, value: maxMessageCharacters };
      } catch {
        return failure(
          'storage_error',
          'Chat settings could not be saved.',
        );
      }
    });
  }

  toView(user: StoredManagedUser, connected: boolean): ManagedUserView {
    return {
      connected,
      hasPassword: true,
      id: user.id,
      username: user.username,
    };
  }

  private async save(config: StoredServerConfig): Promise<void> {
    const directory = path.dirname(this.configPath);

    // Password hashes live here, so the file is created exclusively and stays
    // readable only by its owner.
    await writeJsonAtomic(
      this.configPath,
      storedServerConfigSchema.parse(config),
      {
        ensureDirectory: directory,
        temporaryPath: path.join(directory, `.server-${randomUUID()}.tmp`),
        writeOptions: { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      },
    );
  }
}
