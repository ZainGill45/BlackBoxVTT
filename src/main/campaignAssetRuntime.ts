import type {
  AssetActor,
  AssetProgressEvent,
  AssetRecord,
  AssetResult,
  AssetView,
  RenameAssetInput,
  ReorderAssetsInput,
  TrashAssetInput,
} from '../shared/assets';
import {
  getAssetCapabilities,
  type AssetPolicy,
} from './assetPolicy';
import type { LocalCampaignWorkspace } from './campaignWorkspace';

export interface JoinedAssetTransport {
  readonly actor: AssetActor;
  getPreviewPath(assetId: string): Promise<string | null>;
  importFiles(
    sourcePaths: string[],
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>>;
  list(): Promise<AssetResult<AssetView[]>>;
  prepare(
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>>;
  rename(input: RenameAssetInput): Promise<AssetResult<AssetView>>;
  reorder(input: ReorderAssetsInput): Promise<AssetResult<AssetView[]>>;
  trash(input: TrashAssetInput): Promise<AssetResult<null>>;
}

export interface AssetRuntimeMutation<T> {
  changed: AssetView[] | null;
  releasePreviews: boolean;
  result: AssetResult<T>;
}

export interface CampaignAssetRuntime {
  readonly actor: AssetActor;
  getPreviewPath(asset: AssetView): Promise<string | null>;
  importFiles(
    sourcePaths: string[],
    policy: AssetPolicy,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetRuntimeMutation<AssetView[]>>;
  list(policy: AssetPolicy): Promise<AssetResult<AssetView[]>>;
  prepare(
    policy: AssetPolicy,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>>;
  rename(
    input: RenameAssetInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView>>;
  reorder(
    input: ReorderAssetsInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView[]>>;
  trash(
    input: TrashAssetInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<null>>;
}

function failure<T>(
  code: 'permission_denied' | 'storage_error',
  message: string,
  assetId?: string,
): AssetResult<T> {
  return { error: { assetId, code, message }, ok: false };
}

class JoinedAssetRuntime implements CampaignAssetRuntime {
  readonly actor: AssetActor;

  constructor(private readonly transport: JoinedAssetTransport) {
    this.actor = transport.actor;
  }

  getPreviewPath(asset: AssetView): Promise<string | null> {
    return this.transport.getPreviewPath(asset.id);
  }

  async importFiles(
    sourcePaths: string[],
    _policy: AssetPolicy,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetRuntimeMutation<AssetView[]>> {
    return {
      changed: null,
      releasePreviews: false,
      result: await this.transport.importFiles(sourcePaths, onProgress),
    };
  }

  list(): Promise<AssetResult<AssetView[]>> {
    return this.transport.list();
  }

  prepare(
    _policy: AssetPolicy,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>> {
    return this.transport.prepare(onProgress);
  }

  async rename(
    input: RenameAssetInput,
  ): Promise<AssetRuntimeMutation<AssetView>> {
    return {
      changed: null,
      releasePreviews: false,
      result: await this.transport.rename(input),
    };
  }

  async reorder(
    input: ReorderAssetsInput,
  ): Promise<AssetRuntimeMutation<AssetView[]>> {
    return {
      changed: null,
      releasePreviews: false,
      result: await this.transport.reorder(input),
    };
  }

  async trash(
    input: TrashAssetInput,
  ): Promise<AssetRuntimeMutation<null>> {
    return {
      changed: null,
      releasePreviews: false,
      result: await this.transport.trash(input),
    };
  }
}

class LocalAssetRuntime implements CampaignAssetRuntime {
  readonly actor: AssetActor;

  constructor(private readonly workspace: LocalCampaignWorkspace) {
    this.actor = {
      id: `gm:${workspace.manifest.id}`,
      role: 'gm',
    };
  }

  async getPreviewPath(asset: AssetView): Promise<string | null> {
    return this.workspace.assetRepository.resolveAssetPath(asset);
  }

  async importFiles(
    sourcePaths: string[],
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView[]>> {
    const result = await this.workspace.assetRepository.importFiles(
      sourcePaths,
      this.actor,
    );
    if (!result.ok) {
      return { changed: null, releasePreviews: false, result };
    }
    const listed = await this.list(policy);
    return {
      changed: listed.ok ? listed.value : null,
      releasePreviews: false,
      result: listed,
    };
  }

  async list(policy: AssetPolicy): Promise<AssetResult<AssetView[]>> {
    if (!policy.authorize({ action: 'list', subject: this.actor })) {
      return failure(
        'permission_denied',
        'You cannot view campaign assets.',
      );
    }
    try {
      const entries = await this.workspace.assetRepository.list();
      return {
        ok: true,
        value: entries.map(({ available, record }) =>
          this.toView(record, policy, available),
        ),
      };
    } catch {
      return failure(
        'storage_error',
        'Campaign assets could not be loaded.',
      );
    }
  }

  prepare(policy: AssetPolicy): Promise<AssetResult<AssetView[]>> {
    return this.list(policy);
  }

  async rename(
    input: RenameAssetInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView>> {
    const repository = this.workspace.assetRepository;
    const current = (await repository.readManifest()).assets.find(
      (asset) => asset.id === input.assetId,
    );
    if (
      !policy.authorize({
        action: 'rename',
        asset: current,
        subject: this.actor,
      })
    ) {
      return {
        changed: null,
        releasePreviews: false,
        result: failure(
          'permission_denied',
          'You cannot rename this asset.',
          input.assetId,
        ),
      };
    }
    const result = await repository.renameAsset(
      input.assetId,
      input.displayName,
      input.expectedRevision,
      this.actor,
    );
    if (!result.ok) {
      return { changed: null, releasePreviews: false, result };
    }
    const listed = await this.list(policy);
    return {
      changed: listed.ok ? listed.value : null,
      releasePreviews: false,
      result: {
        ok: true,
        value: this.toView(result.value, policy, true),
      },
    };
  }

  async reorder(
    input: ReorderAssetsInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView[]>> {
    /* No asset argument: ordering is a property of the list, so it is
       authorized on the actor alone. */
    if (!policy.authorize({ action: 'reorder', subject: this.actor })) {
      return {
        changed: null,
        releasePreviews: false,
        result: failure(
          'permission_denied',
          'You cannot reorder campaign assets.',
        ),
      };
    }
    const result = await this.workspace.assetRepository.reorderAssets(
      input.kind,
      input.orderedAssetIds,
    );
    if (!result.ok) {
      return { changed: null, releasePreviews: false, result };
    }
    const listed = await this.list(policy);
    return {
      changed: listed.ok ? listed.value : null,
      releasePreviews: false,
      result: listed,
    };
  }

  async trash(
    input: TrashAssetInput,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<null>> {
    const repository = this.workspace.assetRepository;
    const current = (await repository.readManifest()).assets.find(
      (asset) => asset.id === input.assetId,
    );
    if (
      !policy.authorize({
        action: 'delete',
        asset: current,
        subject: this.actor,
      })
    ) {
      return {
        changed: null,
        releasePreviews: false,
        result: failure(
          'permission_denied',
          'You cannot delete this asset.',
          input.assetId,
        ),
      };
    }
    const result = await repository.trashAsset(
      input.assetId,
      input.expectedRevision,
    );
    if (!result.ok) {
      return { changed: null, releasePreviews: false, result };
    }
    const listed = await this.list(policy);
    return {
      changed: listed.ok ? listed.value : null,
      releasePreviews: true,
      result,
    };
  }

  private toView(
    record: AssetRecord,
    policy: AssetPolicy,
    available: boolean,
  ): AssetView {
    return {
      ...record,
      available,
      capabilities: getAssetCapabilities(policy, this.actor, record),
      syncState: available ? 'ready' : 'unavailable',
    };
  }
}

export function createJoinedAssetRuntime(
  transport: JoinedAssetTransport,
): CampaignAssetRuntime {
  return new JoinedAssetRuntime(transport);
}

export function createLocalAssetRuntime(
  workspace: LocalCampaignWorkspace,
): CampaignAssetRuntime {
  return new LocalAssetRuntime(workspace);
}
