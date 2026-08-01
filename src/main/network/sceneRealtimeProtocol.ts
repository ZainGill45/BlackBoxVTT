import {
  MAX_DRAWING_PREVIEW_POINTS,
  type DrawingPreviewEvent,
  type DrawingPreviewUpdate,
} from '../../shared/network';
import {
  sceneDrawingPointSchema,
  sceneDrawingStyleSchema,
  sceneDrawingTransformSchema,
  sceneImageTransformSchema,
} from '../../shared/sceneSchema';
import type { SceneTransformPreviewDelta } from '../../shared/scenes';

type ClientDrawingPreview = Omit<
  DrawingPreviewUpdate,
  'campaignId' | 'layer' | 'reliable'
>;
type ServerDrawingPreview = Omit<
  DrawingPreviewEvent,
  'campaignId' | 'reliable'
>;
type TransformPreview = Omit<SceneTransformPreviewDelta, 'campaignId'>;

function parseObject(payload: Buffer): Record<string, unknown> {
  const value = JSON.parse(payload.toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Realtime scene payload must be an object.');
  }
  return value as Record<string, unknown>;
}

function decodeDrawingBase(
  value: Record<string, unknown>,
): ClientDrawingPreview {
  const points = Array.isArray(value.points)
    ? value.points
        .map((point) => sceneDrawingPointSchema.safeParse(point))
        .filter((result) => result.success)
        .map((result) => result.data)
    : [];
  const style = sceneDrawingStyleSchema.safeParse(value.style);
  if (
    typeof value.active !== 'boolean' ||
    typeof value.closed !== 'boolean' ||
    (value.kind !== 'freeform' && value.kind !== 'polyline') ||
    typeof value.operationId !== 'string' ||
    typeof value.sceneId !== 'string' ||
    typeof value.sequence !== 'number' ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 0 ||
    points.length > MAX_DRAWING_PREVIEW_POINTS ||
    !style.success ||
    (value.active ? points.length === 0 : points.length !== 0)
  ) {
    throw new Error('Invalid drawing preview.');
  }
  return {
    active: value.active,
    closed: value.closed,
    kind: value.kind,
    operationId: value.operationId,
    points,
    sceneId: value.sceneId,
    sequence: value.sequence,
    style: style.data,
  };
}

export function encodeClientDrawingPreview(
  input: Omit<DrawingPreviewUpdate, 'campaignId'>,
): Buffer {
  return Buffer.from(JSON.stringify(input), 'utf8');
}

export function decodeClientDrawingPreview(
  payload: Buffer,
): ClientDrawingPreview {
  return decodeDrawingBase(parseObject(payload));
}

export function encodeServerDrawingPreview(
  input: ServerDrawingPreview,
): Buffer {
  return Buffer.from(JSON.stringify(input), 'utf8');
}

export function decodeServerDrawingPreview(
  payload: Buffer,
): ServerDrawingPreview {
  const value = parseObject(payload);
  const preview = decodeDrawingBase(value);
  if (
    (value.layer !== 'map' && value.layer !== 'token') ||
    typeof value.sourceId !== 'string'
  ) {
    throw new Error('Invalid server drawing preview.');
  }
  return {
    ...preview,
    layer: value.layer,
    sourceId: value.sourceId,
  };
}

export function encodeTransformPreview(input: TransformPreview): Buffer {
  return Buffer.from(JSON.stringify(input), 'utf8');
}

export function decodeTransformPreview(payload: Buffer): TransformPreview {
  const value = parseObject(payload);
  const absolute =
    value.absolute === undefined
      ? null
      : sceneImageTransformSchema
          .or(sceneDrawingTransformSchema)
          .safeParse(value.absolute);
  if (
    typeof value.operationId !== 'string' ||
    (absolute !== null && !absolute.success) ||
    !['dx', 'dy', 'rotation', 'scaleX', 'scaleY'].every(
      (key) =>
        typeof value[key] === 'number' && Number.isFinite(value[key]),
    ) ||
    (value.scaleX as number) <= 0 ||
    (value.scaleY as number) <= 0
  ) {
    throw new Error('Invalid transform preview.');
  }
  return {
    ...(absolute?.success ? { absolute: absolute.data } : {}),
    dx: value.dx as number,
    dy: value.dy as number,
    operationId: value.operationId,
    rotation: value.rotation as number,
    scaleX: value.scaleX as number,
    scaleY: value.scaleY as number,
  };
}
