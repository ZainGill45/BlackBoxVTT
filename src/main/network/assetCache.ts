import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  ASSET_MANIFEST_SCHEMA_VERSION,
  type AssetManifest,
  type AssetProgressEvent,
  type AssetRecord,
} from '../../shared/assets';

interface CachedFileState {
  fileModifiedAtMs: number;
  sha256: string;
  sizeBytes: number;
}

interface CacheIndex {
  files: Record<string, CachedFileState>;
  manifest: AssetManifest;
  schemaVersion: 1;
}

interface PartialState {
  assetId: string;
  chunkHashes: string[];
  completed: number[];
  sha256: string;
  sizeBytes: number;
}

interface AssetChunk {
  data: Buffer;
  hash: string;
  index: number;
}

export class AssetCacheSyncError extends Error {
  constructor(
    readonly assetId: string,
    readonly assetName: string,
    cause: unknown,
  ) {
    super(
      `${assetName}: ${
        cause instanceof Error ? cause.message : 'Synchronization failed.'
      }`,
    );
    this.name = 'AssetCacheSyncError';
  }
}

const emptyManifest = (): AssetManifest => ({
  assets: [],
  revision: 0,
  schemaVersion: ASSET_MANIFEST_SCHEMA_VERSION,
});

const emptyIndex = (): CacheIndex => ({
  files: {},
  manifest: emptyManifest(),
  schemaVersion: 1,
});

async function hashFile(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  const hash = createHash('sha256');
  try {
    const buffer = Buffer.allocUnsafe(512 * 1024);
    let position = 0;
    let finished = false;
    while (!finished) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        finished = true;
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export class RemoteAssetCache {
  private readonly assetDirectory: string;
  private readonly campaignDirectory: string;
  private readonly indexPath: string;
  private readonly partialDirectory: string;

  constructor(rootDirectory: string, readonly campaignId: string) {
    this.campaignDirectory = path.resolve(rootDirectory, campaignId);
    this.assetDirectory = path.join(this.campaignDirectory, 'assets');
    this.partialDirectory = path.join(this.campaignDirectory, '.partial');
    this.indexPath = path.join(this.campaignDirectory, 'cache.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.assetDirectory, { recursive: true });
    await mkdir(this.partialDirectory, { recursive: true });
  }

  async getManifest(): Promise<AssetManifest> {
    return (await this.readIndex()).manifest;
  }

  async getAssetPath(record: AssetRecord): Promise<string | null> {
    const index = await this.readIndex();
    const state = index.files[record.id];
    if (!state || state.sha256 !== record.sha256) {
      return null;
    }
    const target = this.resolveAssetPath(record);
    try {
      const fileStat = await stat(target);
      return fileStat.isFile() && fileStat.size === record.sizeBytes
        ? target
        : null;
    } catch {
      return null;
    }
  }

  async synchronize(
    manifest: AssetManifest,
    fetchChunk: (asset: AssetRecord, index: number) => Promise<AssetChunk>,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<void> {
    await this.initialize();
    let index = await this.readIndex();
    const currentIds = new Set(manifest.assets.map((asset) => asset.id));
    const expectedFiles = new Set(
      manifest.assets.map((asset) => `${asset.id}.${asset.extension}`),
    );

    onProgress({
      completedBytes: 0,
      phase: 'checking',
      scope: 'sync',
      totalBytes: null,
    });

    for (const entry of await readdir(this.assetDirectory)) {
      const assetId = entry.split('.')[0];
      if (!currentIds.has(assetId) || !expectedFiles.has(entry)) {
        onProgress({
          completedBytes: 0,
          currentName: entry,
          phase: 'removing',
          scope: 'sync',
          totalBytes: null,
        });
        await rm(path.join(this.assetDirectory, entry), { force: true });
        delete index.files[assetId];
      }
    }
    for (const entry of await readdir(this.partialDirectory)) {
      const assetId = entry.split('.')[0];
      if (!currentIds.has(assetId)) {
        await rm(path.join(this.partialDirectory, entry), { force: true });
      }
    }

    const missing: AssetRecord[] = [];
    for (const asset of manifest.assets) {
      const state = index.files[asset.id];
      const target = this.resolveAssetPath(asset);
      let valid = false;
      if (state?.sha256 === asset.sha256 && state.sizeBytes === asset.sizeBytes) {
        try {
          const fileStat = await stat(target);
          if (
            fileStat.isFile() &&
            fileStat.size === asset.sizeBytes &&
            Math.abs(fileStat.mtimeMs - state.fileModifiedAtMs) < 2
          ) {
            valid = true;
          } else if (fileStat.isFile() && fileStat.size === asset.sizeBytes) {
            valid = (await hashFile(target)) === asset.sha256;
            if (valid) {
              state.fileModifiedAtMs = fileStat.mtimeMs;
            }
          }
        } catch {
          valid = false;
        }
      }
      if (!valid) {
        missing.push(asset);
      }
    }

    const totalBytes = missing.reduce((total, asset) => total + asset.sizeBytes, 0);
    let completedBytes = 0;
    for (const asset of missing) {
      try {
        await this.downloadAsset(asset, fetchChunk, (assetCompleted) => {
          onProgress({
            assetId: asset.id,
            completedBytes: completedBytes + assetCompleted,
            currentName: asset.displayName,
            phase: 'downloading',
            scope: 'sync',
            totalBytes,
          });
        });
      } catch (error) {
        throw new AssetCacheSyncError(asset.id, asset.displayName, error);
      }
      completedBytes += asset.sizeBytes;
      const fileStat = await stat(this.resolveAssetPath(asset));
      index.files[asset.id] = {
        fileModifiedAtMs: fileStat.mtimeMs,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
      };
      index.manifest = manifest;
      await this.writeIndex(index);
    }

    index = {
      files: Object.fromEntries(
        Object.entries(index.files).filter(([assetId]) => currentIds.has(assetId)),
      ),
      manifest,
      schemaVersion: 1,
    };
    await this.writeIndex(index);
    onProgress({
      completedBytes: totalBytes,
      phase: 'downloading',
      scope: 'sync',
      totalBytes,
    });
  }

  async clear(): Promise<void> {
    const target = path.resolve(this.campaignDirectory);
    if (!target.startsWith(`${path.dirname(target)}${path.sep}`)) {
      throw new Error('Cache path is invalid.');
    }
    await rm(target, { force: true, recursive: true });
  }

  private async downloadAsset(
    asset: AssetRecord,
    fetchChunk: (asset: AssetRecord, index: number) => Promise<AssetChunk>,
    onProgress: (completed: number) => void,
  ): Promise<void> {
    const partialPath = path.join(this.partialDirectory, `${asset.id}.part`);
    const statePath = path.join(this.partialDirectory, `${asset.id}.json`);
    let partial: PartialState = {
      assetId: asset.id,
      chunkHashes: asset.chunkHashes,
      completed: [],
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    };
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8')) as PartialState;
      if (
        parsed.assetId === asset.id &&
        parsed.sha256 === asset.sha256 &&
        parsed.sizeBytes === asset.sizeBytes &&
        JSON.stringify(parsed.chunkHashes) === JSON.stringify(asset.chunkHashes)
      ) {
        partial = parsed;
      }
    } catch {
      await rm(partialPath, { force: true });
    }

    const handle = await open(partialPath, 'r+').catch(() =>
      open(partialPath, 'w+'),
    );
    try {
      const completed = new Set(partial.completed);
      for (const chunkIndex of [...completed]) {
        const offset = chunkIndex * 512 * 1024;
        const length = Math.min(512 * 1024, asset.sizeBytes - offset);
        const existing = Buffer.allocUnsafe(length);
        const read = await handle.read(existing, 0, length, offset);
        const hash =
          read.bytesRead === length
            ? createHash('sha256')
                .update(existing.subarray(0, read.bytesRead))
                .digest('hex')
            : null;
        if (hash !== asset.chunkHashes[chunkIndex]) {
          completed.delete(chunkIndex);
        }
      }
      let completedBytes = [...completed].reduce((total, chunkIndex) => {
        const offset = chunkIndex * 512 * 1024;
        return total + Math.min(512 * 1024, asset.sizeBytes - offset);
      }, 0);
      onProgress(completedBytes);

      for (let chunkIndex = 0; chunkIndex < asset.chunkHashes.length; chunkIndex += 1) {
        if (completed.has(chunkIndex)) {
          continue;
        }
        let chunk: AssetChunk | null = null;
        let lastError: unknown;
        for (const wait of [0, 500, 1_000, 2_000]) {
          if (wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
          try {
            const received = await fetchChunk(asset, chunkIndex);
            const actualHash = createHash('sha256').update(received.data).digest('hex');
            if (
              received.index !== chunkIndex ||
              received.hash !== asset.chunkHashes[chunkIndex] ||
              actualHash !== received.hash
            ) {
              throw new Error('Asset chunk failed integrity verification.');
            }
            chunk = received;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!chunk) {
          throw lastError instanceof Error
            ? lastError
            : new Error('Asset chunk could not be downloaded.');
        }
        await handle.write(chunk.data, 0, chunk.data.length, chunkIndex * 512 * 1024);
        completed.add(chunkIndex);
        completedBytes += chunk.data.length;
        await writeFile(
          statePath,
          JSON.stringify({ ...partial, completed: [...completed] }),
          'utf8',
        );
        onProgress(completedBytes);
      }
    } finally {
      await handle.close();
    }

    if ((await hashFile(partialPath)) !== asset.sha256) {
      await rm(partialPath, { force: true });
      await rm(statePath, { force: true });
      throw new Error(`${asset.displayName} failed integrity verification.`);
    }
    const target = this.resolveAssetPath(asset);
    await rm(target, { force: true });
    await rename(partialPath, target);
    await rm(statePath, { force: true });
  }

  private async readIndex(): Promise<CacheIndex> {
    await this.initialize();
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as CacheIndex;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.manifest.schemaVersion !== ASSET_MANIFEST_SCHEMA_VERSION
      ) {
        throw new Error('Cache index is incompatible.');
      }
      return parsed;
    } catch {
      return emptyIndex();
    }
  }

  private resolveAssetPath(record: AssetRecord): string {
    const target = path.resolve(
      this.assetDirectory,
      `${record.id}.${record.extension}`,
    );
    if (!target.startsWith(`${path.resolve(this.assetDirectory)}${path.sep}`)) {
      throw new Error('Cache asset path escaped its directory.');
    }
    return target;
  }

  private async writeIndex(index: CacheIndex): Promise<void> {
    await mkdir(this.campaignDirectory, { recursive: true });
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
      await rename(temporary, this.indexPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
