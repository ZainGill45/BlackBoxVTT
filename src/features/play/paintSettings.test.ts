import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaySession } from './types';
import {
  DEFAULT_PAINT_SETTINGS,
  drawingStyle,
  loadPaintSettings,
  normalizePaintSettings,
  paintSettingsStorageKey,
  savePaintSettings,
  stepPaintWidth,
} from './paintSettings';

const campaignId = '11111111-1111-4111-8111-111111111111';
const gm: PlaySession = {
  campaignId,
  campaignName: 'Iron Keep',
  role: 'gm',
  source: 'local',
};
const player: PlaySession = {
  campaignId,
  campaignName: 'Iron Keep',
  host: 'vtt.local',
  port: 30_000,
  role: 'player',
  source: 'remote',
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

beforeEach(() => localStorage.clear());

describe('paint settings', () => {
  it('uses the documented independent defaults and scene-unit bounds', () => {
    expect(DEFAULT_PAINT_SETTINGS).toMatchObject({
      freeform: {
        color: '#ffffff',
        edge: 'hard',
        hardness: 1,
        opacity: 1,
        width: 12,
      },
      polyline: {
        color: '#ffffff',
        fillColor: '#ffffff',
        fillColorLinked: true,
        fillEnabled: false,
        fillOpacity: 0.25,
        opacity: 1,
        width: 6,
      },
    });

    expect(
      normalizePaintSettings({
        freeform: {
          color: 'invalid',
          edge: 'soft',
          hardness: -1,
          opacity: 5,
          width: 999,
        },
        polyline: {
          color: '#ABCDEF',
          fillColor: '#123456',
          fillColorLinked: false,
          fillEnabled: true,
          fillOpacity: 0,
          opacity: 0,
          width: -4,
        },
      }),
    ).toMatchObject({
      freeform: {
        color: '#ffffff',
        edge: 'soft',
        hardness: 0,
        opacity: 1,
        width: 256,
      },
      polyline: {
        color: '#abcdef',
        fillColor: '#123456',
        fillColorLinked: false,
        fillEnabled: true,
        fillOpacity: 0.01,
        opacity: 0.01,
        width: 1,
      },
    });
    expect(
      normalizePaintSettings({ freeform: {} }).freeform.hardness,
    ).toBe(1);
    expect(
      normalizePaintSettings({ freeform: { hardness: 2 } }).freeform
        .hardness,
    ).toBe(1);
  });

  it('persists separately per campaign identity and produces subtool styles', () => {
    const settings = structuredClone(DEFAULT_PAINT_SETTINGS);
    settings.freeform.color = '#ababab';
    settings.freeform.edge = 'soft';
    settings.freeform.hardness = 0.4;
    settings.polyline.fillColor = '#cccccc';
    settings.polyline.fillEnabled = true;
    savePaintSettings(player, settings);

    expect(paintSettingsStorageKey(player)).not.toBe(
      paintSettingsStorageKey(gm),
    );
    expect(loadPaintSettings(player)).toEqual(settings);
    expect(loadPaintSettings(gm)).toEqual(DEFAULT_PAINT_SETTINGS);
    expect(drawingStyle(settings, 'freeform')).toMatchObject({
      edge: 'soft',
      fillEnabled: false,
      hardness: 0.4,
      strokeColor: '#ababab',
      strokeWidth: 12,
    });
    expect(drawingStyle(settings, 'polyline')).toMatchObject({
      edge: 'hard',
      fillColor: '#cccccc',
      fillEnabled: true,
      hardness: 1,
      strokeWidth: 6,
    });
  });

  it('steps manual widths through the documented Photoshop-style rungs', () => {
    expect(stepPaintWidth(1, -1)).toBe(1);
    expect(stepPaintWidth(9, 1)).toBe(10);
    expect(stepPaintWidth(10, 1)).toBe(15);
    expect(stepPaintWidth(12, -1)).toBe(10);
    expect(stepPaintWidth(12, 1)).toBe(15);
    expect(stepPaintWidth(50, 1)).toBe(60);
    expect(stepPaintWidth(250, 1)).toBe(256);
    expect(stepPaintWidth(256, 1)).toBe(256);
  });
});
