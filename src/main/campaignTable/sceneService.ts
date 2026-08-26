import {
  findScene,
  projectSceneForPlayer,
  type SceneEditActor,
  type SceneObjectState,
  type SceneArrangement,
  type SceneManifest,
  type ScenePatch,
  type SceneRecord,
  type SceneResult,
  type SceneTokenHealthPresentation,
} from '../../shared/scenes';
import type {
  TokenInspectorMutation,
  TokenInspectorPresentation,
} from '../../shared/tokenInspector';
import type { ChatRollDefinition } from '../../shared/chatRoll';
import { projectSceneManifest } from '../scenePolicy';
import type {
  SceneRepository,
  SceneRepositoryMutation,
} from '../sceneRepository';

type SceneStore = Pick<
  SceneRepository,
  | 'beginTransform'
  | 'cancelTransform'
  | 'listTokenHealth'
  | 'getTokenInspector'
  | 'resolveTokenInspectorRoll'
  | 'mutateTokenInspectorWithEffects'
  | 'readManifest'
  | 'redo'
  | 'redoWithEffects'
  | 'refreshTransform'
  | 'setObjects'
  | 'trash'
  | 'undo'
  | 'undoWithEffects'
  | 'update'
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

  /**
   * The scene library as one player sees it: what they were granted, plus
   * whatever is presented, each scene stripped of the Game Master's layer.
   */
  async listForPlayer(userId: string): Promise<SceneManifest> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    return {
      ...projected,
      scenes: projected.scenes.map((scene) => projectSceneForPlayer(scene)),
    };
  }

  async listTokenHealthForPlayer(
    sceneId: string,
    userId: string,
  ): Promise<SceneResult<SceneTokenHealthPresentation[]>> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    if (!projected.scenes.some((scene) => scene.id === sceneId)) {
      return {
        error: {
          code: 'permission_denied',
          message: 'You cannot view this scene.',
          sceneId,
        },
        ok: false,
      };
    }
    return this.scenes.listTokenHealth(sceneId);
  }

  async getTokenInspectorForPlayer(
    sceneId: string,
    tokenId: string,
    userId: string,
  ): Promise<SceneResult<TokenInspectorPresentation>> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    if (!projected.scenes.some((scene) => scene.id === sceneId)) {
      return {
        error: {
          code: 'permission_denied',
          message: 'You cannot view this scene.',
          sceneId,
        },
        ok: false,
      };
    }
    return this.scenes.getTokenInspector(sceneId, tokenId, actor(userId));
  }

  async resolveTokenInspectorRollForPlayer(
    sceneId: string,
    tokenId: string,
    fieldId: string,
    userId: string,
  ): Promise<SceneResult<ChatRollDefinition>> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    if (!projected.scenes.some((scene) => scene.id === sceneId)) {
      return {
        error: {
          code: 'permission_denied',
          message: 'You cannot view this scene.',
          sceneId,
        },
        ok: false,
      };
    }
    return this.scenes.resolveTokenInspectorRoll(
      sceneId,
      tokenId,
      fieldId,
      actor(userId),
    );
  }

  async mutatePlayerTokenInspectorWithEffects(
    sceneId: string,
    tokenId: string,
    mutation: TokenInspectorMutation,
    operationId: string,
    userId: string,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    if (!projected.scenes.some((scene) => scene.id === sceneId)) {
      return {
        authoredDataChangedEntryIds: [],
        result: {
          error: {
            code: 'permission_denied',
            message: 'You cannot view this scene.',
            sceneId,
          },
          ok: false,
        },
      };
    }
    const outcome = await this.scenes.mutateTokenInspectorWithEffects(
      sceneId,
      tokenId,
      mutation,
      operationId,
      actor(userId),
    );
    return { ...outcome, result: projectResult(outcome.result) };
  }

  async updateForPlayer(
    userId: string,
    input: { expectedRevision: number; patch: ScenePatch; sceneId: string },
  ): Promise<SceneResult<SceneRecord>> {
    const denied = await this.requireSceneEdit<SceneRecord>(userId, input.sceneId);
    if (denied) return denied;
    return projectResult(
      await this.scenes.update(input.sceneId, input.patch, input.expectedRevision),
    );
  }

  async trashForPlayer(
    userId: string,
    input: { expectedRevision: number; sceneId: string },
  ): Promise<SceneResult<null>> {
    const denied = await this.requireSceneEdit<null>(userId, input.sceneId);
    if (denied) return denied;
    return this.scenes.trash(input.sceneId, input.expectedRevision);
  }

  /** Returns the refusal to send back, or null when the grant covers it. */
  private async requireSceneEdit<T>(
    userId: string,
    sceneId: string,
  ): Promise<SceneResult<T> | null> {
    const projected = projectSceneManifest(await this.scenes.readManifest(), {
      kind: 'player',
      userId,
    });
    const entry = projected.access.find((access) => access.sceneId === sceneId);
    return entry?.capabilities.update
      ? null
      : {
          error: {
            code: 'permission_denied',
            message: 'You cannot change this scene.',
            sceneId,
          },
          ok: false,
        };
  }

  async readActiveScene(): Promise<SceneRecord | null> {
    const manifest = await this.scenes.readManifest();
    const scene = findScene(manifest, manifest.activeSceneId);
    return scene ? projectSceneForPlayer(scene) : null;
  }

  async setPlayerObjects(
    sceneId: string,
    state: SceneObjectState,
    expectedRevision: number,
    operationId: string,
    userId: string,
    arrangement?: SceneArrangement,
  ): Promise<SceneResult<SceneRecord>> {
    const result = arrangement
      ? await this.scenes.setObjects(
          sceneId,
          state,
          expectedRevision,
          operationId,
          actor(userId),
          arrangement,
        )
      : await this.scenes.setObjects(
          sceneId,
          state,
          expectedRevision,
          operationId,
          actor(userId),
        );
    return projectResult(
      result,
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

  async applyPlayerHistoryWithEffects(
    direction: HistoryDirection,
    sceneId: string,
    userId: string,
  ): Promise<SceneRepositoryMutation<SceneRecord>> {
    const outcome = await this.scenes[`${direction}WithEffects`](
      sceneId,
      actor(userId),
    );
    return { ...outcome, result: projectResult(outcome.result) };
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
