export const SCENE_MANIFEST_SCHEMA_VERSION = 8 as const;
export const CANONICAL_MAP_ID = 'canonical-map';
export const MAX_SCENE_IMAGES = 2_048;
export const MAX_SCENE_DRAWINGS = 1_024;
export const MAX_SCENE_TEXTS = 1_024;
export const MAX_SCENE_SHAPES = 1_024;
export const MAX_DRAWING_POINTS = 4_096;
export const MAX_SCENE_DRAWING_POINTS = 20_000;
export const MAX_TEXT_CHARACTERS = 2_048;
export const MAX_TEXT_LINES = 32;
export const MAX_SCENE_TEXT_CHARACTERS = 65_536;
export const MAX_TEXT_RASTER_DIMENSION = 8_192;
export const MAX_TEXT_RASTER_PIXELS = 8_388_608;
export const MAX_SCENE_TEXT_RASTER_PIXELS = 67_108_864;
export const SCENE_TEXT_TEXTURE_RESOLUTION = 2;
export const MAX_SCENE_OBJECTS =
  MAX_SCENE_IMAGES + MAX_SCENE_DRAWINGS + MAX_SCENE_TEXTS +
  MAX_SCENE_SHAPES + 1;
export const MAX_SCENE_EDIT_HISTORY = 100;
export const SCENE_OBJECT_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_FREEFORM_WIDTH = 16;
export const DEFAULT_POLYLINE_WIDTH = 16;
export const DEFAULT_DRAWING_COLOR = '#ffffff';
export const DEFAULT_DRAWING_OPACITY = 1;
export const DEFAULT_DRAWING_FILL_OPACITY = 0.25;
export const DEFAULT_FREEFORM_HARDNESS = 1;

export const SCENE_LAYERS = ['map', 'token', 'gm'] as const;
export type SceneLayer = (typeof SCENE_LAYERS)[number];

export const SCENE_TEXT_FAMILIES = [
  'inter',
  'lora',
  'roboto-mono',
  'cinzel',
] as const;
export const SCENE_TEXT_WEIGHTS = [400, 500, 600, 700] as const;
export const SCENE_TEXT_FAMILY_LABELS: Record<
  (typeof SCENE_TEXT_FAMILIES)[number],
  string
> = {
  cinzel: 'Cinzel',
  inter: 'Inter',
  lora: 'Lora',
  'roboto-mono': 'Roboto Mono',
};
export const SCENE_TEXT_WEIGHT_LABELS: Record<
  (typeof SCENE_TEXT_WEIGHTS)[number],
  string
> = {
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
};

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

/** Shared bounds for storage, IPC, network validation, and renderer forms. */
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
  textFontSize: { max: 256, min: 8 },
  textStrokeWidth: { max: 32, min: 0 },
  shapeFontSize: { max: 256, min: 8 },
  shapeFontStrokeWidth: { max: 32, min: 0 },
  shapeStrokeWidth: { max: 32, min: 1 },
  shapeSpread: { max: 179, min: 1 },
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
