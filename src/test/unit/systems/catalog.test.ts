import { describe, expect, it } from 'vitest';
import {
  createDefaultCampaignSystemState,
  DEFAULT_GAME_SYSTEM_ID,
  listGameSystemDefinitions,
  parseCampaignSystemState,
} from '../../../systems/catalog';

describe('bundled game-system catalog', () => {
  it('has one canonical inventory with unique identifiers', () => {
    const systems = listGameSystemDefinitions();
    expect(new Set(systems.map((system) => system.id)).size).toBe(
      systems.length,
    );
    expect(DEFAULT_GAME_SYSTEM_ID).toBe('dnd5e');
    expect(systems).toMatchObject([
      {
        displayName: 'D&D 5e/5.5e',
        id: 'dnd5e',
        schemaVersion: 1,
      },
    ]);
  });

  it('defaults campaigns to 5.5e while accepting a future 5e override', () => {
    expect(createDefaultCampaignSystemState()).toEqual({
      id: 'dnd5e',
      schemaVersion: 1,
      settings: { defaultRulesVersion: '5.5e' },
    });
    expect(
      parseCampaignSystemState({
        id: 'dnd5e',
        schemaVersion: 1,
        settings: { defaultRulesVersion: '5e' },
      }),
    ).toEqual({
      id: 'dnd5e',
      schemaVersion: 1,
      settings: { defaultRulesVersion: '5e' },
    });
  });

  it('rejects unknown, mismatched, and malformed system states', () => {
    expect(createDefaultCampaignSystemState('unknown')).toBeNull();
    expect(
      parseCampaignSystemState({
        id: 'dnd5e',
        schemaVersion: 2,
        settings: { defaultRulesVersion: '5.5e' },
      }),
    ).toBeNull();
    expect(
      parseCampaignSystemState({
        id: 'dnd5e',
        schemaVersion: 1,
        settings: { defaultRulesVersion: 'invalid' },
      }),
    ).toBeNull();
  });
});
