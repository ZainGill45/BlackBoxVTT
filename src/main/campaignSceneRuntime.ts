import {
  createEmptySceneManifest,
  type PresentSceneInput,
  type SceneAssetInput,
  type ReorderScenesInput,
  type SceneHistoryInput,
  type SceneManifest,
  type SceneRecord,
  type SceneResult,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
  type SetSceneImagesInput,
  type SetSceneObjectsInput,
  type SetSceneFogInput,
  type TrashSceneInput,
  type ScenePatch,
  type UpdateSceneInput,
} from '../shared/scenes';
import type { UpdateScenePermissionsInput } from '../shared/sceneContracts';
import type { PermissionSubject } from '../shared/permissions';
import type { LocalCampaignWorkspace } from './campaignWorkspace';

export interface JoinedSceneTransport {
  cancelTransform(input: SceneTransformPreviewCancel): Promise<void>;
  getActiveScene(): SceneRecord | null;
  listScenes(): Promise<SceneResult<SceneManifest>>;
  trashScene(input: {
    expectedRevision: number;
    sceneId: string;
  }): Promise<SceneResult<null>>;
  updateScene(input: {
    expectedRevision: number;
    patch: ScenePatch;
    sceneId: string;
  }): Promise<SceneResult<SceneRecord>>;
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
  listUsers(): Promise<SceneResult<PermissionSubject[]>>;
  updatePermissions(
    input: UpdateScenePermissionsInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>>;
  present(
    input: PresentSceneInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>>;
  previewCancel(input: SceneTransformPreviewCancel): Promise<boolean>;
  previewStart(input: SceneTransformPreviewStart): Promise<boolean>;
  previewUpdate(input: SceneTransformPreviewDelta): Promise<boolean>;
  redo(input: SceneHistoryInput): Promise<SceneRuntimeMutation<SceneRecord>>;
  reorder(
    input: ReorderScenesInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>>;
  setImages(
    input: SetSceneImagesInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>>;
  setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>>;
  setFog(input: SetSceneFogInput): Promise<SceneRuntimeMutation<SceneRecord>>;
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

  /**
   * The Game Master's projection of this player's library, with the presented
   * scene folded in from the live session so the table keeps drawing even
   * while the request is in flight or the connection is down.
   */
  async list(): Promise<SceneResult<SceneManifest>> {
    const scene = this.transport.getActiveScene();
    const listed = await this.transport.listScenes();
    if (listed.ok) {
      if (!scene) return listed;
      /* The live session's copy of the presented scene wins over the host's
         listing of it, because that is the one carrying transform previews and
         everything else the table is watching move. */
      const others = listed.value.scenes.filter(({ id }) => id !== scene.id);
      return {
        ok: true,
        value: {
          ...listed.value,
          activeSceneId: scene.id,
          scenes: [...others, scene],
        },
      };
    }
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

  async listUsers(): Promise<SceneResult<PermissionSubject[]>> {
    return readOnly();
  }

  updatePermissions(): Promise<SceneRuntimeMutation<SceneManifest>> {
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

  async trash(input: TrashSceneInput): Promise<SceneRuntimeMutation<null>> {
    const result = await this.transport.trashScene({
      expectedRevision: input.expectedRevision,
      sceneId: input.sceneId,
    });
    return {
      changed: result.ok ? await this.currentManifest() : null,
      result,
    };
  }

  async update(
    input: UpdateSceneInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    const result = await this.transport.updateScene({
      expectedRevision: input.expectedRevision,
      patch: input.patch,
      sceneId: input.sceneId,
    });
    return {
      changed: result.ok ? await this.currentManifest() : null,
      result,
    };
  }

  /** The refreshed library to announce, or nothing if it cannot be read. */
  private async currentManifest(): Promise<SceneManifest | null> {
    const listed = await this.list();
    return listed.ok ? listed.value : null;
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

  setFog(): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.readOnlyMutation();
  }

  async undo(
    input: SceneHistoryInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return { changed: null, result: await this.transport.undo(input) };
  }

  reorder(): Promise<SceneRuntimeMutation<SceneManifest>> {
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

  async listUsers(): Promise<SceneResult<PermissionSubject[]>> {
    return { ok: true, value: this.workspace.sceneRepository.listUsers() };
  }

  updatePermissions(
    input: UpdateScenePermissionsInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.updateScenePermissions(input),
    );
  }

  present(
    input: PresentSceneInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.present(input.sceneId),
    );
  }

  reorder(
    input: ReorderScenesInput,
  ): Promise<SceneRuntimeMutation<SceneManifest>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.reorderScenes(
        input.orderedSceneIds,
        input.expectedRevision,
      ),
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
        input.arrangement,
      ),
    );
  }

  setFog(
    input: SetSceneFogInput,
  ): Promise<SceneRuntimeMutation<SceneRecord>> {
    return this.mutate(() =>
      this.workspace.sceneRepository.setFog(
        input.sceneId,
        input.mutation,
        input.expectedRevision,
        input.operationId,
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
