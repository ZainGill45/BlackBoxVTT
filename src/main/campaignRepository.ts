import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  CAMPAIGN_SCHEMA_VERSION,
  type CampaignErrorCode,
  type CampaignManifest,
  type CampaignResult,
  type CampaignSummary,
} from '../shared/campaigns';
import { fail } from '../shared/result';
import { writeJsonAtomic } from './storage/atomicWrite';
import { MutationQueue } from './storage/mutationQueue';

const CAMPAIGN_MANIFEST_FILENAME = 'campaign.json';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CampaignRepositoryOptions {
  createId?: () => string;
  now?: () => Date;
  rootDirectory: string;
  trashItem: (targetPath: string) => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}

interface CampaignContainer {
  directory: string;
  manifest: CampaignManifest;
}

function failure<T>(
  code: CampaignErrorCode,
  message: string,
): CampaignResult<T> {
  return fail({ code, message });
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').trim();
}

function duplicateKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('en-US');
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isCampaignManifest(value: unknown): value is CampaignManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<CampaignManifest>;

  return (
    manifest.schemaVersion === CAMPAIGN_SCHEMA_VERSION &&
    typeof manifest.id === 'string' &&
    UUID_PATTERN.test(manifest.id) &&
    typeof manifest.name === 'string' &&
    normalizeName(manifest.name) === manifest.name &&
    manifest.name.length >= 1 &&
    manifest.name.length <= 64 &&
    isValidTimestamp(manifest.createdAt) &&
    isValidTimestamp(manifest.updatedAt)
  );
}

export class CampaignRepository {
  private readonly createId: () => string;
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private readonly rootDirectory: string;
  private readonly trashItem: (targetPath: string) => Promise<void>;
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    createId = randomUUID,
    now = () => new Date(),
    rootDirectory,
    trashItem,
    warn = console.warn,
  }: CampaignRepositoryOptions) {
    this.createId = createId;
    this.now = now;
    this.rootDirectory = path.resolve(rootDirectory);
    this.trashItem = trashItem;
    this.warn = warn;
  }

  async list(): Promise<CampaignResult<CampaignSummary[]>> {
    try {
      const campaigns = await this.readCampaigns();
      return { ok: true, value: campaigns };
    } catch (error) {
      this.warn('Failed to read the campaign repository.', error);
      return failure('storage_error', 'Campaigns could not be loaded.');
    }
  }

  async getContainer(id: string): Promise<CampaignContainer | null> {
    if (!UUID_PATTERN.test(id)) {
      return null;
    }

    try {
      const directory = this.resolveCampaignDirectory(id);
      const manifestSource = await readFile(
        path.join(directory, CAMPAIGN_MANIFEST_FILENAME),
        'utf8',
      );
      const manifest: unknown = JSON.parse(manifestSource);

      if (!isCampaignManifest(manifest) || manifest.id !== id) {
        return null;
      }

      return { directory, manifest };
    } catch {
      return null;
    }
  }

  touch(id: string): Promise<CampaignResult<CampaignManifest>> {
    return this.mutations.run(async () => {
      const container = await this.getContainer(id);
      if (!container) {
        return failure('not_found', 'Campaign could not be found.');
      }

      try {
        const manifest: CampaignManifest = {
          ...container.manifest,
          updatedAt: this.now().toISOString(),
        };
        await writeJsonAtomic(
          path.join(container.directory, CAMPAIGN_MANIFEST_FILENAME),
          manifest,
        );
        return { ok: true, value: manifest };
      } catch (error) {
        this.warn('Failed to update the campaign timestamp.', error);
        return failure('storage_error', 'Campaign could not be updated.');
      }
    });
  }

  create(input: unknown): Promise<CampaignResult<CampaignSummary>> {
    return this.mutations.run(async () => {
      if (
        !input ||
        typeof input !== 'object' ||
        typeof (input as { name?: unknown }).name !== 'string'
      ) {
        return failure(
          'invalid_name',
          'Campaign name must be between 1 and 64 characters.',
        );
      }

      const name = normalizeName((input as { name: string }).name);

      if (name.length < 1 || name.length > 64) {
        return failure(
          'invalid_name',
          'Campaign name must be between 1 and 64 characters.',
        );
      }

      try {
        const campaigns = await this.readCampaigns();

        if (
          campaigns.some(
            (campaign) => duplicateKey(campaign.name) === duplicateKey(name),
          )
        ) {
          return failure(
            'duplicate_name',
            `A campaign named “${name}” already exists.`,
          );
        }

        const id = this.createId();

        if (!UUID_PATTERN.test(id)) {
          throw new Error('Campaign ID generator returned an invalid UUID.');
        }

        const timestamp = this.now().toISOString();
        const manifest: CampaignManifest = {
          createdAt: timestamp,
          id,
          name,
          schemaVersion: CAMPAIGN_SCHEMA_VERSION,
          updatedAt: timestamp,
        };
        const stagingDirectory = path.join(
          this.rootDirectory,
          `.creating-${id}`,
        );
        const campaignDirectory = this.resolveCampaignDirectory(id);

        await mkdir(this.rootDirectory, { recursive: true });

        try {
          await mkdir(stagingDirectory);
          await mkdir(path.join(stagingDirectory, 'content'));
          await writeFile(
            path.join(stagingDirectory, CAMPAIGN_MANIFEST_FILENAME),
            `${JSON.stringify(manifest, null, 2)}\n`,
            { encoding: 'utf8', flag: 'wx' },
          );
          await rename(stagingDirectory, campaignDirectory);
        } catch (error) {
          await rm(stagingDirectory, { force: true, recursive: true });
          throw error;
        }

        return { ok: true, value: manifest };
      } catch (error) {
        this.warn('Failed to create a campaign container.', error);
        return failure('storage_error', 'Campaign could not be created.');
      }
    });
  }

  trash(input: unknown): Promise<CampaignResult<null>> {
    return this.mutations.run(async () => {
      if (
        !input ||
        typeof input !== 'object' ||
        typeof (input as { id?: unknown }).id !== 'string' ||
        !UUID_PATTERN.test((input as { id: string }).id)
      ) {
        return failure('not_found', 'Campaign could not be found.');
      }

      const id = (input as { id: string }).id;

      try {
        const campaignDirectory = this.resolveCampaignDirectory(id);
        const manifestSource = await readFile(
          path.join(campaignDirectory, CAMPAIGN_MANIFEST_FILENAME),
          'utf8',
        );
        const manifest: unknown = JSON.parse(manifestSource);

        if (!isCampaignManifest(manifest) || manifest.id !== id) {
          return failure('not_found', 'Campaign could not be found.');
        }

        await this.trashItem(campaignDirectory);
        return { ok: true, value: null };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;

        if (nodeError.code === 'ENOENT') {
          return failure('not_found', 'Campaign could not be found.');
        }

        this.warn('Failed to move a campaign container to the trash.', error);
        return failure('storage_error', 'Campaign could not be deleted.');
      }
    });
  }


  private async readCampaigns(): Promise<CampaignSummary[]> {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const campaigns: CampaignSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      try {
        const manifestSource = await readFile(
          path.join(
            this.resolveCampaignDirectory(entry.name),
            CAMPAIGN_MANIFEST_FILENAME,
          ),
          'utf8',
        );
        const manifest: unknown = JSON.parse(manifestSource);

        if (!isCampaignManifest(manifest) || manifest.id !== entry.name) {
          throw new Error('Campaign manifest is invalid.');
        }

        campaigns.push(manifest);
      } catch (error) {
        this.warn(
          `Ignoring malformed campaign container “${entry.name}”.`,
          error,
        );
      }
    }

    return campaigns.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
  }

  private resolveCampaignDirectory(id: string): string {
    if (!UUID_PATTERN.test(id)) {
      throw new Error('Campaign ID is not a UUID.');
    }

    const target = path.resolve(this.rootDirectory, id);
    const rootPrefix = `${this.rootDirectory}${path.sep}`;

    if (!target.startsWith(rootPrefix)) {
      throw new Error('Campaign path escaped the repository root.');
    }

    return target;
  }
}
