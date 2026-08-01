import type {
  SceneDrawing,
  SceneHistoryInput,
  SceneImage,
  SceneRecord,
  SceneResult,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
  SetSceneObjectsInput,
} from '../../shared/scenes';
import type { JoinedSceneTransport } from '../campaignSceneRuntime';
import type { CampaignClient } from './campaignClient';

type SceneClient = Pick<
  CampaignClient,
  | 'cancelSceneTransform'
  | 'redoSceneEdit'
  | 'sendSceneTransformPreview'
  | 'setSceneObjects'
  | 'startSceneTransform'
  | 'undoSceneEdit'
>;

interface JoinedSceneSessionOptions {
  client: SceneClient;
  onChanged: () => void;
}

interface RemoteTransform {
  base: SceneRecord;
  input: Omit<SceneTransformPreviewStart, 'campaignId'>;
}

/** Owns the joined campaign's projected scene and transform previews. */
export class JoinedSceneSession {
  private activeCampaignId: string | null = null;
  private activeScene: SceneRecord | null = null;
  private readonly animations = new Map<
    string,
    {
      current: Omit<SceneTransformPreviewDelta, 'campaignId'>;
      lastAt: number;
      timers: Array<ReturnType<typeof setTimeout>>;
    }
  >();
  private readonly client: SceneClient;
  private readonly onChanged: () => void;
  private readonly transforms = new Map<string, RemoteTransform>();

  constructor({ client, onChanged }: JoinedSceneSessionOptions) {
    this.client = client;
    this.onChanged = onChanged;
  }

  activate(campaignId: string): void {
    this.activeCampaignId = campaignId;
  }

  createTransport(campaignId: string): JoinedSceneTransport {
    return {
      cancelTransform: (input) => this.cancelTransform(input),
      getActiveScene: () => this.getActiveScene(campaignId),
      redo: (input) => this.redo(input),
      setObjects: (input) => this.setObjects(input),
      startTransform: (input) => this.startTransform(input),
      undo: (input) => this.undo(input),
      updateTransform: (input) => this.updateTransform(input),
    };
  }

  present(scene: SceneRecord | null): void {
    this.clearAnimations();
    this.activeScene = scene;
    this.transforms.clear();
    this.onChanged();
  }

  beginTransform(
    input: Omit<SceneTransformPreviewStart, 'campaignId'>,
  ): void {
    if (
      this.activeScene?.id !== input.sceneId ||
      this.activeScene.revision !== input.revision
    ) {
      return;
    }
    this.transforms.set(input.operationId, {
      base: structuredClone(this.activeScene),
      input,
    });
    this.animations.set(input.operationId, {
      current: {
        ...(input.startingTransforms.length === 1
          ? { absolute: input.startingTransforms[0].transform }
          : {}),
        dx: 0,
        dy: 0,
        operationId: input.operationId,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      },
      lastAt: Date.now(),
      timers: [],
    });
  }

  animateTransform(
    input: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ): void {
    const active = this.transforms.get(input.operationId);
    if (!active) {
      return;
    }
    const animation = this.animations.get(input.operationId);
    const now = Date.now();
    const start = animation?.current ?? {
      dx: 0,
      dy: 0,
      operationId: input.operationId,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
    for (const timer of animation?.timers ?? []) {
      clearTimeout(timer);
    }
    const duration = Math.max(
      8,
      Math.min(34, animation ? now - animation.lastAt : 16),
    );
    const nextAnimation = {
      current: start,
      lastAt: now,
      timers: [] as Array<ReturnType<typeof setTimeout>>,
    };
    for (let step = 1; step <= 2; step += 1) {
      const progress = step / 2;
      nextAnimation.timers.push(
        setTimeout(() => {
          if (this.transforms.get(input.operationId) !== active) {
            return;
          }
          const value = {
            ...(input.absolute ? { absolute: input.absolute } : {}),
            dx: start.dx + (input.dx - start.dx) * progress,
            dy: start.dy + (input.dy - start.dy) * progress,
            operationId: input.operationId,
            rotation:
              start.rotation +
              (input.rotation - start.rotation) * progress,
            scaleX:
              start.scaleX + (input.scaleX - start.scaleX) * progress,
            scaleY:
              start.scaleY + (input.scaleY - start.scaleY) * progress,
          };
          nextAnimation.current = value;
          this.applyTransform(active, value);
        }, (duration * step) / 2),
      );
    }
    this.animations.set(input.operationId, nextAnimation);
  }

  cancelIncomingTransform(
    input: Omit<SceneTransformPreviewCancel, 'campaignId'>,
  ): void {
    const active = this.transforms.get(input.operationId);
    if (active?.base.id !== input.sceneId) {
      return;
    }
    this.clearAnimation(input.operationId);
    this.activeScene = active.base;
    this.transforms.delete(input.operationId);
    this.onChanged();
  }

  reset(): void {
    this.clearAnimations();
    this.activeCampaignId = null;
    this.activeScene = null;
    this.transforms.clear();
  }

  private getActiveScene(campaignId: string): SceneRecord | null {
    return this.activeCampaignId === campaignId ? this.activeScene : null;
  }

  private async setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>> {
    if (this.activeCampaignId !== input.campaignId) {
      return {
        error: {
          code: 'permission_denied',
          message: 'The remote campaign is not active.',
        },
        ok: false,
      };
    }
    return this.client.setSceneObjects({
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      sceneId: input.sceneId,
      state: input.state,
    });
  }

  private undo(
    input: SceneHistoryInput,
  ): Promise<SceneResult<SceneRecord>> {
    return this.client.undoSceneEdit({ sceneId: input.sceneId });
  }

  private redo(
    input: SceneHistoryInput,
  ): Promise<SceneResult<SceneRecord>> {
    return this.client.redoSceneEdit({ sceneId: input.sceneId });
  }

  private async startTransform(
    input: SceneTransformPreviewStart,
  ): Promise<void> {
    await this.client.startSceneTransform({
      kind: input.kind,
      operationId: input.operationId,
      pivotX: input.pivotX,
      pivotY: input.pivotY,
      revision: input.revision,
      sceneId: input.sceneId,
      targets: input.targets,
    });
  }

  private async updateTransform(
    input: SceneTransformPreviewDelta,
  ): Promise<void> {
    this.client.sendSceneTransformPreview({
      ...(input.absolute ? { absolute: input.absolute } : {}),
      dx: input.dx,
      dy: input.dy,
      operationId: input.operationId,
      rotation: input.rotation,
      scaleX: input.scaleX,
      scaleY: input.scaleY,
    });
  }

  private async cancelTransform(
    input: SceneTransformPreviewCancel,
  ): Promise<void> {
    this.client.cancelSceneTransform({
      operationId: input.operationId,
      sceneId: input.sceneId,
    });
  }

  private applyTransform(
    active: RemoteTransform,
    delta: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ): void {
    const scene: SceneRecord = structuredClone(active.base);
    if (delta.absolute && active.input.targets.length === 1) {
      const targetId = active.input.targets[0];
      if (targetId === 'canonical-map' && scene.mapImage) {
        scene.mapImage = { ...scene.mapImage, ...delta.absolute };
      } else {
        for (const layer of Object.values(scene.images) as SceneImage[][]) {
          const image = layer.find((candidate) => candidate.id === targetId);
          if (image) {
            Object.assign(image, delta.absolute);
            break;
          }
        }
        for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
          const drawing = layer.find(
            (candidate) => candidate.id === targetId,
          );
          if (drawing) {
            Object.assign(drawing, delta.absolute);
            break;
          }
        }
      }
      this.activeScene = scene;
      this.onChanged();
      return;
    }
    const radians = (delta.rotation * Math.PI) / 180;
    const apply = <
      T extends {
        height: number;
        rotation: number;
        width: number;
        x: number;
        y: number;
      },
    >(
      image: T,
    ): T => {
      const dx = (image.x - active.input.pivotX) * delta.scaleX;
      const dy = (image.y - active.input.pivotY) * delta.scaleY;
      return {
        ...image,
        height: image.height * delta.scaleY,
        rotation: image.rotation + delta.rotation,
        width: image.width * delta.scaleX,
        x:
          active.input.pivotX +
          Math.cos(radians) * dx -
          Math.sin(radians) * dy +
          delta.dx,
        y:
          active.input.pivotY +
          Math.sin(radians) * dx +
          Math.cos(radians) * dy +
          delta.dy,
      };
    };
    if (active.input.targets.includes('canonical-map') && scene.mapImage) {
      scene.mapImage = apply(scene.mapImage);
    }
    const targets = new Set(active.input.targets);
    for (const layer of Object.values(scene.images)) {
      for (let index = 0; index < layer.length; index += 1) {
        if (targets.has(layer[index].id)) {
          layer[index] = apply(layer[index]);
        }
      }
    }
    for (const layer of Object.values(scene.drawings)) {
      for (let index = 0; index < layer.length; index += 1) {
        const drawing = layer[index];
        if (!targets.has(drawing.id)) {
          continue;
        }
        const dx = (drawing.x - active.input.pivotX) * delta.scaleX;
        const dy = (drawing.y - active.input.pivotY) * delta.scaleY;
        layer[index] = {
          ...drawing,
          rotation: drawing.rotation + delta.rotation,
          scaleX: drawing.scaleX * delta.scaleX,
          scaleY: drawing.scaleY * delta.scaleY,
          x:
            active.input.pivotX +
            Math.cos(radians) * dx -
            Math.sin(radians) * dy +
            delta.dx,
          y:
            active.input.pivotY +
            Math.sin(radians) * dx +
            Math.cos(radians) * dy +
            delta.dy,
        };
      }
    }
    this.activeScene = scene;
    this.onChanged();
  }

  private clearAnimation(operationId: string): void {
    const animation = this.animations.get(operationId);
    for (const timer of animation?.timers ?? []) {
      clearTimeout(timer);
    }
    this.animations.delete(operationId);
  }

  private clearAnimations(): void {
    for (const operationId of this.animations.keys()) {
      this.clearAnimation(operationId);
    }
  }
}
