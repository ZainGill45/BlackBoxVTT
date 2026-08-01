import {
  findScene,
  projectSceneForPlayer,
  type SceneEditActor,
  type SceneImageState,
  type SceneRecord,
  type SceneResult,
} from '../../shared/scenes';
import type { SceneRepository } from '../sceneRepository';

type SceneStore = Pick<
  SceneRepository,
  | 'beginTransform'
  | 'cancelTransform'
  | 'readManifest'
  | 'redo'
  | 'refreshTransform'
  | 'setObjects'
  | 'undo'
>;

type HistoryDirection = 'redo' | 'undo';

function actor(userId?: string): SceneEditActor {
  return userId ? { kind: 'player', userId } : { kind: 'gm' };
}

function projectResult(
  result: SceneResult<SceneRecord>,
): SceneResult<SceneRecord> {
  return result.ok
    ? { ok: true, value: projectSceneForPlayer(result.value) }
    : result;
}

export class CampaignSceneService {
  constructor(private readonly scenes: SceneStore) {}

  async readActiveScene(): Promise<SceneRecord | null> {
    const manifest = await this.scenes.readManifest();
    const scene = findScene(manifest, manifest.activeSceneId);
    return scene ? projectSceneForPlayer(scene) : null;
  }

  async setPlayerObjects(
    sceneId: string,
    state: SceneImageState,
    expectedRevision: number,
    operationId: string,
    userId: string,
  ): Promise<SceneResult<SceneRecord>> {
    return projectResult(
      await this.scenes.setObjects(
        sceneId,
        state,
        expectedRevision,
        operationId,
        actor(userId),
      ),
    );
  }

  async applyPlayerHistory(
    direction: HistoryDirection,
    sceneId: string,
    userId: string,
  ): Promise<SceneResult<SceneRecord>> {
    return projectResult(
      await this.scenes[direction](sceneId, actor(userId)),
    );
  }

  beginPlayerTransform(
    sceneId: string,
    operationId: string,
    targets: string[],
    userId: string,
  ): Promise<SceneResult<null>> {
    return this.scenes.beginTransform(
      sceneId,
      operationId,
      targets,
      actor(userId),
    );
  }

  refreshTransform(operationId: string, userId?: string): void {
    this.scenes.refreshTransform(operationId, actor(userId));
  }

  cancelTransform(operationId: string, userId?: string): void {
    this.scenes.cancelTransform(operationId, actor(userId));
  }
}
