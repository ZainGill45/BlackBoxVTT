import {
  createEmptySceneManifest,
  type PresentSceneInput,
  type SceneAssetInput,
  type SceneHistoryInput,
  type SceneManifest,
  type SceneRecord,
  type SceneResult,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
  type SetSceneImagesInput,
  type SetSceneObjectsInput,
  type TrashSceneInput,
  type UpdateSceneInput,
} from '../shared/scenes';
import type { LocalCampaignWorkspace } from './campaignWorkspace';

export interface JoinedSceneTransport {
  cancelTransform(input: SceneTransformPreviewCancel): Promise<void>;
  getActiveScene(): SceneRecord | null;
  redo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  setObjects(input: SetSceneObjectsInput): Promise<SceneResult<SceneRecord>>;
  startTransform(input: SceneTransformPreviewStart): Promise<void>;
  undo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  updateTransform(input: SceneTransformPreviewDelta): Promise<void>;
}

export interface SceneRuntimeMutation<T> {
  changed: SceneManifest | null;
  result: SceneResult<T>;
}

export interface CampaignSceneRuntime {
  create(): Promise<SceneRuntimeMutation<SceneRecord>>;
  detachAsset(input: SceneAssetInput): Promise<SceneRuntimeMutation<null>>;
  findDependents(input: SceneAssetInput): Promise<SceneResult<SceneRecord[]>>;
  list(): Promise<SceneResult<SceneManifest>>;
  present(
    input: PresentSceneInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>>;
  previewCancel(input: SceneTransformPreviewCancel): Promise<boolean>;
  previewStart(input: SceneTransformPreviewStart): Promise<boolean>;
  previewUpdate(input: SceneTransformPreviewDelta): Promise<boolean>;
  redo(input: SceneHistoryInput): Promise<SceneRuntimeMutation<SceneRecord>>;
  setImages(
    input: SetSceneImagesInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>>;
  setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>>;
  trash(input: TrashSceneInput): Promise<SceneRuntimeMutation<null>>;
  undo(input: SceneHistoryInput): Promise<SceneRuntimeMutation<SceneRecord>>;
  update(input: UpdateSceneInput): Promise<SceneRuntimeMutation<SceneRecord>>;
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

class JoinedSceneRuntime implements CampaignSceneRuntime {
  constructor(private readonly transport: JoinedSceneTransport) {}

  create(): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.readOnlyMutation();
  }

  detachAsset(): Promise<SceneRuntimeMutation<null>> {
    return this.readOnlyMutation();
  }

  async findDependents(): Promise<SceneResult<SceneRecord[]>> {
    return { ok: true, value: [] };
  }

  async list(): Promise<SceneResult<SceneManifest>> {
    const scene = this.transport.getActiveScene();
    const manifest = createEmptySceneManifest();
    return {
      ok: true,
      value: scene
        ? {
            ...manifest,
            activeSceneId: scene.id,
            revision: scene.revision,
            scenes: [scene],
          }
        : manifest,
    };
  }

  present(): Promise<SceneRuntimeMutation<SceneManifest>> {
    return this.readOnlyMutation();
  }

  async previewCancel(input: SceneTransformPreviewCancel): Promise<boolean> {
    await this.transport.cancelTransform(input);
    return false;
  }

  async previewStart(input: SceneTransformPreviewStart): Promise<boolean> {
    await this.transport.startTransform(input);
    return false;
  }

  async previewUpdate(input: SceneTransformPreviewDelta): Promise<boolean> {
    await this.transport.updateTransform(input);
    return false;
  }

  async redo(
    input: SceneHistoryInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return { changed: null, result: await this.transport.redo(input) };
  }

  setImages(): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.readOnlyMutation();
  }

  async setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return {
      changed: null,
      result: await this.transport.setObjects(input),
    };
  }

  trash(): Promise<SceneRuntimeMutation<null>> {
    return this.readOnlyMutation();
  }

  async undo(
    input: SceneHistoryInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return { changed: null, result: await this.transport.undo(input) };
  }

  update(): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.readOnlyMutation();
  }

  private async readOnlyMutation<T>(): Promise<SceneRuntimeMutation<T>> {
    return { changed: null, result: readOnly() };
  }
}

class LocalSceneRuntime implements CampaignSceneRuntime {
  constructor(private readonly workspace: LocalCampaignWorkspace) {}

  create(): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() => this.workspace.sceneRepository.create());
  }

  detachAsset(input: SceneAssetInput): Promise<SceneRuntimeMutation<null>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.detachAsset(input.assetId),
    );
  }

  findDependents(input: SceneAssetInput): Promise<SceneResult<SceneRecord[]>> {
    return this.workspace.sceneRepository.findDependents(input.assetId);
  }

  list(): Promise<SceneResult<SceneManifest>> {
    return this.workspace.sceneRepository.list();
  }

  present(
    input: PresentSceneInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.present(input.sceneId),
    );
  }

  async previewCancel(input: SceneTransformPreviewCancel): Promise<boolean> {
    this.workspace.sceneRepository.cancelTransform(input.operationId, {
      kind: 'gm',
    });
    return true;
  }

  async previewStart(input: SceneTransformPreviewStart): Promise<boolean> {
    const result = await this.workspace.sceneRepository.beginTransform(
      input.sceneId,
      input.operationId,
      input.targets,
      { kind: 'gm' },
    );
    return result.ok;
  }

  async previewUpdate(input: SceneTransformPreviewDelta): Promise<boolean> {
    this.workspace.sceneRepository.refreshTransform(input.operationId, {
      kind: 'gm',
    });
    return true;
  }

  redo(
    input: SceneHistoryInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.redo(input.sceneId, { kind: 'gm' }),
    );
  }

  setImages(
    input: SetSceneImagesInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.setImages(
        input.sceneId,
        input.state,
        input.expectedRevision,
      ),
    );
  }

  setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.setObjects(
        input.sceneId,
        input.state,
        input.expectedRevision,
        input.operationId,
        { kind: 'gm' },
      ),
    );
  }

  trash(input: TrashSceneInput): Promise<SceneRuntimeMutation<null>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.trash(
        input.sceneId,
        input.expectedRevision,
      ),
    );
  }

  undo(
    input: SceneHistoryInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.undo(input.sceneId, { kind: 'gm' }),
    );
  }

  update(input: UpdateSceneInput): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.update(
        input.sceneId,
        input.patch,
        input.expectedRevision,
      ),
    );
  }

  private async mutate<T>(
    operation: () => Promise<SceneResult<T>>,
  ): Promise<SceneRuntimeMutation<T>> {
    const result = await operation();
    return {
      changed: result.ok
        ? await this.workspace.sceneRepository.readManifest()
        : null,
      result,
    };
  }
}

export function createJoinedSceneRuntime(
  transport: JoinedSceneTransport,
): CampaignSceneRuntime {
  return new JoinedSceneRuntime(transport);
}

export function createLocalSceneRuntime(
  workspace: LocalCampaignWorkspace,
): CampaignSceneRuntime {
  return new LocalSceneRuntime(workspace);
}
