import { EventEmitter } from 'node:events';
import { dialog, type BrowserWindow } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  PreparedAssetPreviews,
  AssetResult,
  AssetView,
  ImportImageBytesInput,
  RenameAssetInput,
  ReorderAssetsInput,
  TrashAssetInput,
  UpdateAssetPermissionsInput,
} from '../shared/assets';
import { MAX_EMBEDDED_IMAGE_BYTES } from '../shared/assets';
import type { PermissionSubject } from '../shared/permissions';

interface AssetManagerOptions {
  getWindow: () => BrowserWindow | null;
  policy?: AssetPolicy;
  previewRegistry: AssetPreviewRegistry;
  runtimes: CampaignRuntimeRegistry;
}

function failure<T>(
  code: 'invalid_input' | 'not_found' | 'permission_denied' | 'storage_error' | 'unavailable',
  message: string,
  assetId?: string,
): AssetResult<T> {
  return fail({ assetId, code, message });
}

const ASSET_PREPARATION_INACTIVITY_MS = 30_000;

async function settleAssetPreparation<T>(
  operation: Promise<T>,
  onLate: (value: T) => void,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let active = true;
    const timer = setTimeout(() => {
      active = false;
      resolve(undefined);
    }, ASSET_PREPARATION_INACTIVITY_MS);
    void operation.then(
      (value) => {
        if (!active) {
          onLate(value);
          return;
        }
        active = false;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

export class AssetManager extends EventEmitter {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly policy: AssetPolicy;
  private readonly previewRegistry: AssetPreviewRegistry;
  private readonly previewRuntimes = new Map<string, object>();
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

  async pickImages(campaignId: string): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    const actor = runtime?.assets.actor ?? { id: `gm:${campaignId}`, role: 'gm' as const };
    if (!this.policy.authorize({ action: 'import', subject: actor })) {
      return failure('permission_denied', 'You cannot add campaign images.');
    }
    const window = this.getWindow();
    if (!window || !runtime) return failure('storage_error', 'The image picker is unavailable.');
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      filters: [{ extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'], name: 'Images' }],
      properties: ['openFile', 'multiSelections'],
      title: 'Add images to Storage',
    });
    if (canceled || filePaths.length === 0) return { ok: true, value: [] };
    const outcome = await runtime.assets.importFiles(filePaths, this.policy, (event) => this.emitProgress(event));
    if (outcome.changed) this.emitChanged(campaignId, outcome.changed);
    return outcome.result;
  }

  async importImageBytes(input: ImportImageBytesInput): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime || !this.policy.authorize({ action: 'import', subject: runtime.assets.actor })) {
      return failure(runtime ? 'permission_denied' : 'not_found', runtime ? 'You cannot add campaign images.' : 'Campaign storage is unavailable.');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.bytesBase64, 'base64');
    } catch {
      return failure('invalid_input', 'The pasted image data is invalid.');
    }
    if (bytes.length === 0 || bytes.length > MAX_EMBEDDED_IMAGE_BYTES || !this.matchesImageSignature(bytes, input.mimeType)) {
      return failure('invalid_input', 'The pasted image is invalid or exceeds the 32 MiB limit.');
    }
    const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType.slice('image/'.length);
    const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-journal-image-'));
    const filename = `${path.parse(input.filename).name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 200) || 'Pasted Image'}.${extension}`;
    const filePath = path.join(directory, filename);
    try {
      await writeFile(filePath, bytes, { flag: 'wx' });
      const outcome = await runtime.assets.importFiles([filePath], this.policy, (event) => this.emitProgress(event));
      if (outcome.changed) this.emitChanged(input.campaignId, outcome.changed);
      return outcome.result;
    } finally {
      await rm(directory, { force: true, recursive: true }).catch(() => undefined);
    }
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

  async reorder(input: ReorderAssetsInput): Promise<AssetResult<AssetView[]>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    const outcome = await runtime.assets.reorder(input, this.policy);
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
      this.previewRegistry.releaseAsset(input.campaignId, input.assetId);
    }
    if (outcome.changed) {
      this.emitChanged(input.campaignId, outcome.changed);
    }
    return outcome.result;
  }

  async listUsers(campaignId: string): Promise<AssetResult<PermissionSubject[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    return runtime.assets.listUsers(this.policy);
  }

  async updatePermissions(
    input: UpdateAssetPermissionsInput,
  ): Promise<AssetResult<AssetView>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.', input.assetId);
    }
    const outcome = await runtime.assets.updatePermissions(input, this.policy);
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

  async preparePreviews(
    campaignId: string,
  ): Promise<AssetResult<PreparedAssetPreviews>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.');
    }
    this.adoptPreviewRuntime(campaignId, runtime);
    const listed = await settleAssetPreparation(
      runtime.assets.list(this.policy),
      () => undefined,
    );
    if (!listed) {
      return { ok: true, value: { failedAssetIds: [], previews: [] } };
    }
    if (!listed.ok) return listed;
    const assets = listed.value.filter((asset) => asset.capabilities.preview);
    const totalBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0);
    const sizes = new Map(assets.map((asset) => [asset.id, asset.sizeBytes]));
    const completedByAsset = new Map<string, number>();
    const previews: AssetPreview[] = [];
    const failedAssetIds: string[] = [];
    const queue = [...assets];
    const actor = runtime.assets.actor;
    const worker = async () => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        try {
          if (!asset.available) {
            failedAssetIds.push(asset.id);
            continue;
          }
          if (!this.policy.authorize({ action: 'preview', asset, subject: actor })) {
            failedAssetIds.push(asset.id);
            continue;
          }
          let acceptingProgress = true;
          const filePath = await settleAssetPreparation(
            runtime.assets.getPreviewPath(asset),
            () => undefined,
          );
          if (!filePath) {
            failedAssetIds.push(asset.id);
            continue;
          }
          const token = await this.previewRegistry.prepare(
            {
              assetId: asset.id,
              cacheKey: `${campaignId}:${asset.id}:${asset.sha256}`,
              campaignId,
              filePath,
              mimeType: asset.mimeType,
            },
            (completedBytes) => {
              if (!acceptingProgress) return;
              completedByAsset.set(asset.id, completedBytes);
              this.emitProgress({
                assetId: asset.id,
                campaignId,
                completedBytes: [...completedByAsset.values()].reduce(
                  (total, value) => total + value,
                  0,
                ),
                completedItems: [...completedByAsset].filter(
                  ([assetId, bytes]) =>
                    bytes >=
                    (sizes.get(assetId) ?? Number.POSITIVE_INFINITY),
                ).length,
                currentName: asset.displayName,
                phase: 'caching',
                scope: 'preload',
                totalBytes,
                totalItems: assets.length,
              });
            },
          );
          acceptingProgress = false;
          completedByAsset.set(asset.id, asset.sizeBytes);
          previews.push(this.preview(asset, token));
        } catch {
          failedAssetIds.push(asset.id);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return { ok: true, value: { failedAssetIds, previews } };
  }

  async getPreview(
    campaignId: string,
    assetId: string,
  ): Promise<AssetResult<AssetPreview>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) {
      return failure('not_found', 'Campaign storage is unavailable.', assetId);
    }
    this.adoptPreviewRuntime(campaignId, runtime);
    const actor = runtime.assets.actor;
    const list = await runtime.assets.list(this.policy);
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
      cacheKey: `${campaignId}:${asset.id}:${asset.sha256}`,
      campaignId,
      filePath,
      mimeType: asset.mimeType,
    });
    return {
      ok: true,
      value: this.preview(asset, token),
    };
  }

  releasePreview(token: string): void {
    this.previewRegistry.release(token);
  }

  releaseCampaign(campaignId: string): void {
    this.previewRuntimes.delete(campaignId);
    this.previewRegistry.releaseCampaign(campaignId);
  }

  notifyChanged(event: AssetChangedEvent): void {
    this.previewRegistry.reconcileCampaign(
      event.campaignId,
      event.assets.filter((asset) => asset.capabilities.preview),
    );
    this.emit('changed', event);
  }

  private emitChanged(campaignId: string, assets: AssetView[]): void {
    this.notifyChanged({
      assets,
      campaignId,
      revision: Math.max(0, ...assets.map((asset) => asset.revision)),
    });
  }

  private adoptPreviewRuntime(campaignId: string, runtime: object): void {
    const previous = this.previewRuntimes.get(campaignId);
    if (previous && previous !== runtime) {
      this.previewRegistry.releaseCampaign(campaignId);
    }
    this.previewRuntimes.set(campaignId, runtime);
  }

  private preview(asset: AssetView, token: string): AssetPreview {
    return {
      assetId: asset.id,
      displayName: asset.displayName,
      format: asset.format,
      kind: asset.kind,
      mimeType: asset.mimeType,
      token,
      url: `blackbox-asset://${token}/${asset.id}`,
    };
  }

  private emitProgress(event: AssetProgressEvent): void {
    this.emit('progress', event);
  }

  private matchesImageSignature(bytes: Buffer, mimeType: ImportImageBytesInput['mimeType']): boolean {
    if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
}
