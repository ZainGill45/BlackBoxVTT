import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SETTINGS,
  loadTextSettings,
  normalizeTextSettings,
  saveTextSettings,
  textSettingsStorageKey,
} from '../../../../features/play/textSettings';
import type { PlaySession } from '../../../../features/play/types';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';

const campaignId = '11111111-1111-4111-8111-111111111111';
const gm: PlaySession = {
  campaignId,
  campaignName: 'Iron Keep',
  role: 'gm',
  source: 'local',
  system: TEST_CAMPAIGN_SYSTEM,
};
const player: PlaySession = {
  campaignId,
  campaignName: 'Iron Keep',
  host: 'vtt.local',
  port: 30_000,
  role: 'player',
  source: 'remote',
  system: TEST_CAMPAIGN_SYSTEM,
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'Alice',
};

beforeEach(() => localStorage.clear());

describe('text settings', () => {
  it('uses the documented defaults and clamps numeric preferences', () => {
    expect(DEFAULT_TEXT_SETTINGS).toEqual({
      fontFamily: 'inter',
      fontSize: 64,
      fontWeight: 400,
      primaryColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 8,
    });
    expect(
      normalizeTextSettings({
        fontFamily: 'comic-sans',
        fontSize: 999,
        fontWeight: 300,
        primaryColor: 'white',
        strokeColor: '#ABCDEF',
        strokeWidth: -10,
      }),
    ).toEqual({
      fontFamily: 'inter',
      fontSize: 256,
      fontWeight: 400,
      primaryColor: '#ffffff',
      strokeColor: '#abcdef',
      strokeWidth: 0,
    });
  });

  it('persists independently for each campaign actor', () => {
    const settings = {
      ...DEFAULT_TEXT_SETTINGS,
      fontFamily: 'cinzel' as const,
      fontSize: 48,
      fontWeight: 700 as const,
      primaryColor: '#ababab',
    };
    saveTextSettings(player, settings);

    expect(textSettingsStorageKey(player)).not.toBe(textSettingsStorageKey(gm));
    expect(loadTextSettings(player)).toEqual(settings);
    expect(loadTextSettings(gm)).toEqual(DEFAULT_TEXT_SETTINGS);
  });

  it('recovers every invalid stored field without exposing malformed settings', () => {
    localStorage.setItem(textSettingsStorageKey(player), '{broken');
    expect(loadTextSettings(player)).toEqual(DEFAULT_TEXT_SETTINGS);
    localStorage.setItem(
      textSettingsStorageKey(player),
      JSON.stringify({ fontFamily: null, fontSize: null }),
    );
    expect(loadTextSettings(player)).toEqual(DEFAULT_TEXT_SETTINGS);
  });
});
