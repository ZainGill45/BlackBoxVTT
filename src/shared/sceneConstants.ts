export const SCENE_MANIFEST_SCHEMA_VERSION = 4 as const;
export const MAX_SCENE_IMAGES = 2_048;
export const MAX_SCENE_DRAWINGS = 1_024;
export const MAX_DRAWING_POINTS = 4_096;
export const MAX_SCENE_DRAWING_POINTS = 20_000;
export const MAX_DRAWING_HISTORY = 100;
export const DRAWING_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_FREEFORM_WIDTH = 16;
export const DEFAULT_POLYLINE_WIDTH = 16;
export const DEFAULT_DRAWING_COLOR = '#ffffff';
export const DEFAULT_DRAWING_OPACITY = 1;
export const DEFAULT_DRAWING_FILL_OPACITY = 0.25;
export const DEFAULT_FREEFORM_HARDNESS = 1;

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
