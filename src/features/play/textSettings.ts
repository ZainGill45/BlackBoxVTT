import type {
  PlaySession,
} from './types';
import type {
  SceneTextStyle,
} from '../../shared/scenes';
import {
  SCENE_TEXT_FAMILIES,
  SCENE_TEXT_WEIGHTS,
  sceneBounds,
} from '../../shared/scenes';

export type TextSettings = SceneTextStyle;

export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  fontFamily: 'inter',
  fontSize: 64,
  fontWeight: 400,
  primaryColor: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 8,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const FAMILIES = new Set<string>(SCENE_TEXT_FAMILIES);
const WEIGHTS = new Set<number>(SCENE_TEXT_WEIGHTS);

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function normalizeTextSettings(value: unknown): TextSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_TEXT_SETTINGS };
  }
  const input = value as Partial<TextSettings>;
  return {
    fontFamily: FAMILIES.has(input.fontFamily ?? '')
      ? input.fontFamily!
      : DEFAULT_TEXT_SETTINGS.fontFamily,
    fontSize: bounded(
      input.fontSize,
      DEFAULT_TEXT_SETTINGS.fontSize,
      sceneBounds.textFontSize.min,
      sceneBounds.textFontSize.max,
    ),
    fontWeight: WEIGHTS.has(input.fontWeight ?? 0)
      ? input.fontWeight!
      : DEFAULT_TEXT_SETTINGS.fontWeight,
    primaryColor: color(
      input.primaryColor,
      DEFAULT_TEXT_SETTINGS.primaryColor,
    ),
    strokeColor: color(input.strokeColor, DEFAULT_TEXT_SETTINGS.strokeColor),
    strokeWidth: bounded(
      input.strokeWidth,
      DEFAULT_TEXT_SETTINGS.strokeWidth,
      sceneBounds.textStrokeWidth.min,
      sceneBounds.textStrokeWidth.max,
    ),
  };
}

export function textSettingsStorageKey(session: PlaySession): string {
  const owner = session.role === 'gm' ? 'gm' : `player-${session.userId}`;
  return `blackboxvtt:text:${session.campaignId}:${owner}`;
}

export function loadTextSettings(session: PlaySession): TextSettings {
  try {
    const stored = localStorage.getItem(textSettingsStorageKey(session));
    return normalizeTextSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_TEXT_SETTINGS };
  }
}

export function saveTextSettings(
  session: PlaySession,
  settings: TextSettings,
): void {
  try {
    localStorage.setItem(
      textSettingsStorageKey(session),
      JSON.stringify(normalizeTextSettings(settings)),
    );
  } catch {
    // Text creation remains usable when browser storage is unavailable.
  }
}
