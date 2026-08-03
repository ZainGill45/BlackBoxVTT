import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_SETTINGS,
  loadShapeSettings,
  normalizeShapeSettings,
  saveShapeSettings,
  shapeSettingsStorageKey,
} from '../../../../features/play/shapeSettings';
import type { PlaySession } from '../../../../features/play/types';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';

const gm: PlaySession = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  campaignName: 'Campaign',
  role: 'gm',
  source: 'local',
  system: TEST_CAMPAIGN_SYSTEM,
};
const player: PlaySession = {
  campaignId: gm.campaignId,
  campaignName: 'Campaign',
  host: 'localhost',
  port: 30_000,
  role: 'player',
  source: 'remote',
  system: TEST_CAMPAIGN_SYSTEM,
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

beforeEach(() => localStorage.clear());

describe('shape settings', () => {
  it('uses the requested crosshatch, stroke, and label defaults', () => {
    expect(DEFAULT_SHAPE_SETTINGS).toEqual({
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
    });
  });

  it('normalizes enums, colors, opacity, and pixel bounds', () => {
    expect(normalizeShapeSettings({
      backgroundColor: '#ABCDEF',
      backgroundOpacity: 4,
      backgroundType: 'invalid',
      fontSize: 999,
      fontStrokeWidth: -10,
      fontWeight: 123,
      strokeOpacity: -2,
      strokeType: 'dotted',
      strokeWidth: 99,
    })).toMatchObject({
      backgroundColor: '#abcdef',
      backgroundOpacity: 1,
      backgroundType: 'crosshatched',
      fontSize: 256,
      fontStrokeWidth: 0,
      fontWeight: 400,
      strokeOpacity: 0,
      strokeType: 'dotted',
      strokeWidth: 32,
    });
  });

  it('persists independently per campaign actor', () => {
    saveShapeSettings(gm, { ...DEFAULT_SHAPE_SETTINGS, strokeWidth: 9 });
    saveShapeSettings(player, { ...DEFAULT_SHAPE_SETTINGS, strokeWidth: 17 });

    expect(shapeSettingsStorageKey(gm)).not.toBe(shapeSettingsStorageKey(player));
    expect(loadShapeSettings(gm).strokeWidth).toBe(9);
    expect(loadShapeSettings(player).strokeWidth).toBe(17);
  });
});
