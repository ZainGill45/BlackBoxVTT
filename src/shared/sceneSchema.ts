import { z } from 'zod';
import {
  MAX_DRAWING_POINTS,
  GRID_COLOR_PATTERN,
  MAX_SCENE_DRAWINGS,
  MAX_SCENE_DRAWING_POINTS,
  MAX_SCENE_IMAGES,
  MAX_SCENE_OBJECTS,
  MAX_SCENE_TEXT_CHARACTERS,
  MAX_SCENE_TEXT_RASTER_PIXELS,
  MAX_SCENE_TEXTS,
  MAX_SCENE_SHAPES,
  MAX_SCENE_FOG_OPERATIONS,
  MAX_SCENE_FOG_POINTS,
  MAX_FOG_OPERATION_POINTS,
  MAX_TEXT_CHARACTERS,
  MAX_TEXT_LINES,
  MAX_TEXT_RASTER_DIMENSION,
  MAX_TEXT_RASTER_PIXELS,
  SCENE_TEXT_FAMILIES,
  SCENE_TEXT_WEIGHTS,
  sceneBounds,
  type SceneLayer,
} from './sceneConstants';
import { estimateSceneTextRaster } from './sceneTextMetrics';

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

export const sceneTextTransformSchema = sceneDrawingTransformSchema;

export const sceneTextFamilySchema = z.enum(SCENE_TEXT_FAMILIES);

export const sceneTextWeightSchema = z.union([
  z.literal(SCENE_TEXT_WEIGHTS[0]),
  z.literal(SCENE_TEXT_WEIGHTS[1]),
  z.literal(SCENE_TEXT_WEIGHTS[2]),
  z.literal(SCENE_TEXT_WEIGHTS[3]),
]);

export const sceneTextStyleSchema = z
  .object({
    fontFamily: sceneTextFamilySchema,
    fontSize: bounded(sceneBounds.textFontSize),
    fontWeight: sceneTextWeightSchema,
    primaryColor: z.string().regex(GRID_COLOR_PATTERN),
    strokeColor: z.string().regex(GRID_COLOR_PATTERN),
    strokeWidth: bounded(sceneBounds.textStrokeWidth),
  })
  .strict();

export const sceneFogPointSchema = z
  .object({
    x: z.number().finite().min(0).max(sceneBounds.width.max),
    y: z.number().finite().min(0).max(sceneBounds.height.max),
  })
  .strict();

const sceneFogOperationBaseSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(['hide', 'reveal']),
});

export const sceneFogOperationSchema = z.discriminatedUnion('kind', [
  sceneFogOperationBaseSchema
    .extend({
      height: z.number().finite().positive().max(sceneBounds.height.max),
      kind: z.literal('box'),
      width: z.number().finite().positive().max(sceneBounds.width.max),
      x: z.number().finite().min(0).max(sceneBounds.width.max),
      y: z.number().finite().min(0).max(sceneBounds.height.max),
    })
    .strict(),
  sceneFogOperationBaseSchema
    .extend({
      hardness: bounded(sceneBounds.drawingHardness),
      kind: z.literal('brush'),
      points: z
        .array(sceneFogPointSchema)
        .min(1)
        .max(MAX_FOG_OPERATION_POINTS),
      width: bounded(sceneBounds.fogBrushWidth),
    })
    .strict(),
]);

export const sceneFogSchema = z
  .object({
    base: z.enum(['clear', 'covered']),
    color: z.string().regex(GRID_COLOR_PATTERN),
    operations: z.array(sceneFogOperationSchema).max(MAX_SCENE_FOG_OPERATIONS),
  })
  .strict()
  .refine(
    (fog) =>
      fog.operations.reduce(
        (total, operation) =>
          total + (operation.kind === 'brush' ? operation.points.length : 0),
        0,
      ) <= MAX_SCENE_FOG_POINTS,
    `Scene fog can contain at most ${MAX_SCENE_FOG_POINTS} brush points.`,
  )
  .refine(
    (fog) =>
      new Set(fog.operations.map((operation) => operation.id)).size ===
      fog.operations.length,
    'Scene fog operation IDs must be unique.',
  );

export const sceneTextSchema = sceneTextTransformSchema
  .extend({
    content: z
      .string()
      .min(1)
      .max(MAX_TEXT_CHARACTERS)
      .refine((value) => /\S/u.test(value), 'Text content cannot be blank.'),
    id: z.string().uuid(),
    ownerId: z.string().uuid().nullable(),
    revision: z.number().int().nonnegative(),
    style: sceneTextStyleSchema,
  })
  .strict()
  .superRefine((text, context) => {
    const lines = text.content.split('\n');
    if (lines.length > MAX_TEXT_LINES) {
      context.addIssue({
        code: 'custom',
        message: `Text can contain at most ${MAX_TEXT_LINES} lines.`,
        path: ['content'],
      });
    }
    const raster = estimateSceneTextRaster(text);
    if (
      raster.width > MAX_TEXT_RASTER_DIMENSION ||
      raster.height > MAX_TEXT_RASTER_DIMENSION
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Text is too large to render safely.',
        path: ['content'],
      });
    }
    if (raster.pixels > MAX_TEXT_RASTER_PIXELS) {
      context.addIssue({
        code: 'custom',
        message: 'Text would require too much raster memory.',
        path: ['content'],
      });
    }
  });

export const sceneTextLayersSchema = z
  .object({
    gm: z.array(sceneTextSchema),
    map: z.array(sceneTextSchema),
    token: z.array(sceneTextSchema),
  })
  .strict()
  .refine(
    (layers) =>
      layers.gm.length + layers.map.length + layers.token.length <=
      MAX_SCENE_TEXTS,
    `A scene can contain at most ${MAX_SCENE_TEXTS} text objects.`,
  )
  .refine(
    (layers) =>
      [...layers.gm, ...layers.map, ...layers.token].reduce(
        (total, text) => total + text.content.length,
        0,
      ) <= MAX_SCENE_TEXT_CHARACTERS,
    `A scene can contain at most ${MAX_SCENE_TEXT_CHARACTERS} text characters.`,
  )
  .refine(
    (layers) =>
      [...layers.gm, ...layers.map, ...layers.token].reduce(
        (total, text) => total + estimateSceneTextRaster(text).pixels,
        0,
      ) <= MAX_SCENE_TEXT_RASTER_PIXELS,
    'Scene text would require too much raster memory.',
  )
  .refine((layers) => {
    const ids = [...layers.gm, ...layers.map, ...layers.token].map(
      (text) => text.id,
    );
    return new Set(ids).size === ids.length;
  }, 'Scene text IDs must be unique.');

export const sceneShapeStyleSchema = z
  .object({
    backgroundColor: z.string().regex(GRID_COLOR_PATTERN),
    backgroundOpacity: z.number().finite().min(0).max(1),
    backgroundType: z.enum(['fill', 'crosshatched', 'transparent']),
    fontColor: z.string().regex(GRID_COLOR_PATTERN),
    fontFamily: sceneTextFamilySchema,
    fontSize: bounded(sceneBounds.shapeFontSize),
    fontStrokeColor: z.string().regex(GRID_COLOR_PATTERN),
    fontStrokeWidth: bounded(sceneBounds.shapeFontStrokeWidth),
    fontWeight: sceneTextWeightSchema,
    strokeColor: z.string().regex(GRID_COLOR_PATTERN),
    strokeOpacity: z.number().finite().min(0).max(1),
    strokeType: z.enum(['solid', 'dashed', 'dotted']),
    strokeWidth: bounded(sceneBounds.shapeStrokeWidth),
  })
  .strict();

const sceneShapeBaseSchema = sceneImageTransformSchema.extend({
  id: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  style: sceneShapeStyleSchema,
});

export const sceneShapeSchema = z.discriminatedUnion('kind', [
  sceneShapeBaseSchema.extend({ kind: z.literal('sphere') }).strict(),
  sceneShapeBaseSchema.extend({ kind: z.literal('square') }).strict(),
  sceneShapeBaseSchema
    .extend({
      kind: z.literal('cone'),
      spread: bounded(sceneBounds.shapeSpread),
    })
    .strict(),
]);

const sceneShapePreviewBase = sceneImageTransformSchema.extend({
  id: z.string().uuid(),
  style: sceneShapeStyleSchema,
});

export const sceneShapePreviewSchema = z.discriminatedUnion('kind', [
  sceneShapePreviewBase.extend({ kind: z.literal('sphere') }).strict(),
  sceneShapePreviewBase.extend({ kind: z.literal('square') }).strict(),
  sceneShapePreviewBase
    .extend({
      kind: z.literal('cone'),
      spread: bounded(sceneBounds.shapeSpread),
    })
    .strict(),
]);

export const sceneShapeLayersSchema = z
  .object({
    gm: z.array(sceneShapeSchema),
    map: z.array(sceneShapeSchema),
    token: z.array(sceneShapeSchema),
  })
  .strict()
  .refine(
    (layers) =>
      layers.gm.length + layers.map.length + layers.token.length <=
      MAX_SCENE_SHAPES,
    `A scene can contain at most ${MAX_SCENE_SHAPES} shapes.`,
  )
  .refine((layers) => {
    const ids = [...layers.gm, ...layers.map, ...layers.token].map(
      (shape) => shape.id,
    );
    return new Set(ids).size === ids.length;
  }, 'Scene shape IDs must be unique.');

export const sceneObjectOrderLayersSchema = z
  .object({
    gm: z.array(z.string().uuid()).max(MAX_SCENE_OBJECTS),
    map: z.array(z.string().uuid()).max(MAX_SCENE_OBJECTS),
    token: z.array(z.string().uuid()).max(MAX_SCENE_OBJECTS),
  })
  .strict();

type OrderedSceneObjects = {
  drawings: z.infer<typeof sceneDrawingLayersSchema>;
  images: z.infer<typeof sceneImageLayersSchema>;
  objectOrder: z.infer<typeof sceneObjectOrderLayersSchema>;
  shapes: z.infer<typeof sceneShapeLayersSchema>;
  texts: z.infer<typeof sceneTextLayersSchema>;
};

function validObjectOrder(state: OrderedSceneObjects): boolean {
  return (['map', 'token', 'gm'] as const).every((layer) => {
    const expected = [
      ...state.images[layer],
      ...state.drawings[layer],
      ...state.shapes[layer],
      ...state.texts[layer],
    ].map((object) => object.id);
    const order = state.objectOrder[layer];
    return order.length === expected.length &&
      new Set(order).size === order.length &&
      expected.every((id) => order.includes(id));
  });
}

function uniqueObjectIds(state: Omit<OrderedSceneObjects, 'objectOrder'>): boolean {
  const imageIds = Object.values(state.images).flat().map((image) => image.id);
  const drawingIds = Object.values(state.drawings).flat().map((drawing) => drawing.id);
  const textIds = Object.values(state.texts).flat().map((text) => text.id);
  const shapeIds = Object.values(state.shapes).flat().map((shape) => shape.id);
  const ids = [...imageIds, ...drawingIds, ...shapeIds, ...textIds];
  return new Set(ids).size === ids.length;
}

export const sceneObjectStateSchema = z
  .object({
    drawings: sceneDrawingLayersSchema,
    images: sceneImageLayersSchema,
    mapImage: sceneMapImageSchema.nullable(),
    objectOrder: sceneObjectOrderLayersSchema,
    shapes: sceneShapeLayersSchema,
    texts: sceneTextLayersSchema,
  })
  .strict()
  .refine(uniqueObjectIds, 'Scene object IDs must be unique.')
  .refine(validObjectOrder, 'Scene object order must contain every object in its layer exactly once.');

export const sceneRecordSchema = z
  .object({
    createdAt: z.string().datetime(),
    distance: bounded(sceneBounds.distance),
    fog: sceneFogSchema,
    grid: sceneGridSchema,
    height: boundedInteger(sceneBounds.height),
    id: z.string().uuid(),
    drawings: sceneDrawingLayersSchema,
    images: sceneImageLayersSchema,
    mapImage: sceneMapImageSchema.nullable(),
    name: z.string().min(sceneBounds.name.min).max(sceneBounds.name.max),
    objectOrder: sceneObjectOrderLayersSchema,
    pixelScale: bounded(sceneBounds.pixelScale),
    revision: z.number().int().nonnegative(),
    shapes: sceneShapeLayersSchema,
    unit: z.string().max(sceneBounds.unit.max),
    updatedAt: z.string().datetime(),
    width: boundedInteger(sceneBounds.width),
    texts: sceneTextLayersSchema,
  })
  .strict()
  .refine(uniqueObjectIds, 'Scene object IDs must be unique.')
  .refine(validObjectOrder, 'Scene object order must contain every object in its layer exactly once.');

export const sceneManifestSchema = z
  .object({
    activeSceneId: z.string().uuid().nullable(),
    revision: z.number().int().nonnegative(),
    scenes: z.array(sceneRecordSchema).max(1024),
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

export const sceneShapeTransformSchema = sceneImageTransformSchema.extend({
  spread: bounded(sceneBounds.shapeSpread).optional(),
});

export const sceneObjectTransformSchema = z.union([
  sceneShapeTransformSchema,
  sceneDrawingTransformSchema,
]);

export type SceneGrid = z.infer<typeof sceneGridSchema>;
export type SceneFogPoint = z.infer<typeof sceneFogPointSchema>;
export type SceneFogOperation = z.infer<typeof sceneFogOperationSchema>;
export type SceneFog = z.infer<typeof sceneFogSchema>;
export type SceneGridType = SceneGrid['type'];
export type SceneImageTransform = z.infer<typeof sceneImageTransformSchema>;
export type SceneMapImage = z.infer<typeof sceneMapImageSchema>;
export type SceneImage = z.infer<typeof sceneImageSchema>;
export type SceneImageLayers = z.infer<typeof sceneImageLayersSchema>;
export type SceneImageLayer = SceneLayer;
export type SceneDrawingPoint = z.infer<typeof sceneDrawingPointSchema>;
export type SceneDrawingTransform = z.infer<typeof sceneDrawingTransformSchema>;
export type SceneObjectTransform = z.infer<typeof sceneObjectTransformSchema>;
export type SceneDrawingStyle = z.infer<typeof sceneDrawingStyleSchema>;
export type SceneDrawingEdge = SceneDrawingStyle['edge'];
export type SceneDrawing = z.infer<typeof sceneDrawingSchema>;
export type SceneDrawingKind = SceneDrawing['kind'];
export type SceneDrawingLayers = z.infer<typeof sceneDrawingLayersSchema>;
export type SceneDrawingLayer = SceneLayer;
export type SceneTextTransform = z.infer<typeof sceneTextTransformSchema>;
export type SceneTextFamily = z.infer<typeof sceneTextFamilySchema>;
export type SceneTextWeight = z.infer<typeof sceneTextWeightSchema>;
export type SceneTextStyle = z.infer<typeof sceneTextStyleSchema>;
export type SceneText = z.infer<typeof sceneTextSchema>;
export type SceneTextLayers = z.infer<typeof sceneTextLayersSchema>;
export type SceneTextLayer = SceneLayer;
export type SceneShapeStyle = z.infer<typeof sceneShapeStyleSchema>;
export type SceneShape = z.infer<typeof sceneShapeSchema>;
export type SceneShapeKind = SceneShape['kind'];
export type SceneShapeLayers = z.infer<typeof sceneShapeLayersSchema>;
export type SceneObjectOrderLayers = z.infer<typeof sceneObjectOrderLayersSchema>;
export type SceneShapeLayer = SceneLayer;
export type SceneObjectState = z.infer<typeof sceneObjectStateSchema>;
export type SceneRecord = z.infer<typeof sceneRecordSchema>;
export type SceneManifest = z.infer<typeof sceneManifestSchema>;
export type ScenePatch = z.infer<typeof scenePatchSchema>;
