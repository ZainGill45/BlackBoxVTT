import type {
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  MapPing,
  MeasurementEvent,
} from '../../shared/network';
import type {
  SceneDrawing,
  SceneMapImage,
  SceneRecord,
  SceneTransformPreviewStart,
} from '../../shared/scenes';

export const MAP_PING_COOLDOWN_MS = 500;

type PublicSceneObject = SceneMapImage | SceneDrawing;
type RelayedTransformStart = Omit<
  SceneTransformPreviewStart,
  'campaignId'
>;

function objectTransform(object: PublicSceneObject) {
  if ('points' in object) {
    return {
      rotation: object.rotation,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      x: object.x,
      y: object.y,
    };
  }
  return {
    height: object.height,
    rotation: object.rotation,
    width: object.width,
    x: object.x,
    y: object.y,
  };
}

export class CampaignSceneRealtimeRules {
  constructor(
    private readonly campaignId: string,
    private readonly now: () => number = Date.now,
  ) {}

  acceptMapPing(
    input: MapPing,
    scene: SceneRecord | null,
    lastAcceptedAt: number,
  ): number | null {
    if (
      input.campaignId !== this.campaignId ||
      !scene ||
      scene.id !== input.sceneId ||
      input.x < 0 ||
      input.x > scene.width ||
      input.y < 0 ||
      input.y > scene.height
    ) {
      return null;
    }
    const acceptedAt = this.now();
    return acceptedAt - lastAcceptedAt < MAP_PING_COOLDOWN_MS
      ? null
      : acceptedAt;
  }

  createDrawingPreview(
    input: DrawingPreviewUpdate,
    scene: SceneRecord | null,
    sourceUserId?: string,
  ): DrawingPreviewEvent | null {
    if (
      input.campaignId !== this.campaignId ||
      !scene ||
      scene.id !== input.sceneId
    ) {
      return null;
    }
    const layer = sourceUserId ? 'token' : input.layer;
    if (layer === 'gm') {
      return null;
    }
    return {
      ...input,
      layer,
      sourceId: sourceUserId ?? 'gm',
    };
  }

  acceptsMeasurement(
    input: MeasurementEvent,
    scene: SceneRecord,
    lastSourceSequence?: number,
  ): boolean {
    return (
      input.campaignId === this.campaignId &&
      input.sceneId === scene.id &&
      (lastSourceSequence === undefined ||
        input.updateSequence > lastSourceSequence) &&
      input.points.every(
        ({ x, y }) =>
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 &&
          x <= scene.width &&
          y >= 0 &&
          y <= scene.height,
      )
    );
  }

  createTransformStart(
    input: SceneTransformPreviewStart,
    scene: SceneRecord | null,
  ): RelayedTransformStart | null {
    if (
      input.campaignId !== this.campaignId ||
      !scene ||
      scene.id !== input.sceneId ||
      scene.revision !== input.revision
    ) {
      return null;
    }
    const publicTargets = new Map<string, PublicSceneObject>([
      ...(scene.mapImage
        ? [['canonical-map', scene.mapImage] as const]
        : []),
      ...scene.images.map.map((image) => [image.id, image] as const),
      ...scene.images.token.map((image) => [image.id, image] as const),
      ...scene.drawings.map.map((drawing) => [drawing.id, drawing] as const),
      ...scene.drawings.token.map(
        (drawing) => [drawing.id, drawing] as const,
      ),
    ]);
    const targets = [...new Set(input.targets)].filter((id) =>
      publicTargets.has(id),
    );
    if (targets.length === 0) {
      return null;
    }
    const startingTransforms = targets.flatMap((id) => {
      const object = publicTargets.get(id);
      return object
        ? [{ id, transform: objectTransform(object) }]
        : [];
    });
    return {
      kind: input.kind,
      operationId: input.operationId,
      pivotX: input.pivotX,
      pivotY: input.pivotY,
      revision: input.revision,
      sceneId: input.sceneId,
      startingTransforms,
      targets,
    };
  }
}
