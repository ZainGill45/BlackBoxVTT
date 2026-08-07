import type { Result } from './result';
import type {
  SceneDrawingLayers,
  SceneFog,
  SceneGrid,
  SceneImageLayers,
  SceneObjectState,
  SceneObjectOrderLayers,
  SceneManifest,
  SceneRecord,
  SceneShapeLayers,
  SceneTextLayers,
} from './sceneSchema';
import type {
  PresentSceneInput,
  SceneAssetInput,
  SceneCampaignInput,
  SceneChangedEvent,
  SceneHistoryInput,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
  SetSceneImagesInput,
  SetSceneObjectsInput,
  SetSceneFogInput,
  TrashSceneInput,
  UpdateSceneInput,
} from './sceneContracts';

export * from './sceneConstants';
export * from './sceneTextMetrics';
export * from './sceneTransformPreview';
export type {
  SceneDrawing,
  SceneDrawingEdge,
  SceneDrawingKind,
  SceneDrawingLayer,
  SceneDrawingLayers,
  SceneDrawingPoint,
  SceneDrawingStyle,
  SceneDrawingTransform,
  SceneFog,
  SceneFogOperation,
  SceneFogPoint,
  SceneGrid,
  SceneGridType,
  SceneImage,
  SceneImageLayer,
  SceneImageLayers,
  SceneObjectState,
  SceneObjectOrderLayers,
  SceneImageTransform,
  SceneManifest,
  SceneMapImage,
  SceneObjectTransform,
  ScenePatch,
  SceneRecord,
  SceneText,
  SceneTextFamily,
  SceneTextLayer,
  SceneTextLayers,
  SceneTextStyle,
  SceneTextTransform,
  SceneTextWeight,
  SceneShape,
  SceneShapeKind,
  SceneShapeLayer,
  SceneShapeLayers,
  SceneShapeStyle,
} from './sceneSchema';
export * from './sceneContracts';
import {
  DEFAULT_FOG_COLOR,
  DEFAULT_GRID_COLOR,
  DEFAULT_GRID_LINE_THICKNESS,
  DEFAULT_GRID_OPACITY,
  DEFAULT_GRID_SIZE,
  SCENE_LAYERS,
} from './sceneConstants';

export const sceneIpcChannels = {
  changed: 'scenes:changed',
  create: 'scenes:create',
  detachAsset: 'scenes:detach-asset',
  findDependents: 'scenes:find-dependents',
  list: 'scenes:list',
  present: 'scenes:present',
  previewCancel: 'scenes:preview-cancel',
  previewStart: 'scenes:preview-start',
  previewUpdate: 'scenes:preview-update',
  setObjects: 'scenes:set-objects',
  setFog: 'scenes:set-fog',
  setImages: 'scenes:set-images',
  undo: 'scenes:undo',
  redo: 'scenes:redo',
  trash: 'scenes:trash',
  update: 'scenes:update',
} as const;

export type SceneErrorCode =
  | 'conflict'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'storage_error'
  | 'unavailable';

export interface SceneError {
  code: SceneErrorCode;
  message: string;
  sceneId?: string;
}

export type SceneResult<T> = Result<T, SceneError>;

export interface SceneApi {
  create(input: SceneCampaignInput): Promise<SceneResult<SceneRecord>>;
  detachAsset(input: SceneAssetInput): Promise<SceneResult<null>>;
  findDependents(input: SceneAssetInput): Promise<SceneResult<SceneRecord[]>>;
  list(input: SceneCampaignInput): Promise<SceneResult<SceneManifest>>;
  onChanged(listener: (event: SceneChangedEvent) => void): () => void;
  present(input: PresentSceneInput): Promise<SceneResult<SceneManifest>>;
  previewCancel(input: SceneTransformPreviewCancel): Promise<void>;
  previewStart(input: SceneTransformPreviewStart): Promise<void>;
  previewUpdate(input: SceneTransformPreviewDelta): Promise<void>;
  setObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>>;
  setFog(input: SetSceneFogInput): Promise<SceneResult<SceneRecord>>;
  setImages(input: SetSceneImagesInput): Promise<SceneResult<SceneRecord>>;
  undo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  redo(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  trash(input: TrashSceneInput): Promise<SceneResult<null>>;
  update(input: UpdateSceneInput): Promise<SceneResult<SceneRecord>>;
}

export function createEmptyImageLayers(): SceneImageLayers {
  return { gm: [], map: [], token: [] };
}

export function createEmptyDrawingLayers(): SceneDrawingLayers {
  return { gm: [], map: [], token: [] };
}

export function createEmptyTextLayers(): SceneTextLayers {
  return { gm: [], map: [], token: [] };
}

export function createEmptyShapeLayers(): SceneShapeLayers {
  return { gm: [], map: [], token: [] };
}

export function createEmptyObjectOrderLayers(): SceneObjectOrderLayers {
  return { gm: [], map: [], token: [] };
}

export function createDefaultFog(): SceneFog {
  return {
    base: 'clear',
    color: DEFAULT_FOG_COLOR,
    operations: [],
  };
}

export function createSceneObjectOrder(
  state: Pick<
    SceneObjectState,
    'drawings' | 'images' | 'shapes' | 'texts'
  >,
): SceneObjectOrderLayers {
  const order = createEmptyObjectOrderLayers();
  for (const layer of SCENE_LAYERS) {
    order[layer] = [
      ...state.shapes[layer],
      ...state.images[layer],
      ...state.drawings[layer],
      ...state.texts[layer],
    ].map((object) => object.id);
  }
  return order;
}

export function sceneObjectStateOf(scene: SceneRecord): SceneObjectState {
  const images = scene.images;
  const drawings = scene.drawings;
  const texts = scene.texts;
  const shapes = scene.shapes;
  return {
    drawings: {
      gm: drawings.gm.map((drawing) => structuredClone(drawing)),
      map: drawings.map.map((drawing) => structuredClone(drawing)),
      token: drawings.token.map((drawing) => structuredClone(drawing)),
    },
    images: {
      gm: images.gm.map((image) => ({ ...image })),
      map: images.map.map((image) => ({ ...image })),
      token: images.token.map((image) => ({ ...image })),
    },
    mapImage: scene.mapImage ? { ...scene.mapImage } : null,
    objectOrder: {
      gm: [...scene.objectOrder.gm],
      map: [...scene.objectOrder.map],
      token: [...scene.objectOrder.token],
    },
    shapes: {
      gm: shapes.gm.map((shape) => structuredClone(shape)),
      map: shapes.map.map((shape) => structuredClone(shape)),
      token: shapes.token.map((shape) => structuredClone(shape)),
    },
    texts: {
      gm: texts.gm.map((text) => structuredClone(text)),
      map: texts.map.map((text) => structuredClone(text)),
      token: texts.token.map((text) => structuredClone(text)),
    },
  };
}

export function projectSceneForPlayer(scene: SceneRecord): SceneRecord {
  const images = scene.images;
  const drawings = scene.drawings;
  const texts = scene.texts;
  const shapes = scene.shapes;
  return {
    ...scene,
    drawings: { ...drawings, gm: [] },
    images: { ...images, gm: [] },
    objectOrder: { ...scene.objectOrder, gm: [] },
    shapes: { ...shapes, gm: [] },
    texts: { ...texts, gm: [] },
  };
}

export function createEmptySceneManifest(): SceneManifest {
  return {
    activeSceneId: null,
    revision: 0,
    scenes: [],
  };
}

export function createDefaultGrid(): SceneGrid {
  return {
    color: DEFAULT_GRID_COLOR,
    lineThickness: DEFAULT_GRID_LINE_THICKNESS,
    offsetX: 0,
    offsetY: 0,
    opacity: DEFAULT_GRID_OPACITY,
    size: DEFAULT_GRID_SIZE,
    type: 'square',
  };
}

export function normalizeSceneName(name: string): string {
  return name.normalize('NFKC').trim();
}

export function findScene(
  manifest: SceneManifest,
  sceneId: string | null,
): SceneRecord | null {
  if (!sceneId) {
    return null;
  }
  return manifest.scenes.find((scene) => scene.id === sceneId) ?? null;
}

export function describeScene(scene: SceneRecord): string {
  return `${scene.width} × ${scene.height}`;
}
