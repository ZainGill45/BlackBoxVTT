import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  create as createTar,
  extract as extractTar,
  list as listTar,
  type ReadEntry,
} from 'tar';
import { MAX_ASSET_BYTES, type AssetRecord } from '../shared/assets';
import {
  type CampaignErrorCode,
  type CampaignExportReceipt,
  type CampaignImportReceipt,
  type CampaignManifest,
  type CampaignResult,
} from '../shared/campaigns';
import { fail } from '../shared/result';
import { isAssetManifest } from './assetRepository';
import { convertCampaignArchiveFormat1 } from './campaignArchiveFormat1';
import { convertCampaignArchiveFormat2 } from './campaignArchiveFormat2';
import type { CampaignRepository } from './campaignRepository';
import {
  CAMPAIGN_DATABASE_FILENAME,
  CampaignDatabase,
} from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';

const ARCHIVE_EXTENSION = '.blackbox-campaign';
const ARCHIVE_FORMAT_VERSION = 3 as const;
const PREVIOUS_ARCHIVE_FORMAT_VERSION = 2 as const;
const LEGACY_ARCHIVE_FORMAT_VERSION = 1 as const;
const ARCHIVE_KIND = 'blackbox-campaign' as const;
const EXPORT_MANIFEST_FILENAME = 'export.json';
const MAX_ARCHIVE_BYTES = 64 * 1024 ** 3;
const MAX_ARCHIVE_DATABASE_BYTES = 2 * 1024 ** 3;
const MAX_ARCHIVE_ENTRIES = 65_536;
const MAX_EXPORT_MANIFEST_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ARCHIVE_PATH_PATTERN =
  /^content\/assets\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i;

interface CampaignArchiveEnvelope {
  campaign: CampaignManifest;
  exportedAt: string;
  formatVersion:
    | typeof ARCHIVE_FORMAT_VERSION
    | typeof PREVIOUS_ARCHIVE_FORMAT_VERSION
    | typeof LEGACY_ARCHIVE_FORMAT_VERSION;
  kind: typeof ARCHIVE_KIND;
  sourceRelease: string;
}

class UnsupportedCampaignArchiveError extends Error {}

export interface CampaignArchiveDialogs {
  chooseExportPath(defaultFileName: string): Promise<string | null>;
  chooseImportPath(): Promise<string | null>;
}

interface CampaignArchiveServiceOptions {
  campaigns: CampaignRepository;
  createId?: () => string;
  dialogs: CampaignArchiveDialogs;
  now?: () => Date;
  rootDirectory: string;
  sourceRelease: string;
  warn?: (message: string, error?: unknown) => void;
}

function failure<T>(
  code: CampaignErrorCode,
  message: string,
): CampaignResult<T> {
  return fail({ code, message });
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isArchiveEnvelope(value: unknown): value is CampaignArchiveEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<CampaignArchiveEnvelope>;
  const campaign = envelope.campaign as Partial<CampaignManifest> | undefined;
  return (
    envelope.kind === ARCHIVE_KIND &&
    (envelope.formatVersion === ARCHIVE_FORMAT_VERSION ||
      envelope.formatVersion === PREVIOUS_ARCHIVE_FORMAT_VERSION ||
      envelope.formatVersion === LEGACY_ARCHIVE_FORMAT_VERSION) &&
    typeof envelope.sourceRelease === 'string' &&
    envelope.sourceRelease.length >= 1 &&
    envelope.sourceRelease.length <= 128 &&
    isTimestamp(envelope.exportedAt) &&
    !!campaign &&
    typeof campaign.id === 'string' &&
    UUID_PATTERN.test(campaign.id) &&
    typeof campaign.name === 'string' &&
    campaign.name.length >= 1 &&
    campaign.name.length <= 64 &&
    isTimestamp(campaign.createdAt) &&
    isTimestamp(campaign.updatedAt) &&
    !!campaign.system &&
    typeof campaign.system === 'object'
  );
}

function safeArchiveFileName(name: string): string {
  const withoutControlCharacters = [...name]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('');
  const safeName = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${safeName || 'Campaign'}${ARCHIVE_EXTENSION}`;
}

function withArchiveExtension(filePath: string): string {
  return filePath.toLocaleLowerCase('en-US').endsWith(ARCHIVE_EXTENSION)
    ? filePath
    : `${filePath}${ARCHIVE_EXTENSION}`;
}

function importedName(
  sourceName: string,
  existingNames: ReadonlySet<string>,
): string {
  const key = (value: string) =>
    value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const normalizedSource = sourceName.normalize('NFKC').trim();
  if (!existingNames.has(key(normalizedSource))) return normalizedSource;
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? ' (Imported)' : ` (Imported ${index})`;
    const candidate = `${normalizedSource.slice(0, 64 - suffix.length).trimEnd()}${suffix}`;
    if (!existingNames.has(key(candidate))) return candidate;
  }
  throw new Error('No unique imported campaign name is available.');
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function normalizedArchivePath(entryPath: string): string {
  if (entryPath.includes('\\')) {
    throw new Error('Archive paths must use forward slashes.');
  }
  const normalized = entryPath.replace(/\/$/, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error('Archive contains an unsafe path.');
  }
  return normalized;
}

function validateArchiveEntry(entry: ReadEntry): string {
  const entryPath = normalizedArchivePath(entry.path);
  const isDirectory = entry.type === 'Directory';
  const isFile = entry.type === 'File' || entry.type === 'OldFile';
  const allowedDirectory =
    isDirectory && (entryPath === 'content' || entryPath === 'content/assets');
  const allowedFile =
    isFile &&
    (entryPath === EXPORT_MANIFEST_FILENAME ||
      entryPath === CAMPAIGN_DATABASE_FILENAME ||
      ASSET_ARCHIVE_PATH_PATTERN.test(entryPath));
  if (!allowedDirectory && !allowedFile) {
    throw new Error(`Archive contains an unsupported entry: ${entryPath}`);
  }
  if (
    (entryPath === EXPORT_MANIFEST_FILENAME &&
      entry.size > MAX_EXPORT_MANIFEST_BYTES) ||
    (entryPath === CAMPAIGN_DATABASE_FILENAME &&
      entry.size > MAX_ARCHIVE_DATABASE_BYTES) ||
    (ASSET_ARCHIVE_PATH_PATTERN.test(entryPath) &&
      entry.size > MAX_ASSET_BYTES)
  ) {
    throw new Error(`Archive entry is too large: ${entryPath}`);
  }
  return entryPath;
}

async function inspectArchive(archivePath: string): Promise<void> {
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile() || archiveStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('The selected campaign archive is too large or is not a file.');
  }
  const entries = new Set<string>();
  let expandedBytes = 0;
  await listTar({
    file: archivePath,
    gzip: true,
    maxDecompressionRatio: 100,
    onReadEntry: (entry) => {
      const entryPath = validateArchiveEntry(entry);
      if (entries.has(entryPath)) {
        throw new Error(`Archive contains a duplicate entry: ${entryPath}`);
      }
      entries.add(entryPath);
      expandedBytes += entry.size;
      if (
        entries.size > MAX_ARCHIVE_ENTRIES ||
        expandedBytes > MAX_ARCHIVE_BYTES
      ) {
        throw new Error('The selected campaign archive expands beyond its limit.');
      }
    },
    strict: true,
  });
  if (
    !entries.has(EXPORT_MANIFEST_FILENAME) ||
    !entries.has(CAMPAIGN_DATABASE_FILENAME)
  ) {
    throw new Error('Campaign archive is missing required files.');
  }
}

async function readEnvelope(directory: string): Promise<CampaignArchiveEnvelope> {
  const source = await readFile(
    path.join(directory, EXPORT_MANIFEST_FILENAME),
    'utf8',
  );
  let envelope: unknown;
  try {
    envelope = JSON.parse(source);
  } catch {
    throw new Error('Campaign archive manifest is not valid JSON.');
  }
  if (
    envelope &&
    typeof envelope === 'object' &&
    'kind' in envelope &&
    envelope.kind === ARCHIVE_KIND &&
    'formatVersion' in envelope &&
    envelope.formatVersion !== ARCHIVE_FORMAT_VERSION &&
    envelope.formatVersion !== PREVIOUS_ARCHIVE_FORMAT_VERSION &&
    envelope.formatVersion !== LEGACY_ARCHIVE_FORMAT_VERSION
  ) {
    throw new UnsupportedCampaignArchiveError(
      'Campaign archive format is not supported.',
    );
  }
  if (!isArchiveEnvelope(envelope)) {
    throw new Error('Campaign archive manifest is malformed.');
  }
  return envelope;
}

async function readAndVerifyAssets(
  campaignDirectory: string,
  database: CampaignDatabase,
): Promise<AssetRecord[]> {
  const pendingOperation = database.connection
    .prepare('SELECT operation_id FROM asset_file_operations LIMIT 1')
    .get();
  if (pendingOperation) {
    throw new Error('Campaign has an unfinished asset file operation.');
  }
  const state = database.connection
    .prepare('SELECT revision FROM asset_manifest WHERE singleton = 1')
    .get() as { revision?: unknown } | undefined;
  const rows = database.connection
    .prepare('SELECT id, record_json FROM assets ORDER BY position')
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
    throw new Error('Campaign asset manifest is invalid.');
  }
  const assetDirectory = path.join(campaignDirectory, 'content', 'assets');
  const expectedNames = new Set(
    manifest.assets.map((asset) => `${asset.id}.${asset.extension}`),
  );
  const entries = await readdir(assetDirectory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        expectedNames.size === 0
      ) {
        return [];
      }
      throw error;
    },
  );
  if (
    entries.some(
      (entry) => !entry.isFile() || !expectedNames.has(entry.name),
    ) ||
    entries.length !== expectedNames.size
  ) {
    throw new Error('Campaign archive asset files do not match its manifest.');
  }
  for (const asset of manifest.assets) {
    const assetPath = path.join(assetDirectory, `${asset.id}.${asset.extension}`);
    const fileStat = await stat(assetPath);
    if (
      !fileStat.isFile() ||
      fileStat.size !== asset.sizeBytes ||
      (await sha256(assetPath)) !== asset.sha256
    ) {
      throw new Error(`Campaign archive asset is invalid: ${asset.displayName}`);
    }
  }
  return manifest.assets;
}

export class CampaignArchiveService {
  private readonly campaigns: CampaignRepository;
  private readonly createId: () => string;
  private readonly dialogs: CampaignArchiveDialogs;
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private readonly rootDirectory: string;
  private readonly sourceRelease: string;
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    campaigns,
    createId = randomUUID,
    dialogs,
    now = () => new Date(),
    rootDirectory,
    sourceRelease,
    warn = console.warn,
  }: CampaignArchiveServiceOptions) {
    this.campaigns = campaigns;
    this.createId = createId;
    this.dialogs = dialogs;
    this.now = now;
    this.rootDirectory = path.resolve(rootDirectory);
    this.sourceRelease = sourceRelease;
    this.warn = warn;
  }

  exportCampaign(
    input: unknown,
  ): Promise<CampaignResult<CampaignExportReceipt | null>> {
    return this.mutations.run(async () => {
      const id =
        input &&
        typeof input === 'object' &&
        'id' in input &&
        typeof input.id === 'string' &&
        UUID_PATTERN.test(input.id)
          ? input.id
          : null;
      if (!id) return failure('not_found', 'Campaign could not be found.');
      const container = await this.campaigns.getContainer(id);
      if (!container) return failure('not_found', 'Campaign could not be found.');
      const chosenPath = await this.dialogs.chooseExportPath(
        safeArchiveFileName(container.manifest.name),
      );
      if (!chosenPath) return { ok: true, value: null };

      const destinationPath = withArchiveExtension(path.resolve(chosenPath));
      const temporaryDirectory = await mkdtemp(
        path.join(tmpdir(), 'blackbox-campaign-export-'),
      );
      const partialPath = `${destinationPath}.${randomUUID()}.part`;
      let database: CampaignDatabase | null = null;
      try {
        const contentDirectory = path.join(temporaryDirectory, 'content');
        const exportedAssets = path.join(contentDirectory, 'assets');
        await mkdir(exportedAssets, { recursive: true });
        database = CampaignDatabase.open(container.directory);
        const assets = await readAndVerifyAssets(container.directory, database);
        for (const asset of assets) {
          const fileName = `${asset.id}.${asset.extension}`;
          await copyFile(
            path.join(container.directory, 'content', 'assets', fileName),
            path.join(exportedAssets, fileName),
          );
        }
        await backup(
          database.connection,
          path.join(temporaryDirectory, CAMPAIGN_DATABASE_FILENAME),
        );
        const envelope: CampaignArchiveEnvelope = {
          campaign: database.readManifest(),
          exportedAt: this.now().toISOString(),
          formatVersion: ARCHIVE_FORMAT_VERSION,
          kind: ARCHIVE_KIND,
          sourceRelease: this.sourceRelease,
        };
        await writeFile(
          path.join(temporaryDirectory, EXPORT_MANIFEST_FILENAME),
          `${JSON.stringify(envelope, null, 2)}\n`,
          'utf8',
        );
        database.close();
        database = null;
        await createTar(
          {
            cwd: temporaryDirectory,
            file: partialPath,
            gzip: true,
            portable: true,
            strict: true,
          },
          [
            EXPORT_MANIFEST_FILENAME,
            CAMPAIGN_DATABASE_FILENAME,
            'content/assets',
          ],
        );
        await rm(destinationPath, { force: true });
        await rename(partialPath, destinationPath);
        return {
          ok: true,
          value: { fileName: path.basename(destinationPath) },
        };
      } catch (error) {
        this.warn('Failed to export a campaign archive.', error);
        return failure('storage_error', 'Campaign could not be exported.');
      } finally {
        database?.close();
        await rm(partialPath, { force: true });
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    });
  }

  importCampaign(): Promise<CampaignResult<CampaignImportReceipt | null>> {
    return this.mutations.run(async () => {
      const archivePath = await this.dialogs.chooseImportPath();
      if (!archivePath) return { ok: true, value: null };
      const temporaryDirectory = await mkdtemp(
        path.join(tmpdir(), 'blackbox-campaign-import-'),
      );
      const extractedDirectory = path.join(temporaryDirectory, 'extracted');
      let archiveValidated = false;
      let sourceDatabase: CampaignDatabase | null = null;
      let stagingDirectory: string | null = null;
      try {
        await inspectArchive(archivePath);
        await mkdir(extractedDirectory);
        await extractTar({
          cwd: extractedDirectory,
          file: archivePath,
          filter: (_entryPath, entry) => {
            validateArchiveEntry(entry as ReadEntry);
            return true;
          },
          gzip: true,
          maxDecompressionRatio: 100,
          maxDepth: 3,
          preserveOwner: false,
          strict: true,
        });
        const envelope = await readEnvelope(extractedDirectory);
        const id = this.createId();
        if (!UUID_PATTERN.test(id)) {
          throw new Error('Campaign ID generator returned an invalid UUID.');
        }
        stagingDirectory = path.join(this.rootDirectory, `.importing-${id}`);
        const campaignDirectory = path.join(this.rootDirectory, id);
        await mkdir(path.join(stagingDirectory, 'content', 'assets'), {
          recursive: true,
        });
        const stagedDatabasePath = path.join(
          stagingDirectory,
          CAMPAIGN_DATABASE_FILENAME,
        );
        let conversionWarnings: string[] = [];
        if (envelope.formatVersion !== ARCHIVE_FORMAT_VERSION) {
          const archivedConnection = new DatabaseSync(
            path.join(extractedDirectory, CAMPAIGN_DATABASE_FILENAME),
            { readOnly: true },
          );
          try {
            await backup(archivedConnection, stagedDatabasePath);
          } finally {
            archivedConnection.close();
          }
          const conversionConnection = new DatabaseSync(stagedDatabasePath);
          try {
            conversionWarnings = envelope.formatVersion === LEGACY_ARCHIVE_FORMAT_VERSION
              ? convertCampaignArchiveFormat1(conversionConnection)
              : convertCampaignArchiveFormat2(conversionConnection);
          } finally {
            conversionConnection.close();
          }
        } else {
          sourceDatabase = CampaignDatabase.open(extractedDirectory);
          await backup(sourceDatabase.connection, stagedDatabasePath);
          sourceDatabase.close();
          sourceDatabase = null;
        }

        sourceDatabase = CampaignDatabase.open(stagingDirectory);
        const sourceManifest = sourceDatabase.readManifest();
        if (
          sourceManifest.id !== envelope.campaign.id ||
          sourceManifest.name !== envelope.campaign.name
        ) {
          throw new Error('Campaign archive manifest does not match its database.');
        }
        const assets = await readAndVerifyAssets(
          extractedDirectory,
          sourceDatabase,
        );
        sourceDatabase.close();
        sourceDatabase = null;
        archiveValidated = true;
        const listed = await this.campaigns.list();
        if (!listed.ok) return listed;
        const existingNames = new Set(
          listed.value.map((campaign) =>
            campaign.name.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
          ),
        );
        const name = importedName(sourceManifest.name, existingNames);
        for (const asset of assets) {
          const fileName = `${asset.id}.${asset.extension}`;
          await copyFile(
            path.join(extractedDirectory, 'content', 'assets', fileName),
            path.join(stagingDirectory, 'content', 'assets', fileName),
          );
        }

        const installedDatabase = CampaignDatabase.open(stagingDirectory);
        let campaign: CampaignManifest;
        try {
          installedDatabase.connection
            .prepare(
              `UPDATE campaign_metadata
               SET campaign_id = ?, name = ?, updated_at = ?
               WHERE singleton = 1`,
            )
            .run(id, name, this.now().toISOString());
          for (const asset of assets) {
            const fileName = `${asset.id}.${asset.extension}`;
            const fileStat = await stat(
              path.join(stagingDirectory, 'content', 'assets', fileName),
            );
            installedDatabase.connection
              .prepare('UPDATE assets SET record_json = ? WHERE id = ?')
              .run(
                JSON.stringify({ ...asset, fileModifiedAtMs: fileStat.mtimeMs }),
                asset.id,
              );
          }
          await readAndVerifyAssets(stagingDirectory, installedDatabase);
          campaign = installedDatabase.readManifest();
        } finally {
          installedDatabase.close();
        }
        await mkdir(this.rootDirectory, { recursive: true });
        await rename(stagingDirectory, campaignDirectory);
        stagingDirectory = null;
        return {
          ok: true,
          value: {
            campaign,
            report: {
              sourceRelease: envelope.sourceRelease,
              warnings: [
                ...conversionWarnings,
                'Server identity was not imported; a new TLS identity will be generated.',
              ],
            },
          },
        };
      } catch (error) {
        this.warn('Failed to import a campaign archive.', error);
        const unsupported = error instanceof UnsupportedCampaignArchiveError;
        if (archiveValidated) {
          return failure('storage_error', 'Campaign could not be imported.');
        }
        return failure(
          unsupported ? 'unsupported_archive' : 'invalid_archive',
          unsupported
            ? 'This campaign archive format is not supported.'
            : 'The selected campaign archive is invalid or incomplete.',
        );
      } finally {
        sourceDatabase?.close();
        if (stagingDirectory) {
          await rm(stagingDirectory, { force: true, recursive: true });
        }
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    });
  }
}
