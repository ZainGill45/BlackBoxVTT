import { EventEmitter } from 'node:events';
import { dialog, type BrowserWindow } from 'electron';
import { authenticatedAssetPolicy, type AssetPolicy } from './assetPolicy';
import type { AssetPreviewRegistry } from './assetPreviewRegistry';
import type { CampaignRuntimeRegistry } from './campaignRuntime';
import { fail } from '../shared/result';
import type {
  AssetActor,
  AssetChangedEvent,
  AssetErrorEvent,
  AssetPreview,
  AssetProgressEvent,
  AssetResult,
  AssetView,
  RenameAssetInput,
  TrashAssetInput,
} from '../shared/assets';

interface AssetManagerOptions {
  getWindow: () => BrowserWindow | null;
  policy?: AssetPolicy;
  previewRegistry: AssetPreviewRegistry;
  runtimes: CampaignRuntimeRegistry;
}

function failure<T>(
  code: 'not_found' | 'permission_denied' | 'storage_error' | 'unavailable',
  message: string,
  assetId?: string,
): AssetResult<T> {
  return fail({ assetId, code, message });
}

export class AssetManager extends EventEmitter {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly policy: AssetPolicy;
  private readonly previewRegistry: AssetPreviewRegistry;
  private readonly reportedUnavailable = new Set<string>();
  private readonly runtimes: CampaignRuntimeRegistry;

  constructor({
    getWindow,
    policy = authenticatedAssetPolicy,
    previewRegistry,
    runtimes,
  }: AssetManagerOptions) {
    super();
    this.getWindow = getWindow;
    this.policy = policy;
    this.previewRegistry = previewRegistry;
    this.runtimes = runtimes;
  }

  async list(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    const result = await runtime.assets.list(this.policy);
    if (!result.ok) {
      return result;
    }
    const broken = result.value.find((asset) => !asset.available);
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
    for (const asset of result.value) {
      if (asset.available) {
        this.reportedUnavailable.delete(`${campaignId}:${asset.id}`);
      }
    }
    return result;
  }

  async pickAndImport(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    const actor =
      runtime?.assets.actor ??
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
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    const outcome = await runtime.assets.importFiles(
      filePaths,
      this.policy,
      (event) => this.emitProgress(event),
    );
    if (outcome.changed) {
      this.emitChanged(campaignId, outcome.changed);
      this.emitProgress({
        completedBytes: 1,
        phase: 'importing',
        scope: 'import',
        totalBytes: 1,
      });
    }
    return outcome.result;
  }

  async rename(input: RenameAssetInput): Promise<AssetResult<AssetView>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.', input.assetId);
    }
    const outcome = await runtime.assets.rename(input, this.policy);
    if (outcome.changed) {
      this.emitChanged(input.campaignId, outcome.changed);
    }
    return outcome.result;
  }

  async trash(input: TrashAssetInput): Promise<AssetResult<null>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.', input.assetId);
    }
    const outcome = await runtime.assets.trash(input, this.policy);
    if (outcome.releasePreviews) {
      this.previewRegistry.releaseCampaign(input.campaignId);
    }
    if (outcome.changed) {
      this.emitChanged(input.campaignId, outcome.changed);
    }
    return outcome.result;
  }

  async prepareRemote(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    return runtime.assets.prepare(
      this.policy,
      (event) => this.emitProgress(event),
    );
  }

  async getPreview(
    campaignId: string,
    assetId: string,
  ): Promise<AssetResult<AssetPreview>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.', assetId);
    }
    const actor = runtime.assets.actor;
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
    const filePath = await runtime.assets.getPreviewPath(asset);
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
