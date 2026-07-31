import { EventEmitter } from 'node:events';
import {
  createEmptySceneManifest,
  type PresentSceneInput,
  type SceneAssetInput,
  type SceneChangedEvent,
  type SceneHistoryInput,
  type SceneManifest,
  type SetSceneObjectsInput,
  type SetSceneImagesInput,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
  type SceneRecord,
  type SceneResult,
  type TrashSceneInput,
  type UpdateSceneInput,
} from '../shared/scenes';
import type { CampaignRepository } from './campaignRepository';
import { SceneRepository } from './sceneRepository';

/**
 * A joined player holds no scene storage of its own: it only ever sees the
 * scene the host is presenting, delivered over TCP.
 */
interface RemoteSceneBridge {
  getActiveScene(campaignId: string): SceneRecord | null;
  isRemote(campaignId: string): boolean;
  redoSceneEdit(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  setRemoteSceneObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>>;
  startRemoteTransform(input: SceneTransformPreviewStart): Promise<void>;
  updateRemoteTransform(input: SceneTransformPreviewDelta): Promise<void>;
  cancelRemoteTransform(input: SceneTransformPreviewCancel): Promise<void>;
  undoSceneEdit(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
}

interface SceneManagerOptions {
  campaignRepository: CampaignRepository;
  remoteBridge: RemoteSceneBridge;
}

function readOnly<T>(): SceneResult<T> {
  return {
    error: {
      code: 'permission_denied',
      message: 'Only the game master can change scenes.',
    },
    ok: false,
  };
}

function unavailable<T>(): SceneResult<T> {
  return {
    error: {
      code: 'not_found',
      message: 'Campaign storage is unavailable.',
    },
    ok: false,
  };
}

export class SceneManager extends EventEmitter {
  private readonly campaignRepository: CampaignRepository;
  private readonly remoteBridge: RemoteSceneBridge;
  private readonly repositories = new Map<string, SceneRepository>();

  constructor({ campaignRepository, remoteBridge }: SceneManagerOptions) {
    super();
    this.campaignRepository = campaignRepository;
    this.remoteBridge = remoteBridge;
  }

  async list(campaignId: string): Promise<SceneResult<SceneManifest>> {
    if (this.remoteBridge.isRemote(campaignId)) {
      return { ok: true, value: this.remoteManifest(campaignId) };
    }
    const repository = await this.getLocalRepository(campaignId);
    return repository ? repository.list() : unavailable();
  }

  async create(campaignId: string): Promise<SceneResult<SceneRecord>> {
    return this.mutateLocal(campaignId, (repository) => repository.create());
  }

  async update(input: UpdateSceneInput): Promise<SceneResult<SceneRecord>> {
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.update(input.sceneId, input.patch, input.expectedRevision),
    );
  }

  async setImages(input: SetSceneImagesInput): Promise<SceneResult<SceneRecord>> {
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.setImages(input.sceneId, input.state, input.expectedRevision),
    );
  }

  async setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      return this.remoteBridge.setRemoteSceneObjects(input);
    }
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.setObjects(
        input.sceneId,
        input.state,
        input.expectedRevision,
        input.operationId,
        { kind: 'gm' },
      ),
    );
  }

  async undo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      return this.remoteBridge.undoSceneEdit(input);
    }
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.undo(input.sceneId, { kind: 'gm' }),
    );
  }

  async redo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      return this.remoteBridge.redoSceneEdit(input);
    }
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.redo(input.sceneId, { kind: 'gm' }),
    );
  }

  async previewStart(input: SceneTransformPreviewStart): Promise<void> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      await this.remoteBridge.startRemoteTransform(input);
      return;
    }
    const repository = await this.getLocalRepository(input.campaignId);
    const locked = await repository?.beginTransform(
      input.sceneId,
      input.operationId,
      input.targets,
      { kind: 'gm' },
    );
    if (locked?.ok) {
      this.emit('preview-start', input);
    }
  }

  async previewUpdate(input: SceneTransformPreviewDelta): Promise<void> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      await this.remoteBridge.updateRemoteTransform(input);
      return;
    }
    const repository = await this.getLocalRepository(input.campaignId);
    repository?.refreshTransform(input.operationId, { kind: 'gm' });
    this.emit('preview-update', input);
  }

  async previewCancel(input: SceneTransformPreviewCancel): Promise<void> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      await this.remoteBridge.cancelRemoteTransform(input);
      return;
    }
    const repository = await this.getLocalRepository(input.campaignId);
    repository?.cancelTransform(input.operationId, { kind: 'gm' });
    this.emit('preview-cancel', input);
  }

  async trash(input: TrashSceneInput): Promise<SceneResult<null>> {
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.trash(input.sceneId, input.expectedRevision),
    );
  }

  async present(input: PresentSceneInput): Promise<SceneResult<SceneManifest>> {
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.present(input.sceneId),
    );
  }

  async detachAsset(input: SceneAssetInput): Promise<SceneResult<null>> {
    return this.mutateLocal(input.campaignId, (repository) =>
      repository.detachAsset(input.assetId),
    );
  }

  async findDependents(
    input: SceneAssetInput,
  ): Promise<SceneResult<SceneRecord[]>> {
    if (this.remoteBridge.isRemote(input.campaignId)) {
      return { ok: true, value: [] };
    }
    const repository = await this.getLocalRepository(input.campaignId);
    return repository ? repository.findDependents(input.assetId) : unavailable();
  }

  async getLocalRepository(
    campaignId: string,
  ): Promise<SceneRepository | null> {
    if (this.remoteBridge.isRemote(campaignId)) {
      return null;
    }
    const cached = this.repositories.get(campaignId);
    if (cached) {
      return cached;
    }
    const container = await this.campaignRepository.getContainer(campaignId);
    if (!container) {
      return null;
    }
    const repository = new SceneRepository({
      campaignDirectory: container.directory,
      touchCampaign: async () => {
        await this.campaignRepository.touch(campaignId);
      },
    });
    this.repositories.set(campaignId, repository);
    return repository;
  }

  /** Re-reads and re-broadcasts the manifest, e.g. after a remote update. */
  async notifyChanged(campaignId: string): Promise<void> {
    const result = await this.list(campaignId);
    if (result.ok) {
      this.emitChanged(campaignId, result.value);
    }
  }

  private async mutateLocal<T>(
    campaignId: string,
    operation: (repository: SceneRepository) => Promise<SceneResult<T>>,
  ): Promise<SceneResult<T>> {
    if (this.remoteBridge.isRemote(campaignId)) {
      return readOnly();
    }
    const repository = await this.getLocalRepository(campaignId);
    if (!repository) {
      return unavailable();
    }
    const result = await operation(repository);
    if (result.ok) {
      const manifest = await repository.readManifest();
      this.emitChanged(campaignId, manifest);
    }
    return result;
  }

  private remoteManifest(campaignId: string): SceneManifest {
    const scene = this.remoteBridge.getActiveScene(campaignId);
    const manifest = createEmptySceneManifest();
    if (!scene) {
      return manifest;
    }
    return {
      ...manifest,
      activeSceneId: scene.id,
      revision: scene.revision,
      scenes: [scene],
    };
  }

  private emitChanged(campaignId: string, manifest: SceneManifest): void {
    this.emit('changed', { campaignId, manifest } satisfies SceneChangedEvent);
  }
}
