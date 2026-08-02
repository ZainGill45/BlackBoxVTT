import { sceneBounds } from '../../shared/scenes';
import type { PlaySession } from './types';

export type FogMode = 'hide' | 'reveal';
export type FogSubtool = 'box' | 'brush';

export interface FogToolSettings {
  brushHardness: number;
  brushWidth: number;
  gmOpacity: number;
}

export const DEFAULT_FOG_TOOL_SETTINGS: FogToolSettings = {
  brushHardness: 1,
  brushWidth: 70,
  gmOpacity: 0.35,
};

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeFogToolSettings(value: unknown): FogToolSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_FOG_TOOL_SETTINGS };
  }
  const input = value as Partial<FogToolSettings>;
  return {
    brushHardness: bounded(input.brushHardness, 1, 0, 1),
    brushWidth: bounded(
      input.brushWidth,
      DEFAULT_FOG_TOOL_SETTINGS.brushWidth,
      sceneBounds.fogBrushWidth.min,
      sceneBounds.fogBrushWidth.max,
    ),
    gmOpacity: bounded(
      input.gmOpacity,
      DEFAULT_FOG_TOOL_SETTINGS.gmOpacity,
      0,
      1,
    ),
  };
}

export function fogSettingsStorageKey(session: PlaySession): string {
  return `blackboxvtt:fog:${session.campaignId}:gm`;
}

export function loadFogToolSettings(session: PlaySession): FogToolSettings {
  try {
    const stored = localStorage.getItem(fogSettingsStorageKey(session));
    return normalizeFogToolSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_FOG_TOOL_SETTINGS };
  }
}

export function saveFogToolSettings(
  session: PlaySession,
  settings: FogToolSettings,
): void {
  try {
    localStorage.setItem(
      fogSettingsStorageKey(session),
      JSON.stringify(normalizeFogToolSettings(settings)),
    );
  } catch {
    // Fog remains usable when browser storage is unavailable.
  }
}
