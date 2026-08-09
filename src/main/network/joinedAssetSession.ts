import { rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  AssetActor,
  AssetCapability,
  AssetChangedEvent,
  AssetErrorEvent,
  AssetManifest,
  AssetNetworkSnapshot,
  AssetProgressEvent,
  AssetResult,
  AssetView,
  RenameAssetInput,
  ReorderAssetsInput,
} from '../../shared/assets';
import type { JoinedAssetTransport } from '../campaignAssetRuntime';
import {
  authenticatedAssetPolicy,
  getAssetCapabilities,
} from '../assetPolicy';
import { AssetCacheSyncError, RemoteAssetCache } from './assetCache';
import type { CampaignClient } from './campaignClient';
import type { ConnectionHistoryRepository } from './connectionHistoryRepository';

type AssetClient = Pick<
  CampaignClient,
  | 'disconnect'
  | 'getAssetChunk'
  | 'getAssetManifest'
  | 'getSession'
  | 'renameAsset'
  | 'reorderAssets'
  | 'reportAssetSyncError'
  | 'trashAsset'
  | 'uploadAssets'
>;

interface JoinedAssetSessionEvents {
  onError: (event: AssetErrorEvent) => void;
  onFatalFailure: (message: string) => void;
  onProgress: (event: AssetProgressEvent) => void;
  onChanged: (event: AssetChangedEvent) => void;
}

interface JoinedAssetSessionOptions {
  cacheRoot: string;
  client: AssetClient;
  events: JoinedAssetSessionEvents;
  historyRepository: ConnectionHistoryRepository;
}

/** Owns remote asset permissions, cache state, and synchronization. */
export class JoinedAssetSession {
  private readonly cacheRoot: string;
  private readonly caches = new Map<string, RemoteAssetCache>();
  private readonly client: AssetClient;
  private readonly events: JoinedAssetSessionEvents;
  private readonly historyRepository: ConnectionHistoryRepository;
  private manifest: AssetManifest | null = null;
  private campaignCapabilities: AssetCapability | null = null;
  private permissions = new Map<string, AssetCapability>();
  private synchronization: Promise<void> | null = null;

  constructor({
    cacheRoot,
    client,
    events,
    historyRepository,
  }: JoinedAssetSessionOptions) {
    this.cacheRoot = cacheRoot;
    this.client = client;
    this.events = events;
    this.historyRepository = historyRepository;
  }

  createTransport(campaignId: string, userId: string): JoinedAssetTransport {
    return {
      actor: { id: userId, role: 'player' },
      getPreviewPath: (assetId) => this.getPreviewPath(campaignId, assetId),
      importFiles: (sourcePaths, onProgress) =>
        this.importFiles(campaignId, sourcePaths, onProgress),
      list: () => this.list(campaignId),
      prepare: (onProgress) => this.prepare(campaignId, onProgress),
      rename: (input) => this.rename(input),
      reorder: (input) => this.reorder(campaignId, input),
      trash: (input) => this.client.trashAsset(input),
    };
  }

  handleManifest(snapshot: AssetNetworkSnapshot): void {
    void this.synchronize(snapshot, true);
  }

  reset(): void {
    this.manifest = null;
    this.campaignCapabilities = null;
    this.permissions.clear();
  }

  async clearCachedCampaign(campaignId: string): Promise<void> {
    const cache = this.caches.get(campaignId);
    this.caches.delete(campaignId);
    if (cache) {
      await cache.clear();
      return;
    }
    await rm(path.join(this.cacheRoot, campaignId), {
      force: true,
      recursive: true,
    });
  }

  private actor(campaignId: string): AssetActor | null {
    const session = this.client.getSession();
    return session?.campaignId === campaignId
      ? { id: session.userId, role: 'player' }
      : null;
  }

  private async list(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const actor = this.actor(campaignId);
    if (!actor) {
      return this.unavailable();
    }
    const cache = this.cache(campaignId);
    const manifest = this.manifest ?? (await cache.getManifest());
    return {
      ok: true,
      value: await Promise.all(
        manifest.assets.map(async (record) => {
          const available = (await cache.getAssetPath(record)) !== null;
          return {
            ...record,
            available,
            capabilities:
              this.permissions.get(record.id) ??
              this.campaignCapabilities ??
              getAssetCapabilities(
                authenticatedAssetPolicy,
                actor,
                record,
              ),
            syncState: available ? ('ready' as const) : ('syncing' as const),
          };
        }),
      ),
    };
  }

  private async prepare(
    campaignId: string,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.actor(campaignId)) {
      return this.unavailable();
    }
    const manifestResult = await this.client.getAssetManifest();
    if (!manifestResult.ok) {
      await this.disconnectForFailure(
        campaignId,
        manifestResult.error.message,
        manifestResult.error.assetId,
      );
      return manifestResult;
    }
    try {
      await this.synchronize(manifestResult.value, false, onProgress);
      return this.list(campaignId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Campaign assets could not be synchronized.';
      await this.disconnectForFailure(
        campaignId,
        message,
        error instanceof AssetCacheSyncError ? error.assetId : undefined,
      );
      return { error: { code: 'sync_error', message }, ok: false };
    }
  }

  private async getPreviewPath(
    campaignId: string,
    assetId: string,
  ): Promise<string | null> {
    const cache = this.cache(campaignId);
    const asset = (await cache.getManifest()).assets.find(
      (candidate) => candidate.id === assetId,
    );
    return asset ? cache.getAssetPath(asset) : null;
  }

  private async importFiles(
    campaignId: string,
    sourcePaths: string[],
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.actor(campaignId)) {
      return this.unavailable();
    }
    const uploaded = await this.client.uploadAssets(sourcePaths, onProgress);
    return uploaded.ok
      ? this.prepare(campaignId, onProgress)
      : uploaded;
  }

  /*
   * The host answers with a revision only, so the reordered list comes back
   * through the manifest broadcast rather than this response; re-listing here
   * gives the caller the order the host actually committed.
   */
  private async reorder(
    campaignId: string,
    input: ReorderAssetsInput,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.actor(campaignId)) {
      return {
        error: {
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const result = await this.client.reorderAssets({
      kind: input.kind,
      orderedAssetIds: input.orderedAssetIds,
    });
    return result.ok ? this.list(campaignId) : result;
  }

  private async rename(input: RenameAssetInput): Promise<AssetResult<AssetView>> {
    const actor = this.actor(input.campaignId);
    if (!actor) {
      return {
        error: {
          assetId: input.assetId,
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const result = await this.client.renameAsset(input);
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      value: {
        ...result.value,
        available: true,
        capabilities:
          this.permissions.get(result.value.id) ??
          this.campaignCapabilities ??
          getAssetCapabilities(
            authenticatedAssetPolicy,
            actor,
            result.value,
          ),
        syncState: 'ready',
      },
    };
  }

  private unavailable<T>(): AssetResult<T> {
    return {
      error: {
        code: 'sync_error',
        message: 'The remote campaign connection is not active.',
      },
      ok: false,
    };
  }

  private cache(campaignId: string): RemoteAssetCache {
    let cache = this.caches.get(campaignId);
    if (!cache) {
      cache = new RemoteAssetCache(
        this.historyRepository.applicationDatabase,
        this.cacheRoot,
        campaignId,
      );
      this.caches.set(campaignId, cache);
    }
    return cache;
  }

  private async synchronize(
    snapshot: AssetNetworkSnapshot,
    background: boolean,
    onProgress: (event: AssetProgressEvent) => void = this.events.onProgress,
  ): Promise<void> {
    const session = this.client.getSession();
    if (!session) {
      return;
    }
    const manifest = snapshot.manifest;
    this.manifest = manifest;
    this.campaignCapabilities = snapshot.campaignCapabilities;
    this.permissions = new Map(
      snapshot.permissions.map((entry) => [
        entry.assetId,
        entry.capabilities,
      ]),
    );
    if (background) {
      const cache = this.cache(session.campaignId);
      const announced = await Promise.all(
        manifest.assets.map(async (record) => {
          const available = (await cache.getAssetPath(record)) !== null;
          return {
            ...record,
            available,
            capabilities:
              this.permissions.get(record.id) ?? snapshot.campaignCapabilities,
            syncState: available ? ('ready' as const) : ('syncing' as const),
          };
        }),
      );
      this.events.onChanged({
        assets: announced,
        campaignId: session.campaignId,
        revision: manifest.revision,
      });
    }
    const run = async () => {
      const cache = this.cache(session.campaignId);
      await cache.synchronize(
        manifest,
        async (asset, index) => {
          const chunk = await this.client.getAssetChunk(asset, index);
          if (!chunk.ok) {
            throw new Error(chunk.error.message);
          }
          return chunk.value;
        },
        (event) => {
          onProgress(event);
          this.events.onProgress(event);
        },
      );
      const listed = await this.list(session.campaignId);
      if (listed.ok) {
        this.events.onChanged({
          assets: listed.value,
          campaignId: session.campaignId,
          revision: manifest.revision,
        });
      }
    };
    const previous = this.synchronization ?? Promise.resolve();
    const operation = previous.then(run);
    const queued = operation.finally(() => {
      if (this.synchronization === queued) {
        this.synchronization = null;
      }
    });
    this.synchronization = queued;
    try {
      await queued;
    } catch (error) {
      if (background) {
        const message =
          error instanceof Error
            ? error.message
            : 'A background asset could not be synchronized.';
        await this.disconnectForFailure(
          session.campaignId,
          message,
          error instanceof AssetCacheSyncError ? error.assetId : undefined,
        );
      }
      throw error;
    }
  }

  private async disconnectForFailure(
    campaignId: string,
    message: string,
    assetId?: string,
  ): Promise<void> {
    const cache = this.cache(campaignId);
    const manifest = this.manifest ?? (await cache.getManifest());
    const assetName =
      manifest.assets.find((asset) => asset.id === assetId)?.displayName ??
      'campaign asset';
    this.client.reportAssetSyncError(assetName, message, assetId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await this.client.disconnect();
    this.reset();
    this.events.onError({
      assetId,
      campaignId,
      code: 'sync_error',
      message,
      title: 'Campaign asset synchronization failed',
    });
    this.events.onFatalFailure(message);
  }
}
