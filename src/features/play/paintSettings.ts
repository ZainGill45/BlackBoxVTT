import {
  DEFAULT_DRAWING_COLOR,
  DEFAULT_DRAWING_FILL_OPACITY,
  DEFAULT_DRAWING_OPACITY,
  DEFAULT_FREEFORM_HARDNESS,
  DEFAULT_FREEFORM_WIDTH,
  DEFAULT_POLYLINE_WIDTH,
  type SceneDrawingStyle,
} from '../../shared/scenes';
import type { PlaySession } from './types';

export type PaintSubtool = 'freeform' | 'polyline';

export interface FreeformPaintSettings {
  color: string;
  hardness: number;
  opacity: number;
  width: number;
}

export interface PolylinePaintSettings {
  color: string;
  fillColor: string;
  fillColorLinked: boolean;
  fillEnabled: boolean;
  fillOpacity: number;
  opacity: number;
  width: number;
}

export interface PaintSettings {
  freeform: FreeformPaintSettings;
  polyline: PolylinePaintSettings;
}

export const DEFAULT_PAINT_SETTINGS: PaintSettings = {
  freeform: {
    color: DEFAULT_DRAWING_COLOR,
    hardness: DEFAULT_FREEFORM_HARDNESS,
    opacity: DEFAULT_DRAWING_OPACITY,
    width: DEFAULT_FREEFORM_WIDTH,
  },
  polyline: {
    color: DEFAULT_DRAWING_COLOR,
    fillColor: DEFAULT_DRAWING_COLOR,
    fillColorLinked: true,
    fillEnabled: false,
    fillOpacity: DEFAULT_DRAWING_FILL_OPACITY,
    opacity: DEFAULT_DRAWING_OPACITY,
    width: DEFAULT_POLYLINE_WIDTH,
  },
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function normalizePaintSettings(value: unknown): PaintSettings {
  if (!value || typeof value !== 'object') {
    return structuredClone(DEFAULT_PAINT_SETTINGS);
  }
  const input = value as Partial<PaintSettings>;
  const freeform = input.freeform ?? DEFAULT_PAINT_SETTINGS.freeform;
  const polyline = input.polyline ?? DEFAULT_PAINT_SETTINGS.polyline;
  return {
    freeform: {
      color: color(freeform.color, DEFAULT_DRAWING_COLOR),
      hardness: bounded(
        freeform.hardness,
        DEFAULT_FREEFORM_HARDNESS,
        0,
        1,
      ),
      opacity: bounded(freeform.opacity, DEFAULT_DRAWING_OPACITY, 0.01, 1),
      width: bounded(freeform.width, DEFAULT_FREEFORM_WIDTH, 1, 256),
    },
    polyline: {
      color: color(polyline.color, DEFAULT_DRAWING_COLOR),
      fillColor: color(polyline.fillColor, DEFAULT_DRAWING_COLOR),
      fillColorLinked: polyline.fillColorLinked !== false,
      fillEnabled: polyline.fillEnabled === true,
      fillOpacity: bounded(
        polyline.fillOpacity,
        DEFAULT_DRAWING_FILL_OPACITY,
        0.01,
        1,
      ),
      opacity: bounded(polyline.opacity, DEFAULT_DRAWING_OPACITY, 0.01, 1),
      width: bounded(polyline.width, DEFAULT_POLYLINE_WIDTH, 1, 256),
    },
  };
}

export function paintSettingsStorageKey(session: PlaySession): string {
  const owner =
    session.role === 'gm' ? 'gm' : `player-${session.userId}`;
  return `blackboxvtt:paint:${session.campaignId}:${owner}`;
}

export function loadPaintSettings(session: PlaySession): PaintSettings {
  try {
    const stored = localStorage.getItem(paintSettingsStorageKey(session));
    return normalizePaintSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return structuredClone(DEFAULT_PAINT_SETTINGS);
  }
}

export function savePaintSettings(
  session: PlaySession,
  settings: PaintSettings,
): void {
  try {
    localStorage.setItem(
      paintSettingsStorageKey(session),
      JSON.stringify(normalizePaintSettings(settings)),
    );
  } catch {
    // Paint remains usable when browser storage is unavailable.
  }
}

export function drawingStyle(
  settings: PaintSettings,
  subtool: PaintSubtool,
): SceneDrawingStyle {
  if (subtool === 'freeform') {
    return {
      edge: settings.freeform.hardness < 1 ? 'soft' : 'hard',
      fillColor: settings.freeform.color,
      fillEnabled: false,
      fillOpacity: settings.freeform.opacity,
      hardness: settings.freeform.hardness,
      strokeColor: settings.freeform.color,
      strokeOpacity: settings.freeform.opacity,
      strokeWidth: settings.freeform.width,
    };
  }
  return {
    edge: 'hard',
    fillColor: settings.polyline.fillColor,
    fillEnabled: settings.polyline.fillEnabled,
    fillOpacity: settings.polyline.fillOpacity,
    hardness: 1,
    strokeColor: settings.polyline.color,
    strokeOpacity: settings.polyline.opacity,
    strokeWidth: settings.polyline.width,
  };
}

const PAINT_WIDTH_STEPS = [
  ...Array.from({ length: 10 }, (_, index) => index + 1),
  ...Array.from({ length: 8 }, (_, index) => 15 + index * 5),
  ...Array.from({ length: 20 }, (_, index) => 60 + index * 10),
  256,
];

export function stepPaintWidth(
  width: number,
  direction: -1 | 1,
): number {
  if (direction > 0) {
    return PAINT_WIDTH_STEPS.find((candidate) => candidate > width) ?? 256;
  }
  return (
    PAINT_WIDTH_STEPS.findLast((candidate) => candidate < width) ?? 1
  );
}
