import { z } from 'zod';
import {
  MAX_DRAWING_POINTS,
  GRID_COLOR_PATTERN,
  MAX_SCENE_DRAWINGS,
  MAX_SCENE_DRAWING_POINTS,
  SCENE_MANIFEST_SCHEMA_VERSION,
  MAX_SCENE_IMAGES,
  sceneBounds,
} from './sceneConstants';

const bounded = (bound: { max: number; min: number }) =>
  z.number().finite().min(bound.min).max(bound.max);

const boundedInteger = (bound: { max: number; min: number }) =>
  z.number().int().min(bound.min).max(bound.max);

export const sceneGridSchema = z
  .object({
    color: z.string().regex(GRID_COLOR_PATTERN),
    lineThickness: bounded(sceneBounds.gridLineThickness),
    offsetX: bounded(sceneBounds.gridOffset),
    offsetY: bounded(sceneBounds.gridOffset),
    opacity: bounded(sceneBounds.gridOpacity),
    size: bounded(sceneBounds.gridSize),
    type: z.enum(['gridless', 'square']),
  })
  .strict();

export const sceneImageTransformSchema = z
  .object({
    height: bounded(sceneBounds.height),
    rotation: bounded(sceneBounds.rotation),
    width: bounded(sceneBounds.width),
    x: z.number().finite().min(-sceneBounds.width.max).max(sceneBounds.width.max),
    y: z
      .number()
      .finite()
      .min(-sceneBounds.height.max)
      .max(sceneBounds.height.max),
  })
  .strict();

export const sceneMapImageSchema = sceneImageTransformSchema.extend({
  assetId: z.string().uuid(),
});

export const sceneImageSchema = sceneMapImageSchema.extend({
  id: z.string().uuid(),
});

export const sceneImageLayersSchema = z
  .object({
    gm: z.array(sceneImageSchema),
    map: z.array(sceneImageSchema),
    token: z.array(sceneImageSchema),
  })
  .strict()
  .refine(
    (layers) =>
      layers.gm.length + layers.map.length + layers.token.length <=
      MAX_SCENE_IMAGES,
    `A scene can contain at most ${MAX_SCENE_IMAGES} images.`,
  )
  .refine((layers) => {
    const ids = [...layers.gm, ...layers.map, ...layers.token].map(
      (image) => image.id,
    );
    return new Set(ids).size === ids.length;
  }, 'Scene image IDs must be unique.');

export const sceneDrawingPointSchema = z
  .object({
    x: z.number().finite().min(-sceneBounds.width.max).max(sceneBounds.width.max),
    y: z
      .number()
      .finite()
      .min(-sceneBounds.height.max)
      .max(sceneBounds.height.max),
  })
  .strict();

export const sceneDrawingTransformSchema = z
  .object({
    rotation: bounded(sceneBounds.rotation),
    scaleX: bounded(sceneBounds.drawingScale),
    scaleY: bounded(sceneBounds.drawingScale),
    x: z.number().finite().min(-sceneBounds.width.max).max(sceneBounds.width.max),
    y: z
      .number()
      .finite()
      .min(-sceneBounds.height.max)
      .max(sceneBounds.height.max),
  })
  .strict();

export const sceneDrawingStyleSchema = z
  .object({
    edge: z.enum(['hard', 'soft']),
    fillColor: z.string().regex(GRID_COLOR_PATTERN),
    fillEnabled: z.boolean(),
    fillOpacity: z.number().finite().min(0.01).max(1),
    hardness: bounded(sceneBounds.drawingHardness),
    strokeColor: z.string().regex(GRID_COLOR_PATTERN),
    strokeOpacity: z.number().finite().min(0.01).max(1),
    strokeWidth: bounded(sceneBounds.drawingWidth),
  })
  .strict();

export const sceneDrawingSchema = sceneDrawingTransformSchema
  .extend({
    closed: z.boolean(),
    id: z.string().uuid(),
    kind: z.enum(['freeform', 'polyline']),
    ownerId: z.string().uuid().nullable(),
    points: z.array(sceneDrawingPointSchema).min(1).max(MAX_DRAWING_POINTS),
    revision: z.number().int().nonnegative(),
    style: sceneDrawingStyleSchema,
  })
  .strict()
  .superRefine((drawing, context) => {
    if (drawing.kind === 'freeform' && drawing.closed) {
      context.addIssue({
        code: 'custom',
        message: 'Freeform drawings cannot be closed.',
        path: ['closed'],
      });
    }
    if (drawing.kind === 'polyline' && drawing.points.length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'Polyline drawings require at least two points.',
        path: ['points'],
      });
    }
    if (drawing.closed && drawing.points.length < 3) {
      context.addIssue({
        code: 'custom',
        message: 'Closed drawings require at least three points.',
        path: ['points'],
      });
    }
    if (drawing.kind !== 'polyline' && drawing.style.fillEnabled) {
      context.addIssue({
        code: 'custom',
        message: 'Only Polyline drawings can have a fill.',
        path: ['style', 'fillEnabled'],
      });
    }
  });

export const sceneDrawingLayersSchema = z
  .object({
    gm: z.array(sceneDrawingSchema),
    map: z.array(sceneDrawingSchema),
    token: z.array(sceneDrawingSchema),
  })
  .strict()
  .refine(
    (layers) =>
      layers.gm.length + layers.map.length + layers.token.length <=
      MAX_SCENE_DRAWINGS,
    `A scene can contain at most ${MAX_SCENE_DRAWINGS} drawings.`,
  )
  .refine(
    (layers) =>
      [...layers.gm, ...layers.map, ...layers.token].reduce(
        (total, drawing) => total + drawing.points.length,
        0,
      ) <= MAX_SCENE_DRAWING_POINTS,
    `A scene can contain at most ${MAX_SCENE_DRAWING_POINTS} drawing points.`,
  )
  .refine((layers) => {
    const ids = [...layers.gm, ...layers.map, ...layers.token].map(
      (drawing) => drawing.id,
    );
    return new Set(ids).size === ids.length;
  }, 'Scene drawing IDs must be unique.');

export const sceneImageStateSchema = z
  .object({
    drawings: sceneDrawingLayersSchema,
    images: sceneImageLayersSchema,
    mapImage: sceneMapImageSchema.nullable(),
  })
  .strict()
  .refine((state) => {
    const imageIds = Object.values(state.images)
      .flat()
      .map((image) => image.id);
    const drawingIds = Object.values(state.drawings)
      .flat()
      .map((drawing) => drawing.id);
    return new Set([...imageIds, ...drawingIds]).size ===
      imageIds.length + drawingIds.length;
  }, 'Scene object IDs must be unique.');

export const sceneRecordSchema = z
  .object({
    createdAt: z.string().datetime(),
    distance: bounded(sceneBounds.distance),
    grid: sceneGridSchema,
    height: boundedInteger(sceneBounds.height),
    id: z.string().uuid(),
    drawings: sceneDrawingLayersSchema,
    images: sceneImageLayersSchema,
    mapImage: sceneMapImageSchema.nullable(),
    name: z.string().min(sceneBounds.name.min).max(sceneBounds.name.max),
    pixelScale: bounded(sceneBounds.pixelScale),
    revision: z.number().int().nonnegative(),
    unit: z.string().max(sceneBounds.unit.max),
    updatedAt: z.string().datetime(),
    width: boundedInteger(sceneBounds.width),
  })
  .strict()
  .refine((scene) => {
    const imageIds = Object.values(scene.images)
      .flat()
      .map((image) => image.id);
    const drawingIds = Object.values(scene.drawings)
      .flat()
      .map((drawing) => drawing.id);
    return new Set([...imageIds, ...drawingIds]).size ===
      imageIds.length + drawingIds.length;
  }, 'Scene object IDs must be unique.');

export const persistedSceneRecordSchema = sceneRecordSchema;

export const sceneManifestSchema = z
  .object({
    activeSceneId: z.string().uuid().nullable(),
    revision: z.number().int().nonnegative(),
    scenes: z.array(persistedSceneRecordSchema).max(1024),
    schemaVersion: z.literal(SCENE_MANIFEST_SCHEMA_VERSION),
  })
  .strict();

export const scenePatchSchema = z
  .object({
    distance: bounded(sceneBounds.distance).optional(),
    grid: sceneGridSchema.partial().optional(),
    height: boundedInteger(sceneBounds.height).optional(),
    mapImage: sceneMapImageSchema.nullable().optional(),
    name: z.string().min(1).max(256).optional(),
    pixelScale: bounded(sceneBounds.pixelScale).optional(),
    unit: z.string().max(sceneBounds.unit.max).optional(),
    width: boundedInteger(sceneBounds.width).optional(),
  })
  .strict();

export const sceneObjectTransformSchema = z.union([
  sceneImageTransformSchema,
  sceneDrawingTransformSchema,
]);

export type SceneGrid = z.infer<typeof sceneGridSchema>;
export type SceneGridType = SceneGrid['type'];
export type SceneImageTransform = z.infer<typeof sceneImageTransformSchema>;
export type SceneMapImage = z.infer<typeof sceneMapImageSchema>;
export type SceneImage = z.infer<typeof sceneImageSchema>;
export type SceneImageLayers = z.infer<typeof sceneImageLayersSchema>;
export type SceneImageLayer = keyof SceneImageLayers;
export type SceneDrawingPoint = z.infer<typeof sceneDrawingPointSchema>;
export type SceneDrawingTransform = z.infer<typeof sceneDrawingTransformSchema>;
export type SceneObjectTransform = z.infer<typeof sceneObjectTransformSchema>;
export type SceneDrawingStyle = z.infer<typeof sceneDrawingStyleSchema>;
export type SceneDrawingEdge = SceneDrawingStyle['edge'];
export type SceneDrawing = z.infer<typeof sceneDrawingSchema>;
export type SceneDrawingKind = SceneDrawing['kind'];
export type SceneDrawingLayers = z.infer<typeof sceneDrawingLayersSchema>;
export type SceneDrawingLayer = keyof SceneDrawingLayers;
export type SceneImageState = z.infer<typeof sceneImageStateSchema>;
export type SceneRecord = z.infer<typeof sceneRecordSchema>;
export type SceneManifest = z.infer<typeof sceneManifestSchema>;
export type ScenePatch = z.infer<typeof scenePatchSchema>;
