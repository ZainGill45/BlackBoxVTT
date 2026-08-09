import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  ASSET_ACCESS_LEVELS,
  ASSET_CHUNK_BYTES,
  MAX_ASSET_BYTES,
  type AssetAccessLevel,
  type AssetActor,
  type AssetErrorCode,
  type AssetFormat,
  type AssetKind,
  type AssetManifest,
  type AssetRecord,
  type AssetResult,
  type UpdateAssetPermissionsInput,
} from '../shared/assets';
import type {
  PermissionConfiguration,
  PermissionSubject,
} from '../shared/permissions';
import { fail } from '../shared/result';

/**
 * Clears the range any real position can occupy, so surviving rows can be
 * shifted aside while a new order is written without tripping the unique index.
 * A campaign cannot hold enough assets to reach it: reordering is capped well
 * below this.
 */
const ASSET_POSITION_PARK_OFFSET = 1_000_000;
import { CampaignDatabase } from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';

const ASSET_DIRECTORY = 'assets';
const STAGING_DIRECTORY = '.asset-staging';

interface DetectedFormat {
  extension: string;
  format: AssetFormat;
  kind: AssetKind;
  mimeType: string;
}

const FORMATS: Record<string, DetectedFormat> = {
  '.gif': {
    extension: 'gif',
    format: 'gif',
    kind: 'image',
    mimeType: 'image/gif',
  },
  '.jpeg': {
    extension: 'jpg',
    format: 'jpeg',
    kind: 'image',
    mimeType: 'image/jpeg',
  },
  '.jpg': {
    extension: 'jpg',
    format: 'jpeg',
    kind: 'image',
    mimeType: 'image/jpeg',
  },
  '.m4a': {
    extension: 'm4a',
    format: 'm4a',
    kind: 'audio',
    mimeType: 'audio/mp4',
  },
  '.md': {
    extension: 'md',
    format: 'markdown',
    kind: 'document',
    mimeType: 'text/markdown',
  },
  '.mp3': {
    extension: 'mp3',
    format: 'mp3',
    kind: 'audio',
    mimeType: 'audio/mpeg',
  },
  '.ogg': {
    extension: 'ogg',
    format: 'ogg',
    kind: 'audio',
    mimeType: 'audio/ogg',
  },
  '.pdf': {
    extension: 'pdf',
    format: 'pdf',
    kind: 'document',
    mimeType: 'application/pdf',
  },
  '.png': {
    extension: 'png',
    format: 'png',
    kind: 'image',
    mimeType: 'image/png',
  },
  '.txt': {
    extension: 'txt',
    format: 'text',
    kind: 'document',
    mimeType: 'text/plain',
  },
  '.wav': {
    extension: 'wav',
    format: 'wav',
    kind: 'audio',
    mimeType: 'audio/wav',
  },
  '.webp': {
    extension: 'webp',
    format: 'webp',
    kind: 'image',
    mimeType: 'image/webp',
  },
};

interface AssetRepositoryOptions {
  database: CampaignDatabase;
  now?: () => Date;
  touchCampaign?: () => Promise<void>;
  trashItem: (targetPath: string) => Promise<void>;
}

interface AssetImportSource {
  displayName?: string;
  originalFilename?: string;
  sourcePath: string;
}

interface InspectedFile {
  chunkHashes: string[];
  detected: DetectedFormat;
  fileModifiedAtMs: number;
  sha256: string;
  sizeBytes: number;
}

interface PendingAssetFile {
  finalName: string;
  stagingName: string;
}

interface PendingAssetOperation {
  files: PendingAssetFile[];
  nextManifest: AssetManifest;
  previousManifest: AssetManifest;
}

function failure<T>(
  code: AssetErrorCode,
  message: string,
  assetId?: string,
): AssetResult<T> {
  return fail({ assetId, code, message });
}

function normalizeDisplayName(value: string): string {
  return value.normalize('NFKC').trim();
}

function displayNameLength(value: string): number {
  return [...value].length;
}

function displayNameKey(value: string): string {
  return normalizeDisplayName(value).toLocaleLowerCase('en-US');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isAssetRecord(value: unknown): value is AssetRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const asset = value as Partial<AssetRecord>;
  return (
    typeof asset.id === 'string' &&
    /^[0-9a-f-]{36}$/i.test(asset.id) &&
    typeof asset.displayName === 'string' &&
    displayNameLength(asset.displayName) >= 1 &&
    displayNameLength(asset.displayName) <= 256 &&
    typeof asset.originalFilename === 'string' &&
    typeof asset.extension === 'string' &&
    /^[a-z0-9]{1,8}$/.test(asset.extension) &&
    typeof asset.mimeType === 'string' &&
    (asset.kind === 'image' ||
      asset.kind === 'audio' ||
      asset.kind === 'document') &&
    typeof asset.format === 'string' &&
    Object.values(FORMATS).some(
      (detected) =>
        detected.extension === asset.extension &&
        detected.format === asset.format &&
        detected.kind === asset.kind &&
        detected.mimeType === asset.mimeType,
    ) &&
    typeof asset.sizeBytes === 'number' &&
    asset.sizeBytes >= 0 &&
    asset.sizeBytes <= MAX_ASSET_BYTES &&
    isSha256(asset.sha256) &&
    Array.isArray(asset.chunkHashes) &&
    asset.chunkHashes.every(isSha256) &&
    asset.chunkHashes.length ===
      Math.ceil(asset.sizeBytes / ASSET_CHUNK_BYTES) &&
    typeof asset.createdAt === 'string' &&
    typeof asset.createdBy === 'string' &&
    typeof asset.lastModifiedAt === 'string' &&
    typeof asset.lastModifiedBy === 'string' &&
    typeof asset.revision === 'number' &&
    Number.isInteger(asset.revision) &&
    typeof asset.fileModifiedAtMs === 'number' &&
    Number.isFinite(Date.parse(asset.createdAt)) &&
    Number.isFinite(Date.parse(asset.lastModifiedAt))
  );
}

export function isAssetManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const manifest = value as Partial<AssetManifest>;
  if (
    typeof manifest.revision === 'number' &&
    Number.isInteger(manifest.revision) &&
    manifest.revision >= 0 &&
    Array.isArray(manifest.assets) &&
    manifest.assets.every(isAssetRecord)
  ) {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const asset of manifest.assets) {
      const name = displayNameKey(asset.displayName);
      if (ids.has(asset.id) || names.has(name)) {
        return false;
      }
      ids.add(asset.id);
      names.add(name);
    }
    return true;
  }
  return false;
}

function bytesEqual(
  buffer: Buffer,
  expected: readonly number[],
  offset = 0,
): boolean {
  return expected.every((value, index) => buffer[offset + index] === value);
}

function headerMatches(format: AssetFormat, header: Buffer): boolean {
  switch (format) {
    case 'png':
      return bytesEqual(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return bytesEqual(header, [0xff, 0xd8, 0xff]);
    case 'gif':
      return header.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        header.subarray(0, 6).toString('ascii') === 'GIF89a';
    case 'webp':
      return header.subarray(0, 4).toString('ascii') === 'RIFF' &&
        header.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'wav':
      return header.subarray(0, 4).toString('ascii') === 'RIFF' &&
        header.subarray(8, 12).toString('ascii') === 'WAVE';
    case 'ogg':
      return header.subarray(0, 4).toString('ascii') === 'OggS';
    case 'mp3':
      return header.subarray(0, 3).toString('ascii') === 'ID3' ||
        (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    case 'm4a':
      return header.subarray(4, 8).toString('ascii') === 'ftyp';
    case 'pdf':
      return header.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'markdown':
    case 'text':
      return true;
  }
}

async function inspectFile(
  filePath: string,
  detected: DetectedFormat,
): Promise<AssetResult<InspectedFile>> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return failure('invalid_input', 'The selected item is not a file.');
  }
  if (fileStat.size > MAX_ASSET_BYTES) {
    return failure('invalid_input', 'The selected file exceeds the 1 GiB limit.');
  }

  const handle = await open(filePath, 'r');
  const wholeHash = createHash('sha256');
  const chunkHashes: string[] = [];
  const utf8Decoder =
    detected.format === 'text' || detected.format === 'markdown'
      ? new TextDecoder('utf-8', { fatal: true })
      : null;
  let header = Buffer.alloc(0);
  let encryptedPdf = false;
  let carry = '';

  try {
    const buffer = Buffer.allocUnsafe(ASSET_CHUNK_BYTES);
    let position = 0;
    while (position < fileStat.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, fileStat.size - position),
        position,
      );
      if (bytesRead === 0) {
        break;
      }
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      if (position === 0) {
        header = chunk.subarray(0, 32);
      }
      wholeHash.update(chunk);
      chunkHashes.push(createHash('sha256').update(chunk).digest('hex'));
      if (utf8Decoder) {
        try {
          utf8Decoder.decode(chunk, { stream: true });
        } catch {
          return failure('invalid_input', 'Text assets must use valid UTF-8.');
        }
      }
      if (detected.format === 'pdf') {
        const source = carry + chunk.toString('latin1');
        encryptedPdf ||= /\/Encrypt\b/.test(source);
        carry = source.slice(-16);
      }
      position += bytesRead;
    }
    if (utf8Decoder) {
      try {
        utf8Decoder.decode();
      } catch {
        return failure('invalid_input', 'Text assets must use valid UTF-8.');
      }
    }
  } finally {
    await handle.close();
  }

  if (!headerMatches(detected.format, header) || encryptedPdf) {
    return failure('invalid_input', 'The selected file format is unsupported.');
  }

  return {
    ok: true,
    value: {
      chunkHashes,
      detected,
      fileModifiedAtMs: fileStat.mtimeMs,
      sha256: wholeHash.digest('hex'),
      sizeBytes: fileStat.size,
    },
  };
}

export class AssetRepository {
  private readonly assetDirectory: string;
  private readonly contentDirectory: string;
  private readonly database: CampaignDatabase;
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private readonly stagingDirectory: string;
  private readonly touchCampaign: () => Promise<void>;
  private readonly trashItem: (targetPath: string) => Promise<void>;

  constructor({
    database,
    now = () => new Date(),
    touchCampaign = async () => undefined,
    trashItem,
  }: AssetRepositoryOptions) {
    const resolvedCampaign = path.dirname(database.path);
    this.database = database;
    this.contentDirectory = path.join(resolvedCampaign, 'content');
    this.assetDirectory = path.join(this.contentDirectory, ASSET_DIRECTORY);
    this.stagingDirectory = path.join(this.contentDirectory, STAGING_DIRECTORY);
    this.now = now;
    this.touchCampaign = touchCampaign;
    this.trashItem = trashItem;
  }

  async initialize(): Promise<void> {
    await mkdir(this.assetDirectory, { recursive: true });
    await mkdir(this.stagingDirectory, { recursive: true });
    await this.recoverPendingOperations();
    const entries = await readdir(this.stagingDirectory, {
      withFileTypes: true,
    });
    await Promise.all(
      entries.map((entry) =>
        rm(path.join(this.stagingDirectory, entry.name), {
          force: true,
          recursive: true,
        }),
      ),
    );
  }

  async readManifest(): Promise<AssetManifest> {
    await this.initialize();
    const state = this.database.connection
      .prepare(
        `SELECT revision
         FROM asset_manifest
         WHERE singleton = 1`,
      )
      .get() as { revision?: unknown } | undefined;
    const rows = this.database.connection
      .prepare(
        `SELECT id, record_json
         FROM assets
         ORDER BY position`,
      )
      .all() as unknown as Array<{ id: string; record_json: string }>;
    const manifest: unknown = {
      assets: rows.map((row) => {
        const record = JSON.parse(row.record_json) as AssetRecord;
        if (record.id !== row.id) {
          throw new Error('Asset row ID does not match its record.');
        }
        return record;
      }),
      revision: state?.revision,
    };
    if (!isAssetManifest(manifest)) {
      throw new Error('Asset manifest is invalid.');
    }
    return manifest;
  }

  async list(): Promise<Array<{ available: boolean; record: AssetRecord }>> {
    const manifest = await this.readManifest();
    return Promise.all(
      manifest.assets.map(async (record) => {
        try {
          const fileStat = await stat(this.resolveAssetPath(record));
          return {
            available:
              fileStat.isFile() &&
              fileStat.size === record.sizeBytes &&
              Math.abs(fileStat.mtimeMs - record.fileModifiedAtMs) < 2,
            record,
          };
        } catch {
          return { available: false, record };
        }
      }),
    );
  }

  importFiles(
    sources: Array<string | AssetImportSource>,
    actor: AssetActor,
  ): Promise<AssetResult<AssetRecord[]>> {
    return this.mutations.run(async () => {
      await this.initialize();
      const manifest = await this.readManifest();
      const staged: Array<{
        finalPath: string;
        record: AssetRecord;
        stagingPath: string;
      }> = [];
      const existingNames = new Set(
        manifest.assets.map((asset) => displayNameKey(asset.displayName)),
      );
      const existingHashes = new Set(
        manifest.assets.map((asset) => asset.sha256),
      );
      let pendingOperationId: string | null = null;
      let manifestCommitted = false;

      try {
        for (const source of sources) {
          const sourcePath =
            typeof source === 'string' ? source : source.sourcePath;
          const originalFilename =
            typeof source === 'string'
              ? path.basename(source)
              : source.originalFilename ?? path.basename(source.sourcePath);
          const detected = FORMATS[path.extname(originalFilename).toLowerCase()];
          if (!detected) {
            continue;
          }
          const displayName = normalizeDisplayName(
            typeof source === 'string'
              ? originalFilename
              : source.displayName ?? originalFilename,
          );
          if (
            displayNameLength(displayName) < 1 ||
            displayNameLength(displayName) > 256 ||
            existingNames.has(displayNameKey(displayName))
          ) {
            continue;
          }

          const id = randomUUID();
          const stagingPath = path.join(this.stagingDirectory, `${id}.part`);
          await copyFile(sourcePath, stagingPath);
          const inspected = await inspectFile(stagingPath, detected);
          if (!inspected.ok) {
            await rm(stagingPath, { force: true });
            if (
              inspected.error.message.includes('unsupported') ||
              inspected.error.message.includes('UTF-8')
            ) {
              continue;
            }
            return inspected;
          }
          if (existingHashes.has(inspected.value.sha256)) {
            await rm(stagingPath, { force: true });
            continue;
          }

          const timestamp = this.now().toISOString();
          const nextRevision = manifest.revision + 1;
          const finalPath = path.join(
            this.assetDirectory,
            `${id}.${detected.extension}`,
          );
          const fileInspection = {
            chunkHashes: inspected.value.chunkHashes,
            fileModifiedAtMs: inspected.value.fileModifiedAtMs,
            sha256: inspected.value.sha256,
            sizeBytes: inspected.value.sizeBytes,
          };
          const record: AssetRecord = {
            ...fileInspection,
            createdAt: timestamp,
            createdBy: actor.id,
            displayName,
            extension: detected.extension,
            format: detected.format,
            id,
            kind: detected.kind,
            lastModifiedAt: timestamp,
            lastModifiedBy: actor.id,
            mimeType: detected.mimeType,
            originalFilename,
            revision: nextRevision,
          };
          staged.push({ finalPath, record, stagingPath });
          existingNames.add(displayNameKey(displayName));
          existingHashes.add(record.sha256);
        }

        if (staged.length === 0) {
          return { ok: true, value: [] };
        }

        const nextManifest: AssetManifest = {
          assets: [...manifest.assets, ...staged.map(({ record }) => record)],
          revision: manifest.revision + 1,
        };
        pendingOperationId = randomUUID();
        this.recordPendingOperation(pendingOperationId, 'import', {
          files: staged.map(({ finalPath, stagingPath }) => ({
            finalName: path.basename(finalPath),
            stagingName: path.basename(stagingPath),
          })),
          nextManifest,
          previousManifest: manifest,
        });
        for (const entry of staged) {
          await rename(entry.stagingPath, entry.finalPath);
        }
        await this.writeManifest(nextManifest, pendingOperationId);
        manifestCommitted = true;
        /* A player who adds a file would otherwise lose sight of it the moment
           it lands, because the library defaults to no access. The grant needs
           a real campaign account to hang off, so an actor without one simply
           imports without gaining an override. */
        if (actor.role === 'player' && this.isCampaignUser(actor.id)) {
          const grant = this.database.connection.prepare(
            `INSERT INTO asset_permissions (asset_id, user_id, access)
             VALUES (?, ?, 'edit')
             ON CONFLICT(asset_id, user_id) DO UPDATE SET access = 'edit'`,
          );
          for (const { record } of staged) grant.run(record.id, actor.id);
        }
        await this.touchCampaign();
        return { ok: true, value: staged.map(({ record }) => record) };
      } catch {
        if (manifestCommitted) {
          await this.writeManifest(manifest).catch(() => undefined);
        }
        if (pendingOperationId) {
          this.deletePendingOperation(pendingOperationId);
        }
        await Promise.all(
          staged.flatMap(({ finalPath, stagingPath }) => [
            rm(finalPath, { force: true }),
            rm(stagingPath, { force: true }),
          ]),
        );
        return failure('storage_error', 'The selected assets could not be imported.');
      }
    });
  }

  renameAsset(
    assetId: string,
    displayNameInput: string,
    expectedRevision: number,
    actor: AssetActor,
  ): Promise<AssetResult<AssetRecord>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const index = manifest.assets.findIndex((asset) => asset.id === assetId);
      if (index < 0) {
        return failure('not_found', 'The asset no longer exists.', assetId);
      }
      const current = manifest.assets[index];
      if (current.revision !== expectedRevision) {
        return failure('conflict', 'The asset changed before it could be renamed.', assetId);
      }
      const displayName = normalizeDisplayName(displayNameInput);
      if (
        displayNameLength(displayName) < 1 ||
        displayNameLength(displayName) > 256
      ) {
        return failure('invalid_input', 'Asset names must contain 1 to 256 characters.', assetId);
      }
      if (
        manifest.assets.some(
          (asset) =>
            asset.id !== assetId &&
            displayNameKey(asset.displayName) === displayNameKey(displayName),
        )
      ) {
        return failure('conflict', 'An asset already uses that name.', assetId);
      }
      const nextRevision = manifest.revision + 1;
      const renamed: AssetRecord = {
        ...current,
        displayName,
        lastModifiedAt: this.now().toISOString(),
        lastModifiedBy: actor.id,
        revision: nextRevision,
      };
      const assets = [...manifest.assets];
      assets[index] = renamed;
      await this.writeManifest({
        assets,
        revision: nextRevision,
      });
      await this.touchCampaign();
      return { ok: true, value: renamed };
    });
  }

  /**
   * Reorders one kind group in place.
   *
   * Manifest array order is already the stored order — `readManifest` reads
   * `ORDER BY position` and `writeManifest` writes the array index back — so
   * ordering only has to permute the array. The group's assets are rewritten
   * into the slots that group already occupies, which leaves assets of other
   * kinds sitting exactly where they were rather than clustering the manifest
   * by kind as a side effect.
   *
   * Individual records are untouched, so their revisions do not move. Conflict
   * detection is the ID-set check below rather than an expected revision: the
   * manifest revision is not visible to callers, and a mismatched set is
   * exactly the case where honouring the order would be wrong.
   */
  reorderAssets(
    kind: AssetKind,
    orderedAssetIds: readonly string[],
  ): Promise<AssetResult<AssetManifest>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const slots: number[] = [];
      const groupIds: string[] = [];
      manifest.assets.forEach((asset, index) => {
        if (asset.kind === kind) {
          slots.push(index);
          groupIds.push(asset.id);
        }
      });
      const requested = [...orderedAssetIds];
      if (
        requested.length !== groupIds.length ||
        new Set(requested).size !== requested.length ||
        !requested.every((id) => groupIds.includes(id))
      ) {
        return failure(
          'invalid_input',
          'The requested asset order is invalid.',
        );
      }
      const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
      const assets = [...manifest.assets];
      slots.forEach((slot, position) => {
        assets[slot] = byId.get(requested[position])!;
      });
      const nextRevision = manifest.revision + 1;
      const next: AssetManifest = { assets, revision: nextRevision };
      await this.writeManifest(next);
      await this.touchCampaign();
      return { ok: true, value: next };
    });
  }

  trashAsset(
    assetId: string,
    expectedRevision: number,
  ): Promise<AssetResult<null>> {
    return this.mutations.run(async () => {
      const manifest = await this.readManifest();
      const current = manifest.assets.find((asset) => asset.id === assetId);
      if (!current) {
        return failure('not_found', 'The asset no longer exists.', assetId);
      }
      if (current.revision !== expectedRevision) {
        return failure('conflict', 'The asset changed before it could be deleted.', assetId);
      }
      const sourcePath = this.resolveAssetPath(current);
      const stagedPath = path.join(this.stagingDirectory, `${assetId}.deleted`);
      const nextManifest: AssetManifest = {
        assets: manifest.assets.filter((asset) => asset.id !== assetId),
        revision: manifest.revision + 1,
      };
      const pendingOperationId = randomUUID();
      let manifestCommitted = false;
      let trashed = false;

      try {
        this.recordPendingOperation(pendingOperationId, 'delete', {
          files: [
            {
              finalName: path.basename(sourcePath),
              stagingName: path.basename(stagedPath),
            },
          ],
          nextManifest,
          previousManifest: manifest,
        });
        await rename(sourcePath, stagedPath);
        await this.writeManifest(nextManifest, pendingOperationId);
        manifestCommitted = true;
        await this.trashItem(stagedPath);
        trashed = true;
        await this.touchCampaign();
        return { ok: true, value: null };
      } catch {
        this.deletePendingOperation(pendingOperationId);
        if (!trashed) {
          try {
            await rename(stagedPath, sourcePath);
            if (manifestCommitted) {
              await this.writeManifest(manifest);
            }
          } catch {
            // The next repository validation reports an unavailable asset.
          }
        }
        return failure('storage_error', 'The asset could not be moved to the trash.', assetId);
      }
    });
  }

  /** Every asset's access for one actor, in a single pass over the overrides. */
  accessByAsset(actor: AssetActor): Map<string, AssetAccessLevel> {
    const rows = this.database.connection
      .prepare(
        `SELECT assets.id AS id,
                COALESCE(overrides.access, assets.default_access) AS access
         FROM assets
         LEFT JOIN asset_permissions AS overrides
           ON overrides.asset_id = assets.id AND overrides.user_id = ?`,
      )
      .all(actor.role === 'gm' ? '' : actor.id) as unknown as Array<{
        access: AssetAccessLevel;
        id: string;
      }>;
    return new Map(rows.map(({ access, id }) => [id, access]));
  }

  /** Every asset's configuration in two queries, for projecting a whole list. */
  permissionStates(): Map<
    string,
    { permissionRevision: number; permissions: PermissionConfiguration<AssetAccessLevel> }
  > {
    const states = new Map<
      string,
      { permissionRevision: number; permissions: PermissionConfiguration<AssetAccessLevel> }
    >();
    for (const row of this.database.connection
      .prepare('SELECT id, default_access, permission_revision FROM assets')
      .all() as unknown as Array<{
        default_access: AssetAccessLevel;
        id: string;
        permission_revision: number;
      }>) {
      states.set(row.id, {
        permissionRevision: row.permission_revision,
        permissions: { allPlayers: row.default_access, overrides: [] },
      });
    }
    for (const row of this.database.connection
      .prepare(
        `SELECT asset_id, user_id, access FROM asset_permissions
         ORDER BY asset_id, user_id`,
      )
      .all() as unknown as Array<{
        access: AssetAccessLevel;
        asset_id: string;
        user_id: string;
      }>) {
      states.get(row.asset_id)?.permissions.overrides.push({
        access: row.access,
        userId: row.user_id,
      });
    }
    return states;
  }

  permissionState(
    assetId: string,
  ): {
    permissionRevision: number;
    permissions: PermissionConfiguration<AssetAccessLevel>;
  } | null {
    const row = this.database.connection
      .prepare(
        `SELECT default_access, permission_revision
         FROM assets WHERE id = ?`,
      )
      .get(assetId) as
        | { default_access: AssetAccessLevel; permission_revision: number }
        | undefined;
    if (!row) return null;
    const overrides = this.database.connection
      .prepare(
        `SELECT user_id, access FROM asset_permissions
         WHERE asset_id = ? ORDER BY user_id`,
      )
      .all(assetId) as unknown as Array<{
        access: AssetAccessLevel;
        user_id: string;
      }>;
    return {
      permissionRevision: row.permission_revision,
      permissions: {
        allPlayers: row.default_access,
        overrides: overrides.map(({ access, user_id }) => ({
          access,
          userId: user_id,
        })),
      },
    };
  }

  private isCampaignUser(userId: string): boolean {
    return Boolean(
      this.database.connection
        .prepare('SELECT 1 FROM campaign_users WHERE id = ?')
        .get(userId),
    );
  }

  listUsers(): PermissionSubject[] {
    return (
      this.database.connection
        .prepare('SELECT id, username FROM campaign_users ORDER BY username')
        .all() as unknown as Array<{ id: string; username: string }>
    ).map(({ id, username }) => ({ id, username }));
  }

  updatePermissions(
    input: Omit<UpdateAssetPermissionsInput, 'campaignId'>,
  ): Promise<AssetResult<null>> {
    return this.mutations.run(async () => {
      await this.initialize();
      const current = this.permissionState(input.assetId);
      if (!current) {
        return failure('not_found', 'That asset no longer exists.', input.assetId);
      }
      if (current.permissionRevision !== input.expectedPermissionRevision) {
        return failure(
          'conflict',
          'The asset permissions changed before this change could be saved.',
          input.assetId,
        );
      }
      if (!this.validPermissions(input.permissions)) {
        return failure('invalid_input', 'The asset permissions are invalid.', input.assetId);
      }
      const database = this.database.connection;
      database.exec('BEGIN IMMEDIATE');
      try {
        database
          .prepare(
            `UPDATE assets
             SET default_access = ?, permission_revision = permission_revision + 1
             WHERE id = ?`,
          )
          .run(input.permissions.allPlayers, input.assetId);
        database
          .prepare('DELETE FROM asset_permissions WHERE asset_id = ?')
          .run(input.assetId);
        const insert = database.prepare(
          `INSERT INTO asset_permissions (asset_id, user_id, access)
           VALUES (?, ?, ?)`,
        );
        for (const override of input.permissions.overrides) {
          insert.run(input.assetId, override.userId, override.access);
        }
        database.exec('COMMIT');
      } catch {
        database.exec('ROLLBACK');
        return failure(
          'storage_error',
          'The asset permissions could not be saved.',
          input.assetId,
        );
      }
      await this.touchCampaign();
      return { ok: true, value: null };
    });
  }

  private validPermissions(
    permissions: PermissionConfiguration<AssetAccessLevel>,
  ): boolean {
    if (!ASSET_ACCESS_LEVELS.includes(permissions.allPlayers)) return false;
    const users = new Set(this.listUsers().map(({ id }) => id));
    const seen = new Set<string>();
    return permissions.overrides.every(({ access, userId }) => {
      if (!users.has(userId) || seen.has(userId)) return false;
      if (!ASSET_ACCESS_LEVELS.includes(access)) return false;
      seen.add(userId);
      return true;
    });
  }

  resolveAssetPath(record: AssetRecord): string {
    const target = path.resolve(
      this.assetDirectory,
      `${record.id}.${record.extension}`,
    );
    const prefix = `${path.resolve(this.assetDirectory)}${path.sep}`;
    if (!target.startsWith(prefix)) {
      throw new Error('Asset path escaped the campaign directory.');
    }
    return target;
  }

  private async writeManifest(
    manifest: AssetManifest,
    completedOperationId?: string,
  ): Promise<void> {
    if (!isAssetManifest(manifest)) {
      throw new Error('Asset manifest is invalid.');
    }
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      /* Rewriting the rows wholesale would drop each asset's access with them,
         because the permission overrides cascade off this table. Only assets
         that actually left the manifest are deleted; the rest keep the access
         the Game Master gave them while their order and record move. */
      const retained = new Set(manifest.assets.map((asset) => asset.id));
      const remove = database.prepare('DELETE FROM assets WHERE id = ?');
      for (const row of database
        .prepare('SELECT id FROM assets')
        .all() as unknown as Array<{ id: string }>) {
        if (!retained.has(row.id)) remove.run(row.id);
      }
      /* Positions are unique and non-negative, so the surviving rows are
         shifted above every position the new order can use before it lands. */
      database.exec(
        `UPDATE assets SET position = position + ${ASSET_POSITION_PARK_OFFSET}`,
      );
      const upsert = database.prepare(
        `INSERT INTO assets (
           id, position, record_json, default_access, permission_revision
         ) VALUES (?, ?, ?, 'none', 0)
         ON CONFLICT(id) DO UPDATE
           SET position = excluded.position, record_json = excluded.record_json`,
      );
      manifest.assets.forEach((asset, position) => {
        upsert.run(asset.id, position, JSON.stringify(asset));
      });
      database
        .prepare(
          `UPDATE asset_manifest
           SET revision = ?
           WHERE singleton = 1`,
        )
        .run(manifest.revision);
      if (completedOperationId) {
        database
          .prepare(
            `DELETE FROM asset_file_operations
             WHERE operation_id = ?`,
          )
          .run(completedOperationId);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private recordPendingOperation(
    operationId: string,
    kind: 'delete' | 'import',
    payload: PendingAssetOperation,
  ): void {
    if (
      !isAssetManifest(payload.previousManifest) ||
      !isAssetManifest(payload.nextManifest)
    ) {
      throw new Error('Pending asset operation contains an invalid manifest.');
    }
    this.database.connection
      .prepare(
        `INSERT INTO asset_file_operations (
           operation_id, kind, payload_json
         ) VALUES (?, ?, ?)`,
      )
      .run(operationId, kind, JSON.stringify(payload));
  }

  private deletePendingOperation(operationId: string): void {
    this.database.connection
      .prepare(
        `DELETE FROM asset_file_operations
         WHERE operation_id = ?`,
      )
      .run(operationId);
  }

  private async recoverPendingOperations(): Promise<void> {
    const rows = this.database.connection
      .prepare(
        `SELECT operation_id, kind, payload_json
         FROM asset_file_operations
         ORDER BY rowid`,
      )
      .all() as unknown as Array<{
      kind: 'delete' | 'import';
      operation_id: string;
      payload_json: string;
    }>;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as PendingAssetOperation;
      if (
        !payload ||
        !Array.isArray(payload.files) ||
        !isAssetManifest(payload.previousManifest) ||
        !isAssetManifest(payload.nextManifest)
      ) {
        throw new Error('Pending asset operation is malformed.');
      }
      for (const file of payload.files) {
        const finalPath = this.resolvePendingPath(
          this.assetDirectory,
          file.finalName,
        );
        const stagingPath = this.resolvePendingPath(
          this.stagingDirectory,
          file.stagingName,
        );
        if (row.kind === 'import') {
          const finalExists = await stat(finalPath)
            .then((entry) => entry.isFile())
            .catch(() => false);
          if (finalExists) {
            await rm(stagingPath, { force: true });
          } else {
            await rename(stagingPath, finalPath);
          }
        } else {
          const stagingExists = await stat(stagingPath)
            .then((entry) => entry.isFile())
            .catch(() => false);
          if (!stagingExists) {
            await rename(finalPath, stagingPath).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') {
                  throw error;
                }
              },
            );
          } else {
            await rm(finalPath, { force: true });
          }
        }
      }
      await this.writeManifest(payload.nextManifest, row.operation_id);
      if (row.kind === 'delete') {
        await Promise.all(
          payload.files.map((file) =>
            this.trashItem(
              this.resolvePendingPath(
                this.stagingDirectory,
                file.stagingName,
              ),
            ).catch(() => undefined),
          ),
        );
      }
      await this.touchCampaign();
    }
  }

  private resolvePendingPath(directory: string, filename: string): string {
    if (path.basename(filename) !== filename) {
      throw new Error('Pending asset path is invalid.');
    }
    const resolvedDirectory = path.resolve(directory);
    const target = path.resolve(resolvedDirectory, filename);
    if (!target.startsWith(`${resolvedDirectory}${path.sep}`)) {
      throw new Error('Pending asset path escaped its directory.');
    }
    return target;
  }
}
