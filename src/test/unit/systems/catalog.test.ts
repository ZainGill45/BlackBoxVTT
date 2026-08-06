import { describe, expect, it } from 'vitest';
import {
  createDefaultCampaignSystemState,
  DEFAULT_GAME_SYSTEM_ID,
  createDefaultJournalEntryData,
  listJournalEntryTypeDefinitions,
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

  it('combines the universal Note with D&D-owned Character metadata', () => {
    const system = createDefaultCampaignSystemState()!;
    const types = listJournalEntryTypeDefinitions(system);
    expect(types.map(({ id }) => id)).toEqual(['core.note', 'dnd5e.character']);
    expect(new Set(types.map(({ id }) => id)).size).toBe(types.length);
    expect(types).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupLabel: 'Notes', id: 'core.note' }),
      expect.objectContaining({ defaultName: 'New Character', groupLabel: 'Characters', id: 'dnd5e.character' }),
    ]));
    expect(createDefaultJournalEntryData(system, 'dnd5e.character')).toEqual({
      data: {},
      dataVersion: 1,
    });
    expect(createDefaultJournalEntryData(system, 'unknown')).toBeNull();
  });
});
