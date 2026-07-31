import type { Result } from './result';

export const SCENE_MANIFEST_SCHEMA_VERSION = 4 as const;
export const MAX_SCENE_IMAGES = 2_048;
export const MAX_SCENE_DRAWINGS = 1_024;
export const MAX_DRAWING_POINTS = 4_096;
export const MAX_SCENE_DRAWING_POINTS = 20_000;
export const MAX_DRAWING_HISTORY = 100;
export const DRAWING_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_FREEFORM_WIDTH = 12;
export const DEFAULT_POLYLINE_WIDTH = 6;
export const DEFAULT_DRAWING_COLOR = '#ffffff';
export const DEFAULT_DRAWING_OPACITY = 1;
export const DEFAULT_DRAWING_FILL_OPACITY = 0.25;
export const DEFAULT_FREEFORM_HARDNESS = 1;

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
  setImages: 'scenes:set-images',
  undo: 'scenes:undo',
  redo: 'scenes:redo',
  trash: 'scenes:trash',
  update: 'scenes:update',
} as const;

export const DEFAULT_SCENE_NAME = 'New Scene';
export const DEFAULT_SCENE_WIDTH = 1750;
export const DEFAULT_SCENE_HEIGHT = 1750;
export const DEFAULT_SCENE_PIXEL_SCALE = 100;
export const DEFAULT_SCENE_DISTANCE = 5;
export const DEFAULT_SCENE_UNIT = 'ft';
export const DEFAULT_GRID_SIZE = 70;
export const DEFAULT_GRID_LINE_THICKNESS = 1;
export const DEFAULT_GRID_COLOR = '#ffffff';
export const DEFAULT_GRID_OPACITY = 0.15;

/**
 * Every bound lives here so the repository, the IPC layer, the TCP schema, and
 * the settings form all reject the same values.
 */
export const sceneBounds = {
  distance: { max: 10_000, min: 0.01 },
  gridLineThickness: { max: 32, min: 1 },
  gridOffset: { max: 4096, min: -4096 },
  gridOpacity: { max: 1, min: 0 },
  gridSize: { max: 4096, min: 4 },
  height: { max: 20_000, min: 1 },
  name: { max: 64, min: 1 },
  pixelScale: { max: 4096, min: 1 },
  rotation: { max: 360, min: -360 },
  unit: { max: 16, min: 0 },
  width: { max: 20_000, min: 1 },
  drawingScale: { max: 1_000, min: 0.001 },
  drawingHardness: { max: 1, min: 0 },
  drawingWidth: { max: 256, min: 1 },
} as const;

export const GRID_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const GRID_COLOR_PRESETS = [
  '#ffffff',
  '#000000',
  '#e02b2b',
  '#2b6ee0',
  '#2bad50',
  '#e0c22b',
] as const;

export type SceneGridType = 'gridless' | 'square';

export interface SceneGrid {
  color: string;
  lineThickness: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  size: number;
  type: SceneGridType;
}

export interface SceneImageTransform {
  height: number;
  /** Degrees clockwise around the image centre. */
  rotation: number;
  width: number;
  /** Centre position in scene coordinates. */
  x: number;
  y: number;
}

export interface SceneMapImage extends SceneImageTransform {
  assetId: string;
}

export type SceneImageLayer = 'map' | 'token' | 'gm';

export interface SceneImage extends SceneMapImage {
  id: string;
}

export interface SceneImageLayers {
  gm: SceneImage[];
  map: SceneImage[];
  token: SceneImage[];
}

export type SceneDrawingKind = 'freeform' | 'polyline';
export type SceneDrawingEdge = 'hard' | 'soft';

export interface SceneDrawingPoint {
  x: number;
  y: number;
}

export interface SceneDrawingTransform {
  rotation: number;
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

export type SceneObjectTransform =
  | SceneImageTransform
  | SceneDrawingTransform;

export interface SceneDrawingStyle {
  edge: SceneDrawingEdge;
  fillColor: string;
  fillEnabled: boolean;
  fillOpacity: number;
  hardness: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface SceneDrawing extends SceneDrawingTransform {
  closed: boolean;
  id: string;
  kind: SceneDrawingKind;
  /** Null is the local game master; remote owners are authenticated user IDs. */
  ownerId: string | null;
  points: SceneDrawingPoint[];
  revision: number;
  style: SceneDrawingStyle;
}

export interface SceneDrawingLayers {
  gm: SceneDrawing[];
  map: SceneDrawing[];
  token: SceneDrawing[];
}

export type SceneDrawingLayer = SceneImageLayer;

export interface SceneImageState {
  drawings: SceneDrawingLayers;
  images: SceneImageLayers;
  mapImage: SceneMapImage | null;
}

export interface SceneRecord {
  createdAt: string;
  distance: number;
  grid: SceneGrid;
  height: number;
  id: string;
  drawings: SceneDrawingLayers;
  images: SceneImageLayers;
  mapImage: SceneMapImage | null;
  name: string;
  /** Scene pixels that measure one `distance` of `unit`. */
  pixelScale: number;
  revision: number;
  unit: string;
  updatedAt: string;
  width: number;
}

export interface SceneManifest {
  activeSceneId: string | null;
  revision: number;
  scenes: SceneRecord[];
  schemaVersion: typeof SCENE_MANIFEST_SCHEMA_VERSION;
}

export type ScenePatch = Partial<
  Pick<
    SceneRecord,
    | 'distance'
    | 'height'
    | 'mapImage'
    | 'name'
    | 'pixelScale'
    | 'unit'
    | 'width'
  >
> & {
  grid?: Partial<SceneGrid>;
};

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

export interface SceneCampaignInput {
  campaignId: string;
}

export interface SceneAssetInput extends SceneCampaignInput {
  assetId: string;
}

export interface PresentSceneInput extends SceneCampaignInput {
  sceneId: string | null;
}

export interface UpdateSceneInput extends SceneCampaignInput {
  expectedRevision: number;
  patch: ScenePatch;
  sceneId: string;
}

export interface SetSceneImagesInput extends SceneCampaignInput {
  expectedRevision: number;
  sceneId: string;
  state: SceneImageState;
}

export interface SetSceneObjectsInput extends SetSceneImagesInput {
  operationId: string;
}

export interface SceneHistoryInput extends SceneCampaignInput {
  sceneId: string;
}

export type SceneEditActor =
  | { kind: 'gm' }
  | { kind: 'player'; userId: string };

export interface SceneTransformPreviewStart extends SceneCampaignInput {
  kind: 'move' | 'nudge' | 'resize' | 'rotate';
  operationId: string;
  pivotX: number;
  pivotY: number;
  revision: number;
  sceneId: string;
  startingTransforms: Array<{
    id: string;
    transform: SceneObjectTransform;
  }>;
  targets: string[];
}

export interface SceneTransformPreviewDelta extends SceneCampaignInput {
  absolute?: SceneObjectTransform;
  dx: number;
  dy: number;
  operationId: string;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface SceneTransformPreviewCancel extends SceneCampaignInput {
  operationId: string;
  sceneId: string;
}

export interface TrashSceneInput extends SceneCampaignInput {
  expectedRevision: number;
  sceneId: string;
}

export interface SceneChangedEvent {
  campaignId: string;
  manifest: SceneManifest;
}

export interface SceneApi {
  create(input: SceneCampaignInput): Promise<SceneResult<SceneRecord>>;
  detachAsset(input: SceneAssetInput): Promise<SceneResult<null>>;
  findDependents(input: SceneAssetInput): Promise<SceneResult<SceneRecord[]>>;
  list(input: SceneCampaignInput): Promise<SceneResult<SceneManifest>>;
  onChanged(listener: (event: SceneChangedEvent) => void): () => void;
  present(input: PresentSceneInput): Promise<SceneResult<SceneManifest>>;
  previewCancel?(input: SceneTransformPreviewCancel): Promise<void>;
  previewStart?(input: SceneTransformPreviewStart): Promise<void>;
  previewUpdate?(input: SceneTransformPreviewDelta): Promise<void>;
  setObjects?(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>>;
  setImages?(input: SetSceneImagesInput): Promise<SceneResult<SceneRecord>>;
  undo?(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  redo?(input: SceneHistoryInput): Promise<SceneResult<SceneRecord>>;
  trash(input: TrashSceneInput): Promise<SceneResult<null>>;
  update(input: UpdateSceneInput): Promise<SceneResult<SceneRecord>>;
}

export function createEmptyImageLayers(): SceneImageLayers {
  return { gm: [], map: [], token: [] };
}

export function createEmptyDrawingLayers(): SceneDrawingLayers {
  return { gm: [], map: [], token: [] };
}

export function imageStateOf(scene: SceneRecord): SceneImageState {
  const images = scene.images;
  const drawings = scene.drawings;
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
  };
}

export function projectSceneForPlayer(scene: SceneRecord): SceneRecord {
  const images = scene.images;
  const drawings = scene.drawings;
  return {
    ...scene,
    drawings: { ...drawings, gm: [] },
    images: { ...images, gm: [] },
  };
}

export function createEmptySceneManifest(): SceneManifest {
  return {
    activeSceneId: null,
    revision: 0,
    scenes: [],
    schemaVersion: SCENE_MANIFEST_SCHEMA_VERSION,
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
