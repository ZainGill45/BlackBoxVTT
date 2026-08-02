import type {
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  MapPing,
  MeasurementEvent,
  ShapePreviewEvent,
  ShapePreviewUpdate,
} from '../../shared/network';
import type {
  SceneDrawing,
  SceneMapImage,
  SceneRecord,
  SceneShape,
  SceneText,
  SceneTransformPreviewStart,
} from '../../shared/scenes';

export const MAP_PING_COOLDOWN_MS = 500;

type PublicSceneObject = SceneMapImage | SceneDrawing | SceneShape | SceneText;
type RelayedTransformStart = Omit<
  SceneTransformPreviewStart,
  'campaignId'
>;

function objectTransform(object: PublicSceneObject) {
  if ('scaleX' in object) {
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
  private readonly shapePreviewOperations = new Map<
    string,
    {
      phase: ShapePreviewUpdate['phase'];
      sceneId: string;
      sequence: number;
      shapeId: string | null;
    }
  >();

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

  createShapePreview(
    input: ShapePreviewUpdate,
    scene: SceneRecord | null,
    sourceUserId?: string,
  ): ShapePreviewEvent | null {
    const layer = sourceUserId ? 'token' : input.layer;
    if (
      input.campaignId !== this.campaignId ||
      !scene ||
      scene.id !== input.sceneId ||
      layer === 'gm' ||
      (input.phase === 'update') === (input.reliable === true) ||
      (input.shape &&
        (input.shape.x < 0 ||
          input.shape.x > scene.width ||
          input.shape.y < 0 ||
          input.shape.y > scene.height)) ||
      (input.shape && [
        ...Object.values(scene.images).flat(),
        ...Object.values(scene.drawings).flat(),
        ...Object.values(scene.shapes).flat(),
        ...Object.values(scene.texts).flat(),
      ].some((object) => object.id === input.shape?.id))
    ) {
      return null;
    }
    const sourceId = sourceUserId ?? 'gm';
    const operationKey = `${sourceId}:${input.operationId}`;
    const operation = this.shapePreviewOperations.get(operationKey);
    if (
      input.sequence <= (operation?.sequence ?? -1) ||
      (input.phase === 'start' && operation) ||
      (input.phase === 'update' &&
        (!operation ||
          (operation.phase !== 'start' && operation.phase !== 'update'))) ||
      (input.phase === 'final' &&
        (!operation ||
          (operation.phase !== 'start' && operation.phase !== 'update'))) ||
      (input.phase === 'cancel' &&
        (!operation || operation.phase === 'cancel')) ||
      (operation && operation.sceneId !== input.sceneId) ||
      (operation?.shapeId &&
        input.shape &&
        operation.shapeId !== input.shape.id)
    ) {
      return null;
    }
    this.shapePreviewOperations.delete(operationKey);
    this.shapePreviewOperations.set(operationKey, {
      phase: input.phase,
      sceneId: input.sceneId,
      sequence: input.sequence,
      shapeId: input.shape?.id ?? operation?.shapeId ?? null,
    });
    if (this.shapePreviewOperations.size > 512) {
      const oldest = this.shapePreviewOperations.keys().next().value;
      if (oldest) {
        this.shapePreviewOperations.delete(oldest);
      }
    }
    return {
      ...input,
      layer,
      sourceId,
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
      ...scene.shapes.map.map((shape) => [shape.id, shape] as const),
      ...scene.shapes.token.map((shape) => [shape.id, shape] as const),
      ...scene.texts.map.map((text) => [text.id, text] as const),
      ...scene.texts.token.map((text) => [text.id, text] as const),
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
