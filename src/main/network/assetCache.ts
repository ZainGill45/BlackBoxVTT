import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  type AssetManifest,
  type AssetProgressEvent,
  type AssetRecord,
} from '../../shared/assets';
import type { ApplicationDatabase } from '../storage/applicationDatabase';

interface CachedFileState {
  fileModifiedAtMs: number;
  sha256: string;
  sizeBytes: number;
}

interface CacheIndex {
  files: Record<string, CachedFileState>;
  manifest: AssetManifest;
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
});

const emptyIndex = (): CacheIndex => ({
  files: {},
  manifest: emptyManifest(),
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
  private readonly database: ApplicationDatabase;
  private readonly campaignDirectory: string;
  private readonly partialDirectory: string;

  constructor(
    database: ApplicationDatabase,
    rootDirectory: string,
    readonly campaignId: string,
  ) {
    this.database = database;
    this.campaignDirectory = path.resolve(rootDirectory, campaignId);
    this.assetDirectory = path.join(this.campaignDirectory, 'assets');
    this.partialDirectory = path.join(this.campaignDirectory, '.partial');
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
    this.deleteStalePartials(currentIds);

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
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare('DELETE FROM remote_asset_files WHERE campaign_id = ?')
        .run(this.campaignId);
      database
        .prepare('DELETE FROM remote_asset_partials WHERE campaign_id = ?')
        .run(this.campaignId);
      database
        .prepare('DELETE FROM remote_asset_manifests WHERE campaign_id = ?')
        .run(this.campaignId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    await rm(target, { force: true, recursive: true });
  }

  private async downloadAsset(
    asset: AssetRecord,
    fetchChunk: (asset: AssetRecord, index: number) => Promise<AssetChunk>,
    onProgress: (completed: number) => void,
  ): Promise<void> {
    const partialPath = path.join(this.partialDirectory, `${asset.id}.part`);
    let partial: PartialState = {
      assetId: asset.id,
      chunkHashes: asset.chunkHashes,
      completed: [],
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    };
    try {
      const parsed = this.readPartial(asset.id);
      if (
        parsed &&
        parsed.assetId === asset.id &&
        parsed.sha256 === asset.sha256 &&
        parsed.sizeBytes === asset.sizeBytes &&
        JSON.stringify(parsed.chunkHashes) === JSON.stringify(asset.chunkHashes)
      ) {
        partial = parsed;
      }
    } catch {
      await rm(partialPath, { force: true });
      this.deletePartial(asset.id);
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
        this.writePartial({ ...partial, completed: [...completed] });
        onProgress(completedBytes);
      }
    } finally {
      await handle.close();
    }

    if ((await hashFile(partialPath)) !== asset.sha256) {
      await rm(partialPath, { force: true });
      this.deletePartial(asset.id);
      throw new Error(`${asset.displayName} failed integrity verification.`);
    }
    const target = this.resolveAssetPath(asset);
    await rm(target, { force: true });
    await rename(partialPath, target);
    this.deletePartial(asset.id);
  }

  private async readIndex(): Promise<CacheIndex> {
    await this.initialize();
    try {
      const manifestRow = this.database.connection
        .prepare(
          `SELECT manifest_json
           FROM remote_asset_manifests
           WHERE campaign_id = ?`,
        )
        .get(this.campaignId) as { manifest_json?: unknown } | undefined;
      if (typeof manifestRow?.manifest_json !== 'string') {
        return emptyIndex();
      }
      const manifest = JSON.parse(manifestRow.manifest_json) as AssetManifest;
      const fileRows = this.database.connection
        .prepare(
          `SELECT asset_id, file_modified_at_ms, sha256, size_bytes
           FROM remote_asset_files
           WHERE campaign_id = ?`,
        )
        .all(this.campaignId) as unknown as Array<{
        asset_id: string;
        file_modified_at_ms: number;
        sha256: string;
        size_bytes: number;
      }>;
      const parsed: CacheIndex = {
        files: Object.fromEntries(
          fileRows.map((row) => [
            row.asset_id,
            {
              fileModifiedAtMs: row.file_modified_at_ms,
              sha256: row.sha256,
              sizeBytes: row.size_bytes,
            },
          ]),
        ),
        manifest,
      };
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
    const database = this.database.connection;
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare(
          `INSERT INTO remote_asset_manifests (campaign_id, manifest_json)
           VALUES (?, ?)
           ON CONFLICT(campaign_id) DO UPDATE SET
             manifest_json = excluded.manifest_json`,
        )
        .run(this.campaignId, JSON.stringify(index.manifest));
      database
        .prepare('DELETE FROM remote_asset_files WHERE campaign_id = ?')
        .run(this.campaignId);
      const insert = database.prepare(
        `INSERT INTO remote_asset_files (
           campaign_id, asset_id, file_modified_at_ms, sha256, size_bytes
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [assetId, state] of Object.entries(index.files)) {
        insert.run(
          this.campaignId,
          assetId,
          state.fileModifiedAtMs,
          state.sha256,
          state.sizeBytes,
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private readPartial(assetId: string): PartialState | null {
    const row = this.database.connection
      .prepare(
        `SELECT state_json
         FROM remote_asset_partials
         WHERE campaign_id = ? AND asset_id = ?`,
      )
      .get(this.campaignId, assetId) as { state_json?: unknown } | undefined;
    return typeof row?.state_json === 'string'
      ? (JSON.parse(row.state_json) as PartialState)
      : null;
  }

  private writePartial(state: PartialState): void {
    this.database.connection
      .prepare(
        `INSERT INTO remote_asset_partials (
           campaign_id, asset_id, state_json
         ) VALUES (?, ?, ?)
         ON CONFLICT(campaign_id, asset_id) DO UPDATE SET
           state_json = excluded.state_json`,
      )
      .run(this.campaignId, state.assetId, JSON.stringify(state));
  }

  private deletePartial(assetId: string): void {
    this.database.connection
      .prepare(
        `DELETE FROM remote_asset_partials
         WHERE campaign_id = ? AND asset_id = ?`,
      )
      .run(this.campaignId, assetId);
  }

  private deleteStalePartials(currentIds: Set<string>): void {
    const rows = this.database.connection
      .prepare(
        `SELECT asset_id
         FROM remote_asset_partials
         WHERE campaign_id = ?`,
      )
      .all(this.campaignId) as unknown as Array<{ asset_id: string }>;
    for (const row of rows) {
      if (!currentIds.has(row.asset_id)) {
        this.deletePartial(row.asset_id);
      }
    }
  }
}
