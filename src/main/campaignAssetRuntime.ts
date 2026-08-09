import type {
  AssetAccessLevel,
  AssetActor,
  AssetProgressEvent,
  AssetRecord,
  AssetResult,
  AssetView,
  RenameAssetInput,
  ReorderAssetsInput,
  TrashAssetInput,
  UpdateAssetPermissionsInput,
} from '../shared/assets';
import type {
  PermissionConfiguration,
  PermissionSubject,
} from '../shared/permissions';
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
  listUsers(policy: AssetPolicy): Promise<AssetResult<PermissionSubject[]>>;
  updatePermissions(
    input: Omit<UpdateAssetPermissionsInput, 'campaignId'>,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView>>;
}

function failure<T>(
  code: 'not_found' | 'permission_denied' | 'storage_error',
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

  /* Joining a campaign means playing in it. Granting access is the Game
     Master's, and the Game Master is the host. */
  async listUsers(): Promise<AssetResult<PermissionSubject[]>> {
    return failure('permission_denied', 'Only the Game Master can manage asset access.');
  }

  async updatePermissions(): Promise<AssetRuntimeMutation<AssetView>> {
    return {
      changed: null,
      releasePreviews: false,
      result: failure('permission_denied', 'Only the Game Master can manage asset access.'),
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
      const states = this.workspace.assetRepository.permissionStates();
      return {
        ok: true,
        value: entries.map(({ available, record }) =>
          this.toView(record, policy, available, states.get(record.id)),
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

  async listUsers(policy: AssetPolicy): Promise<AssetResult<PermissionSubject[]>> {
    if (!policy.authorize({ action: 'managePermissions', subject: this.actor })) {
      return failure('permission_denied', 'Only the Game Master can manage asset access.');
    }
    return { ok: true, value: this.workspace.assetRepository.listUsers() };
  }

  async updatePermissions(
    input: Omit<UpdateAssetPermissionsInput, 'campaignId'>,
    policy: AssetPolicy,
  ): Promise<AssetRuntimeMutation<AssetView>> {
    if (!policy.authorize({ action: 'managePermissions', subject: this.actor })) {
      return {
        changed: null,
        releasePreviews: false,
        result: failure(
          'permission_denied',
          'Only the Game Master can manage asset access.',
          input.assetId,
        ),
      };
    }
    const written = await this.workspace.assetRepository.updatePermissions(input);
    if (!written.ok) {
      return { changed: null, releasePreviews: false, result: written };
    }
    const listed = await this.list(policy);
    if (!listed.ok) {
      return { changed: null, releasePreviews: false, result: listed };
    }
    const updated = listed.value.find(({ id }) => id === input.assetId);
    return {
      changed: listed.value,
      releasePreviews: false,
      result: updated
        ? { ok: true, value: updated }
        : failure('not_found', 'That asset no longer exists.', input.assetId),
    };
  }

  private toView(
    record: AssetRecord,
    policy: AssetPolicy,
    available: boolean,
    state?: {
      permissionRevision: number;
      permissions: PermissionConfiguration<AssetAccessLevel>;
    },
  ): AssetView {
    return {
      ...record,
      available,
      capabilities: getAssetCapabilities(
        policy,
        this.actor,
        record,
        state?.permissions.allPlayers,
      ),
      permissionRevision: state?.permissionRevision ?? 0,
      /* Only the Game Master edits access, and only the Game Master is ever
         local, so the configuration travels no further than this process. */
      permissions: this.actor.role === 'gm'
        ? state?.permissions ?? { allPlayers: 'none', overrides: [] }
        : null,
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
