import { describe, expect, it } from 'vitest';
import {
  createDefaultCampaignSystemState,
  DEFAULT_GAME_SYSTEM_ID,
  createDefaultJournalEntryData,
  listJournalEntryTypeDefinitions,
  listGameSystemDefinitions,
  parseJournalEntryData,
  parseCampaignSystemState,
} from '../../../systems/catalog';
import { createDefaultDnd5eCharacterData } from '../../../systems/dnd5e/characterData';
import { createDefaultDnd5eSpellData } from '../../../systems/dnd5e/spellData';

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
      },
    ]);
  });

  it('defaults campaigns to 5.5e while accepting a future 5e override', () => {
    expect(createDefaultCampaignSystemState()).toEqual({
      id: 'dnd5e',
      settings: { defaultRulesVersion: '5.5e' },
    });
    expect(
      parseCampaignSystemState({
        id: 'dnd5e',
        settings: { defaultRulesVersion: '5e' },
      }),
    ).toEqual({
      id: 'dnd5e',
      settings: { defaultRulesVersion: '5e' },
    });
  });

  it('rejects unknown and malformed system states', () => {
    expect(createDefaultCampaignSystemState('unknown')).toBeNull();
    expect(
      parseCampaignSystemState({
        id: 'dnd5e',
        settings: { defaultRulesVersion: 'invalid' },
      }),
    ).toBeNull();
  });

  it('combines the universal Note with D&D-owned Character and Spell metadata', () => {
    const system = createDefaultCampaignSystemState()!;
    const characterData = createDefaultDnd5eCharacterData();
    expect(Object.values(characterData.abilities)).toEqual(Array.from(
      { length: 6 },
      () => ({ modifierOffset: 0, savingThrowOffset: 0, score: 10 }),
    ));
    expect(characterData.importantStats).toEqual({
      armorClass: '10',
      concentrationSaveOffset: 0,
      currentSpeed: '30',
      initiativeOffset: 0,
      inspirationCount: '0',
      proficiencyBonusOffset: 0,
    });
    const types = listJournalEntryTypeDefinitions(system);
    expect(types.map(({ id }) => id)).toEqual([
      'core.note',
      'dnd5e.character',
      'dnd5e.spell',
    ]);
    expect(new Set(types.map(({ id }) => id)).size).toBe(types.length);
    expect(types).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupLabel: 'Notes', id: 'core.note' }),
      expect.objectContaining({ defaultAccess: 'none', defaultName: 'New Character', groupLabel: 'Characters', groupOrder: 0, id: 'dnd5e.character' }),
      expect.objectContaining({ defaultAccess: 'view', defaultName: 'New Spell', groupLabel: 'Spells', groupOrder: 1, id: 'dnd5e.spell' }),
    ]));
    expect(createDefaultJournalEntryData(system, 'dnd5e.character')).toEqual({
      data: characterData,
    });
    expect(createDefaultJournalEntryData(system, 'dnd5e.spell')).toEqual({
      data: createDefaultDnd5eSpellData(),
    });
    expect(parseJournalEntryData(
      system,
      'dnd5e.character',
      { ...createDefaultDnd5eCharacterData(), extra: '' },
    )).toBeNull();
    expect(createDefaultJournalEntryData(system, 'unknown')).toBeNull();
  });
});
