import { EventEmitter } from 'node:events';
import type {
  PresentSceneInput,
  ReorderScenesInput,
  SceneAssetInput,
  SceneChangedEvent,
  SceneHistoryInput,
  SceneManifest,
  SceneRecord,
  SceneResult,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
  SetSceneImagesInput,
  SetSceneObjectsInput,
  SetSceneFogInput,
  TrashSceneInput,
  UpdateSceneInput,
  UpdateScenePermissionsInput,
} from '../shared/scenes';
import type { PermissionSubject } from '../shared/permissions';
import type {
  CampaignRuntimeRegistry,
  CampaignSceneRuntime,
  SceneRuntimeMutation,
} from './campaignRuntime';

interface SceneManagerOptions {
  runtimes: CampaignRuntimeRegistry;
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

/** Publishes scene events around the capability selected by the campaign runtime. */
export class SceneManager extends EventEmitter {
  private readonly runtimes: CampaignRuntimeRegistry;

  constructor({ runtimes }: SceneManagerOptions) {
    super();
    this.runtimes = runtimes;
  }

  async list(campaignId: string): Promise<SceneResult<SceneManifest>> {
    const scenes = await this.scenes(campaignId);
    return scenes ? scenes.list() : unavailable();
  }

  create(campaignId: string): Promise<SceneResult<SceneRecord>> {
    return this.mutate(campaignId, (scenes) => scenes.create());
  }

  async listUsers(
    campaignId: string,
  ): Promise<SceneResult<PermissionSubject[]>> {
    const scenes = await this.scenes(campaignId);
    return scenes ? scenes.listUsers() : unavailable();
  }

  updatePermissions(
    input: UpdateScenePermissionsInput,
  ): Promise<SceneResult<SceneManifest>> {
    return this.mutate(input.campaignId, (scenes) =>
      scenes.updatePermissions(input),
    );
  }

  update(input: UpdateSceneInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.update(input));
  }

  setImages(input: SetSceneImagesInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.setImages(input));
  }

  setObjects(input: SetSceneObjectsInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.setObjects(input));
  }

  setFog(input: SetSceneFogInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.setFog(input));
  }

  undo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.undo(input));
  }

  redo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>> {
    return this.mutate(input.campaignId, (scenes) => scenes.redo(input));
  }

  async previewStart(input: SceneTransformPreviewStart): Promise<void> {
    const scenes = await this.scenes(input.campaignId);
    if (await scenes?.previewStart(input)) {
      this.emit('preview-start', input);
    }
  }

  async previewUpdate(input: SceneTransformPreviewDelta): Promise<void> {
    const scenes = await this.scenes(input.campaignId);
    if (await scenes?.previewUpdate(input)) {
      this.emit('preview-update', input);
    }
  }

  async previewCancel(input: SceneTransformPreviewCancel): Promise<void> {
    const scenes = await this.scenes(input.campaignId);
    if (await scenes?.previewCancel(input)) {
      this.emit('preview-cancel', input);
    }
  }

  trash(input: TrashSceneInput): Promise<SceneResult<null>> {
    return this.mutate(input.campaignId, (scenes) => scenes.trash(input));
  }

  reorder(input: ReorderScenesInput): Promise<SceneResult<SceneManifest>> {
    return this.mutate(input.campaignId, (scenes) => scenes.reorder(input));
  }

  present(input: PresentSceneInput): Promise<SceneResult<SceneManifest>> {
    return this.mutate(input.campaignId, (scenes) => scenes.present(input));
  }

  detachAsset(input: SceneAssetInput): Promise<SceneResult<null>> {
    return this.mutate(input.campaignId, (scenes) =>
      scenes.detachAsset(input),
    );
  }

  async findDependents(
    input: SceneAssetInput,
  ): Promise<SceneResult<SceneRecord[]>> {
    const scenes = await this.scenes(input.campaignId);
    return scenes ? scenes.findDependents(input) : unavailable();
  }

  /** Re-reads and re-broadcasts the manifest, e.g. after a remote update. */
  async notifyChanged(campaignId: string): Promise<void> {
    const result = await this.list(campaignId);
    if (result.ok) {
      this.emitChanged(campaignId, result.value);
    }
  }

  private async scenes(
    campaignId: string,
  ): Promise<CampaignSceneRuntime | null> {
    return (await this.runtimes.resolve(campaignId))?.scenes ?? null;
  }

  private async mutate<T>(
    campaignId: string,
    operation: (
      scenes: CampaignSceneRuntime,
    ) => Promise<SceneRuntimeMutation<T>>,
  ): Promise<SceneResult<T>> {
    const scenes = await this.scenes(campaignId);
    if (!scenes) {
      return unavailable();
    }
    const outcome = await operation(scenes);
    if (outcome.changed) {
      this.emitChanged(campaignId, outcome.changed);
    }
    return outcome.result;
  }

  private emitChanged(campaignId: string, manifest: SceneManifest): void {
    this.emit('changed', { campaignId, manifest } satisfies SceneChangedEvent);
  }
}
