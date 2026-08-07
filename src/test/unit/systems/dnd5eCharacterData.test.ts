import { describe, expect, it } from 'vitest';
import {
  applyDnd5eCharacterFeatureMutations,
  applyDnd5eCharacterResourceMutations,
  calculateDnd5eOffsetForTotal,
  calculateDnd5eSkillValues,
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
  DND5E_ABILITIES,
  DND5E_SKILLS,
  formatDnd5eSignedValue,
  isDnd5eCharacterData,
  MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_CHARACTER_FEATURES,
  MAX_DND5E_CHARACTER_RESOURCES,
  nextDnd5eSkillTraining,
  parseDnd5eSafeInteger,
  type Dnd5eAbilityId,
} from '../../../systems/dnd5e/characterData';

describe('D&D Character data', () => {
  it('defines the canonical skill order, ability mapping, and untrained defaults', () => {
    expect(DND5E_SKILLS).toEqual([
      { ability: 'dexterity', abbreviation: 'DEX', id: 'acrobatics', label: 'Acrobatics' },
      { ability: 'wisdom', abbreviation: 'WIS', id: 'animalHandling', label: 'Animal Handling' },
      { ability: 'intelligence', abbreviation: 'INT', id: 'arcana', label: 'Arcana' },
      { ability: 'strength', abbreviation: 'STR', id: 'athletics', label: 'Athletics' },
      { ability: 'charisma', abbreviation: 'CHA', id: 'deception', label: 'Deception' },
      { ability: 'intelligence', abbreviation: 'INT', id: 'history', label: 'History' },
      { ability: 'wisdom', abbreviation: 'WIS', id: 'insight', label: 'Insight' },
      { ability: 'charisma', abbreviation: 'CHA', id: 'intimidation', label: 'Intimidation' },
      { ability: 'intelligence', abbreviation: 'INT', id: 'investigation', label: 'Investigation' },
      { ability: 'wisdom', abbreviation: 'WIS', id: 'medicine', label: 'Medicine' },
      { ability: 'intelligence', abbreviation: 'INT', id: 'nature', label: 'Nature' },
      { ability: 'wisdom', abbreviation: 'WIS', id: 'perception', label: 'Perception' },
      { ability: 'charisma', abbreviation: 'CHA', id: 'performance', label: 'Performance' },
      { ability: 'charisma', abbreviation: 'CHA', id: 'persuasion', label: 'Persuasion' },
      { ability: 'intelligence', abbreviation: 'INT', id: 'religion', label: 'Religion' },
      { ability: 'dexterity', abbreviation: 'DEX', id: 'sleightOfHand', label: 'Sleight of Hand' },
      { ability: 'dexterity', abbreviation: 'DEX', id: 'stealth', label: 'Stealth' },
      { ability: 'wisdom', abbreviation: 'WIS', id: 'survival', label: 'Survival' },
    ]);
    expect(createDefaultDnd5eCharacterData().skills).toEqual(Object.fromEntries(
      DND5E_SKILLS.map(({ id }) => [id, 'untrained']),
    ));
  });

  it('creates a blank level-one calculation source with numeric zero offsets', () => {
    const data = createDefaultDnd5eCharacterData();
    expect(data.identity.level).toBeNull();
    expect(data.abilities.strength).toEqual({
      modifierOffset: 0,
      savingThrowOffset: 0,
      score: 10,
    });
    expect(data.importantStats).toEqual({
      armorClass: '10',
      concentrationSaveOffset: 0,
      currentSpeed: '30',
      initiativeOffset: 0,
      inspirationCount: '0',
      proficiencyBonusOffset: 0,
    });
    expect(data.features).toEqual([]);
    expect(data.resources).toEqual([]);
    expect(deriveDnd5eCharacterValues(data, '5.5e')).toMatchObject({
      concentrationSave: 0,
      initiative: 0,
      proficiencyBonus: 2,
    });
    expect(isDnd5eCharacterData(data)).toBe(true);
  });

  it('validates exact, bounded, uniquely identified Feature records and all types', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.features = ['unknown', 'feature', 'trait', 'proficiency'].map(
      (type, index) => ({
        description: index === 0
          ? 'x'.repeat(MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS)
          : '',
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: '',
        source: '',
        sourceType: '',
        type: type as 'unknown' | 'feature' | 'trait' | 'proficiency',
      }),
    );
    expect(isDnd5eCharacterData(valid)).toBe(true);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], type: 'spell' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], id: 'not-a-uuid' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], name: 'x'.repeat(129) }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], description: 'x'.repeat(
        MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS + 1,
      ) }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [valid.features[0], { ...valid.features[0] }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], extra: '' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: Array.from(
        { length: MAX_DND5E_CHARACTER_FEATURES + 1 },
        (_, index) => ({
          description: '',
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: 'Feature',
          source: '',
          sourceType: '',
          type: 'feature',
        }),
      ),
    })).toBe(false);
  });

  it('applies Feature edits and reorders by stable id while preserving remote slots', () => {
    const makeFeature = (id: string, name: string) => ({
      description: '',
      id,
      name,
      source: '',
      sourceType: '',
      type: 'unknown' as const,
    });
    const first = makeFeature('11111111-1111-4111-8111-111111111111', 'First');
    const remote = makeFeature('22222222-2222-4222-8222-222222222222', 'Remote');
    const second = makeFeature('33333333-3333-4333-8333-333333333333', 'Second');
    const applied = applyDnd5eCharacterFeatureMutations(
      [first, remote, second],
      [
        {
          changes: { description: 'Changed', type: 'trait' },
          id: first.id,
          kind: 'update',
        },
        { kind: 'reorder', orderedIds: [second.id, first.id] },
      ],
    );
    expect(applied).toEqual({
      features: [
        second,
        remote,
        { ...first, description: 'Changed', type: 'trait' },
      ],
      missingIds: [],
    });
    expect(applyDnd5eCharacterFeatureMutations(applied.features, [
      { direction: 'up', id: '44444444-4444-4444-8444-444444444444', kind: 'move' },
    ])).toMatchObject({
      features: applied.features,
      missingIds: ['44444444-4444-4444-8444-444444444444'],
    });
  });

  it('validates exact fields, safe integer inputs, derived arithmetic, and death-save bounds', () => {
    const valid = createDefaultDnd5eCharacterData();
    expect(isDnd5eCharacterData({
      ...valid,
      health: { ...valid.health, deathSaveFailures: '4' },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      abilities: {
        ...valid.abilities,
        strength: { ...valid.abilities.strength, score: '12' },
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      abilities: {
        ...valid.abilities,
        strength: { ...valid.abilities.strength, modifierOffset: Number.MAX_SAFE_INTEGER },
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({ ...valid, extra: true })).toBe(false);
  });

  it('validates bounded, uniquely identified signed Resource counters', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.resources = [{
      current: -3,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: -10,
      name: '',
    }];
    expect(isDnd5eCharacterData(valid)).toBe(true);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [{ ...valid.resources[0], id: 'not-a-uuid' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [valid.resources[0], { ...valid.resources[0] }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [{ ...valid.resources[0], current: Number.MAX_SAFE_INTEGER + 1 }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: Array.from(
        { length: MAX_DND5E_CHARACTER_RESOURCES + 1 },
        (_, index) => ({
          current: 0,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          maximum: 0,
          name: 'Resource',
        }),
      ),
    })).toBe(false);
  });

  it('applies Resource edits and reorders by stable id while preserving remote slots', () => {
    const first = {
      current: 1,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: 2,
      name: 'First',
    };
    const remote = {
      current: 3,
      id: '22222222-2222-4222-8222-222222222222',
      maximum: 4,
      name: 'Remote',
    };
    const second = {
      current: 5,
      id: '33333333-3333-4333-8333-333333333333',
      maximum: 6,
      name: 'Second',
    };
    const applied = applyDnd5eCharacterResourceMutations(
      [first, remote, second],
      [
        { changes: { current: -7, name: 'Changed' }, id: first.id, kind: 'update' },
        { kind: 'reorder', orderedIds: [second.id, first.id] },
      ],
    );
    expect(applied.missingIds).toEqual([]);
    expect(applied.resources).toEqual([
      { ...second },
      remote,
      { ...first, current: -7, name: 'Changed' },
    ]);
    expect(applyDnd5eCharacterResourceMutations(applied.resources, [
      { direction: 'up', id: '44444444-4444-4444-8444-444444444444', kind: 'move' },
    ])).toMatchObject({
      missingIds: ['44444444-4444-4444-8444-444444444444'],
      resources: applied.resources,
    });
  });

  it('derives and propagates ability, save, proficiency, skill, initiative, and concentration offsets', () => {
    const data = createDefaultDnd5eCharacterData();
    data.identity.className = 'Fighter';
    data.identity.level = 5;
    data.abilities.strength.score = 12;
    data.abilities.strength.modifierOffset = 2;
    data.abilities.strength.savingThrowOffset = -1;
    data.abilities.dexterity.score = 12;
    data.abilities.dexterity.modifierOffset = 1;
    data.abilities.constitution.score = 14;
    data.abilities.constitution.savingThrowOffset = 2;
    data.importantStats.proficiencyBonusOffset = 1;
    data.importantStats.initiativeOffset = -1;
    data.importantStats.concentrationSaveOffset = 3;
    data.skills.athletics = 'expertise';

    const derived = deriveDnd5eCharacterValues(data, '5.5e');
    expect(derived).not.toBeNull();
    expect(derived).toMatchObject({
      abilities: {
        constitution: { modifier: 2, savingThrow: 8 },
        dexterity: { modifier: 2, savingThrow: 2 },
        strength: { modifier: 3, savingThrow: 6 },
      },
      concentrationSave: 11,
      initiative: 1,
      proficiencyBonus: 4,
      skills: {
        athletics: { bonus: 11, display: '+11 / 21', passive: 21 },
      },
    });
  });

  it('uses the official proficiency tiers, blank-level default, and no base outside levels 1-20', () => {
    const data = createDefaultDnd5eCharacterData();
    const expected = new Map<number | null, number>([
      [null, 2], [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4],
      [13, 5], [16, 5], [17, 6], [20, 6], [0, 0], [21, 0], [-3, 0],
    ]);
    for (const [level, proficiencyBonus] of expected) {
      data.identity.level = level;
      expect(deriveDnd5eCharacterValues(data, '5e')?.proficiencyBonus)
        .toBe(proficiencyBonus);
      expect(deriveDnd5eCharacterValues(data, '5.5e')?.proficiencyBonus)
        .toBe(proficiencyBonus);
    }
  });

  it('uses the selected class as the only saving-throw proficiency source', () => {
    const proficiencies: Record<string, readonly Dnd5eAbilityId[]> = {
      Artificer: ['constitution', 'intelligence'],
      Barbarian: ['strength', 'constitution'],
      Bard: ['dexterity', 'charisma'],
      Cleric: ['wisdom', 'charisma'],
      Druid: ['intelligence', 'wisdom'],
      Fighter: ['strength', 'constitution'],
      Monk: ['strength', 'dexterity'],
      Paladin: ['wisdom', 'charisma'],
      Ranger: ['strength', 'dexterity'],
      Rogue: ['dexterity', 'intelligence'],
      Sorcerer: ['constitution', 'charisma'],
      Warlock: ['wisdom', 'charisma'],
      Wizard: ['intelligence', 'wisdom'],
    };
    const data = createDefaultDnd5eCharacterData();
    for (const [className, proficientAbilities] of Object.entries(proficiencies)) {
      data.identity.className = className;
      const derived = deriveDnd5eCharacterValues(data, '5.5e')!;
      for (const ability of DND5E_ABILITIES) {
        expect(derived.abilities[ability].savingThrow).toBe(
          proficientAbilities.includes(ability) ? 2 : 0,
        );
      }
    }
    data.identity.className = '';
    expect(Object.values(deriveDnd5eCharacterValues(data, '5.5e')!.abilities)
      .every(({ savingThrow }) => savingThrow === 0)).toBe(true);
  });

  it('supports signed homebrew ability scores and rejects derived overflow', () => {
    const data = createDefaultDnd5eCharacterData();
    data.abilities.strength.score = -1;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.abilities.strength.modifier).toBe(-6);
    data.abilities.strength.score = Number.MIN_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5.5e')).not.toBeNull();
    data.abilities.strength.modifierOffset = Number.MIN_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5.5e')).toBeNull();
  });

  it('calculates signed skill totals and passive scores for every training tier', () => {
    expect(calculateDnd5eSkillValues(3, 2, 'untrained')).toEqual({
      bonus: 3,
      display: '+3 / 13',
      passive: 13,
    });
    expect(calculateDnd5eSkillValues(3, 2, 'proficient')).toEqual({
      bonus: 5,
      display: '+5 / 15',
      passive: 15,
    });
    expect(calculateDnd5eSkillValues(-2, 2, 'expertise')).toEqual({
      bonus: 2,
      display: '+2 / 12',
      passive: 12,
    });
    expect(calculateDnd5eSkillValues(Number.MAX_SAFE_INTEGER, 2, 'proficient')).toBeNull();
  });

  it('parses, formats, and rebases directly edited totals', () => {
    expect(parseDnd5eSafeInteger(' +12 ')).toBe(12);
    expect(parseDnd5eSafeInteger('12.5')).toBeNull();
    expect(parseDnd5eSafeInteger('9007199254740992')).toBeNull();
    expect(formatDnd5eSignedValue(3)).toBe('+3');
    expect(formatDnd5eSignedValue(0)).toBe('0');
    expect(calculateDnd5eOffsetForTotal(5, 2, 8)).toBe(5);
    expect(calculateDnd5eOffsetForTotal(5, 2, 3)).toBe(0);
  });

  it('cycles through untrained, proficient, and expertise', () => {
    expect(nextDnd5eSkillTraining('untrained')).toBe('proficient');
    expect(nextDnd5eSkillTraining('proficient')).toBe('expertise');
    expect(nextDnd5eSkillTraining('expertise')).toBe('untrained');
  });
});
