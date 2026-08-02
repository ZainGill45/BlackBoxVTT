import type { SceneShapeStyle } from '../../shared/scenes';
import {
  SCENE_TEXT_FAMILIES,
  SCENE_TEXT_WEIGHTS,
  sceneBounds,
} from '../../shared/scenes';
import type { PlaySession } from './types';

export type ShapeSubtool = 'sphere' | 'square' | 'cone';
export type ShapeSettings = SceneShapeStyle;

export const DEFAULT_SHAPE_SETTINGS: ShapeSettings = {
  backgroundColor: '#ffffff',
  backgroundOpacity: 0.3,
  backgroundType: 'crosshatched',
  fontColor: '#ffffff',
  fontFamily: 'inter',
  fontSize: 16,
  fontStrokeColor: '#000000',
  fontStrokeWidth: 2,
  fontWeight: 400,
  strokeColor: '#ffffff',
  strokeOpacity: 1,
  strokeType: 'solid',
  strokeWidth: 2,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BACKGROUNDS = new Set(['fill', 'crosshatched', 'transparent']);
const STROKES = new Set(['solid', 'dashed', 'dotted']);
const FAMILIES = new Set<string>(SCENE_TEXT_FAMILIES);
const WEIGHTS = new Set<number>(SCENE_TEXT_WEIGHTS);

const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback;

export function normalizeShapeSettings(value: unknown): ShapeSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SHAPE_SETTINGS };
  }
  const input = value as Partial<ShapeSettings>;
  return {
    backgroundColor: color(
      input.backgroundColor,
      DEFAULT_SHAPE_SETTINGS.backgroundColor,
    ),
    backgroundOpacity: bounded(
      input.backgroundOpacity,
      DEFAULT_SHAPE_SETTINGS.backgroundOpacity,
      0,
      1,
    ),
    backgroundType: BACKGROUNDS.has(input.backgroundType ?? '')
      ? input.backgroundType!
      : DEFAULT_SHAPE_SETTINGS.backgroundType,
    fontColor: color(input.fontColor, DEFAULT_SHAPE_SETTINGS.fontColor),
    fontFamily: FAMILIES.has(input.fontFamily ?? '')
      ? input.fontFamily!
      : DEFAULT_SHAPE_SETTINGS.fontFamily,
    fontSize: bounded(
      input.fontSize,
      DEFAULT_SHAPE_SETTINGS.fontSize,
      sceneBounds.shapeFontSize.min,
      sceneBounds.shapeFontSize.max,
    ),
    fontStrokeColor: color(
      input.fontStrokeColor,
      DEFAULT_SHAPE_SETTINGS.fontStrokeColor,
    ),
    fontStrokeWidth: bounded(
      input.fontStrokeWidth,
      DEFAULT_SHAPE_SETTINGS.fontStrokeWidth,
      sceneBounds.shapeFontStrokeWidth.min,
      sceneBounds.shapeFontStrokeWidth.max,
    ),
    fontWeight: WEIGHTS.has(input.fontWeight ?? 0)
      ? input.fontWeight!
      : DEFAULT_SHAPE_SETTINGS.fontWeight,
    strokeColor: color(input.strokeColor, DEFAULT_SHAPE_SETTINGS.strokeColor),
    strokeOpacity: bounded(
      input.strokeOpacity,
      DEFAULT_SHAPE_SETTINGS.strokeOpacity,
      0,
      1,
    ),
    strokeType: STROKES.has(input.strokeType ?? '')
      ? input.strokeType!
      : DEFAULT_SHAPE_SETTINGS.strokeType,
    strokeWidth: bounded(
      input.strokeWidth,
      DEFAULT_SHAPE_SETTINGS.strokeWidth,
      sceneBounds.shapeStrokeWidth.min,
      sceneBounds.shapeStrokeWidth.max,
    ),
  };
}

export function shapeSettingsStorageKey(session: PlaySession): string {
  const owner = session.role === 'gm' ? 'gm' : `player-${session.userId}`;
  return `blackboxvtt:shape:${session.campaignId}:${owner}`;
}

export function loadShapeSettings(session: PlaySession): ShapeSettings {
  try {
    const stored = localStorage.getItem(shapeSettingsStorageKey(session));
    return normalizeShapeSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_SHAPE_SETTINGS };
  }
}

export function saveShapeSettings(
  session: PlaySession,
  settings: ShapeSettings,
): void {
  try {
    localStorage.setItem(
      shapeSettingsStorageKey(session),
      JSON.stringify(normalizeShapeSettings(settings)),
    );
  } catch {
    // Shape creation remains usable when browser storage is unavailable.
  }
}
