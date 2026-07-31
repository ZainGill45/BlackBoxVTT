import { EventEmitter } from 'node:events';
import { dialog, type BrowserWindow } from 'electron';
import {
  authenticatedAssetPolicy,
  getAssetCapabilities,
  type AssetPolicy,
} from './assetPolicy';
import { AssetRepository } from './assetRepository';
import type { AssetPreviewRegistry } from './assetPreviewRegistry';
import type { CampaignRepository } from './campaignRepository';
import { fail } from '../shared/result';
import type {
  AssetActor,
  AssetChangedEvent,
  AssetErrorEvent,
  AssetPreview,
  AssetProgressEvent,
  AssetRecord,
  AssetResult,
  AssetView,
  RenameAssetInput,
  TrashAssetInput,
} from '../shared/assets';

interface RemoteAssetBridge {
  getActor(campaignId: string): AssetActor | null;
  getPreviewPath(campaignId: string, assetId: string): Promise<string | null>;
  importFiles(
    campaignId: string,
    sourcePaths: string[],
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>>;
  list(campaignId: string): Promise<AssetResult<AssetView[]>>;
  prepare(
    campaignId: string,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>>;
  rename(input: RenameAssetInput): Promise<AssetResult<AssetView>>;
  trash(input: TrashAssetInput): Promise<AssetResult<null>>;
}

interface AssetManagerOptions {
  campaignRepository: CampaignRepository;
  getWindow: () => BrowserWindow | null;
  policy?: AssetPolicy;
  previewRegistry: AssetPreviewRegistry;
  remoteBridge: RemoteAssetBridge;
  trashItem: (targetPath: string) => Promise<void>;
}

function failure<T>(
  code: 'not_found' | 'permission_denied' | 'storage_error' | 'unavailable',
  message: string,
  assetId?: string,
): AssetResult<T> {
  return fail({ assetId, code, message });
}

export class AssetManager extends EventEmitter {
  private readonly campaignRepository: CampaignRepository;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly policy: AssetPolicy;
  private readonly previewRegistry: AssetPreviewRegistry;
  private readonly reportedUnavailable = new Set<string>();
  private readonly remoteBridge: RemoteAssetBridge;
  private readonly repositories = new Map<string, AssetRepository>();
  private readonly trashItem: (targetPath: string) => Promise<void>;

  constructor({
    campaignRepository,
    getWindow,
    policy = authenticatedAssetPolicy,
    previewRegistry,
    remoteBridge,
    trashItem,
  }: AssetManagerOptions) {
    super();
    this.campaignRepository = campaignRepository;
    this.getWindow = getWindow;
    this.policy = policy;
    this.previewRegistry = previewRegistry;
    this.remoteBridge = remoteBridge;
    this.trashItem = trashItem;
  }

  async list(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const remoteActor = this.remoteBridge.getActor(campaignId);
    if (remoteActor) {
      return this.remoteBridge.list(campaignId);
    }
    const local = await this.getLocalContext(campaignId);
    if (!local) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    if (!this.policy.authorize({ action: 'list', subject: local.actor })) {
      return failure('permission_denied', 'You cannot view campaign assets.');
    }
    try {
      const entries = await local.repository.list();
      const assets = entries.map(({ available, record }) =>
        this.toView(record, local.actor, available),
      );
      const broken = assets.find((asset) => !asset.available);
      if (
        broken &&
        !this.reportedUnavailable.has(`${campaignId}:${broken.id}`)
      ) {
        this.reportedUnavailable.add(`${campaignId}:${broken.id}`);
        this.emit('error', {
          assetId: broken.id,
          campaignId,
          code: 'unavailable',
          message: `${broken.displayName} is missing or has changed on disk. Repair or delete the asset.`,
          title: 'Campaign asset unavailable',
        } satisfies AssetErrorEvent);
      }
      for (const asset of assets) {
        if (asset.available) {
          this.reportedUnavailable.delete(`${campaignId}:${asset.id}`);
        }
      }
      return { ok: true, value: assets };
    } catch {
      return failure('storage_error', 'Campaign assets could not be loaded.');
    }
  }

  async pickAndImport(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const actor =
      this.remoteBridge.getActor(campaignId) ??
      ({ id: `gm:${campaignId}`, role: 'gm' } satisfies AssetActor);
    if (!this.policy.authorize({ action: 'import', subject: actor })) {
      return failure('permission_denied', 'You cannot add campaign assets.');
    }
    const window = this.getWindow();
    if (!window) {
      return failure('storage_error', 'The file picker is unavailable.');
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      filters: [
        {
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'mp3',
            'wav',
            'ogg',
            'm4a',
            'pdf',
            'txt',
            'md',
          ],
          name: 'Campaign assets',
        },
      ],
      properties: ['openFile', 'multiSelections'],
      title: 'Add campaign assets',
    });
    if (canceled || filePaths.length === 0) {
      return { ok: true, value: [] };
    }

    this.emitProgress({
      completedBytes: 0,
      currentName: filePaths[0]?.split(/[\\/]/).pop(),
      phase: 'importing',
      scope: 'import',
      totalBytes: null,
    });
    const remote = this.remoteBridge.getActor(campaignId);
    if (remote) {
      return this.remoteBridge.importFiles(
        campaignId,
        filePaths,
        (event) => this.emitProgress(event),
      );
    }

    const local = await this.getLocalContext(campaignId);
    if (!local) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    const result = await local.repository.importFiles(filePaths, local.actor);
    if (!result.ok) {
      return result;
    }
    const listed = await this.list(campaignId);
    if (listed.ok) {
      this.emitChanged(campaignId, listed.value);
      this.emitProgress({
        completedBytes: 1,
        phase: 'importing',
        scope: 'import',
        totalBytes: 1,
      });
    }
    return listed;
  }

  async rename(input: RenameAssetInput): Promise<AssetResult<AssetView>> {
    const remote = this.remoteBridge.getActor(input.campaignId);
    if (remote) {
      return this.remoteBridge.rename(input);
    }
    const local = await this.getLocalContext(input.campaignId);
    if (!local) {
      return failure('not_found', 'Campaign storage is unavailable.', input.assetId);
    }
    const current = (await local.repository.readManifest()).assets.find(
      (asset) => asset.id === input.assetId,
    );
    if (
      !this.policy.authorize({
        action: 'rename',
        asset: current,
        subject: local.actor,
      })
    ) {
      return failure('permission_denied', 'You cannot rename this asset.', input.assetId);
    }
    const result = await local.repository.renameAsset(
      input.assetId,
      input.displayName,
      input.expectedRevision,
      local.actor,
    );
    if (!result.ok) {
      return result;
    }
    const view = this.toView(result.value, local.actor, true);
    const listed = await this.list(input.campaignId);
    if (listed.ok) {
      this.emitChanged(input.campaignId, listed.value);
    }
    return { ok: true, value: view };
  }

  async trash(input: TrashAssetInput): Promise<AssetResult<null>> {
    const remote = this.remoteBridge.getActor(input.campaignId);
    if (remote) {
      return this.remoteBridge.trash(input);
    }
    const local = await this.getLocalContext(input.campaignId);
    if (!local) {
      return failure('not_found', 'Campaign storage is unavailable.', input.assetId);
    }
    const current = (await local.repository.readManifest()).assets.find(
      (asset) => asset.id === input.assetId,
    );
    if (
      !this.policy.authorize({
        action: 'delete',
        asset: current,
        subject: local.actor,
      })
    ) {
      return failure('permission_denied', 'You cannot delete this asset.', input.assetId);
    }
    const result = await local.repository.trashAsset(
      input.assetId,
      input.expectedRevision,
    );
    if (result.ok) {
      this.previewRegistry.releaseCampaign(input.campaignId);
      const listed = await this.list(input.campaignId);
      if (listed.ok) {
        this.emitChanged(input.campaignId, listed.value);
      }
    }
    return result;
  }

  async prepareRemote(campaignId: string): Promise<AssetResult<AssetView[]>> {
    if (!this.remoteBridge.getActor(campaignId)) {
      return this.list(campaignId);
    }
    return this.remoteBridge.prepare(campaignId, (event) =>
      this.emitProgress(event),
    );
  }

  async getPreview(
    campaignId: string,
    assetId: string,
  ): Promise<AssetResult<AssetPreview>> {
    const actor =
      this.remoteBridge.getActor(campaignId) ??
      ({ id: `gm:${campaignId}`, role: 'gm' } satisfies AssetActor);
    const list = await this.list(campaignId);
    if (!list.ok) {
      return list;
    }
    const asset = list.value.find((candidate) => candidate.id === assetId);
    if (!asset) {
      return failure('not_found', 'The asset no longer exists.', assetId);
    }
    if (
      !asset.capabilities.preview ||
      !this.policy.authorize({ action: 'preview', asset, subject: actor })
    ) {
      return failure('permission_denied', 'You cannot preview this asset.', assetId);
    }
    if (!asset.available) {
      return failure('unavailable', 'The asset is not ready to preview.', assetId);
    }
    const local = await this.getLocalContext(campaignId);
    const filePath = local
      ? local.repository.resolveAssetPath(asset)
      : await this.remoteBridge.getPreviewPath(campaignId, assetId);
    if (!filePath) {
      return failure('unavailable', 'The asset is not ready to preview.', assetId);
    }
    const token = this.previewRegistry.create({
      assetId,
      campaignId,
      filePath,
      mimeType: asset.mimeType,
    });
    return {
      ok: true,
      value: {
        assetId,
        displayName: asset.displayName,
        format: asset.format,
        kind: asset.kind,
        mimeType: asset.mimeType,
        token,
        url: `blackbox-asset://${token}/${assetId}`,
      },
    };
  }

  releasePreview(token: string): void {
    this.previewRegistry.release(token);
  }

  async getLocalRepository(
    campaignId: string,
  ): Promise<AssetRepository | null> {
    return (await this.getLocalContext(campaignId))?.repository ?? null;
  }

  private async getLocalContext(campaignId: string) {
    const container = await this.campaignRepository.getContainer(campaignId);
    if (!container) {
      return null;
    }
    let repository = this.repositories.get(campaignId);
    if (!repository) {
      repository = new AssetRepository({
        campaignDirectory: container.directory,
        touchCampaign: async () => {
          const result = await this.campaignRepository.touch(campaignId);
          if (!result.ok) {
            throw new Error(result.error.message);
          }
        },
        trashItem: this.trashItem,
      });
      this.repositories.set(campaignId, repository);
    }
    return {
      actor: { id: `gm:${campaignId}`, role: 'gm' } as AssetActor,
      repository,
    };
  }

  private toView(
    record: AssetRecord,
    actor: AssetActor,
    available: boolean,
  ): AssetView {
    return {
      ...record,
      available,
      capabilities: getAssetCapabilities(this.policy, actor, record),
      syncState: available ? 'ready' : 'unavailable',
    };
  }

  private emitChanged(campaignId: string, assets: AssetView[]): void {
    this.emit('changed', {
      assets,
      campaignId,
      revision: Math.max(0, ...assets.map((asset) => asset.revision)),
    } satisfies AssetChangedEvent);
  }

  private emitProgress(event: AssetProgressEvent): void {
    this.emit('progress', event);
  }
}
