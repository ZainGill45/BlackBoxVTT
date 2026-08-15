import { describe, expect, it } from 'vitest';
import {
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
} from '../../../systems/dnd5e/characterData';
import {
  compileDnd5eSpellCast,
  presentDnd5eSpellHeader,
} from '../../../systems/dnd5e/spellCasting';
import { createDefaultDnd5eSpellData } from '../../../systems/dnd5e/spellData';

function fixture() {
  const character = createDefaultDnd5eCharacterData();
  character.identity.className = 'Wizard';
  character.identity.level = 5;
  character.abilities.intelligence.score = 18;
  character.spellcasting.ability = 'intelligence';
  const derived = deriveDnd5eCharacterValues(character, '5.5e');
  if (!derived) throw new Error('Character fixture must derive.');
  const spell = createDefaultDnd5eSpellData();
  spell.castingTime = '1 Action';
  spell.classes = ['Wizard'];
  spell.components = {
    material: true,
    materialDescription: 'a silver thread',
    somatic: true,
    verbal: true,
  };
  spell.concentration = true;
  spell.description = 'Arcane force strikes the target.';
  spell.duration = '1 Minute';
  spell.higherLevelDescription = 'The damage increases when upcast.';
  spell.level = 1;
  spell.range = '60 feet';
  spell.ritual = true;
  spell.school = 'Evocation';
  spell.target = 'One creature';
  return { character, derived, spell };
}

describe('D&D spell casting compiler', () => {
  it('presents a compact attack, damage, class, flag, and component header', () => {
    const { character, derived, spell } = fixture();
    spell.rollSteps = [
      {
        attackBonus: { kind: 'spell-attack-bonus' },
        id: '10000000-0000-4000-8000-000000000001',
        label: 'Spell Attack',
        purpose: 'attack',
      },
      {
        criticalSourceStepId: null,
        damageType: 'radiant',
        id: '10000000-0000-4000-8000-000000000002',
        label: 'Radiant Damage',
        purpose: 'damage',
        terms: [{ count: 4, kind: 'dice', scaling: 'fixed', sides: 6, tiers: [] }],
      },
    ];
    const compiled = compileDnd5eSpellCast(
      'Guiding Bolt', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(presentDnd5eSpellHeader(spell, compiled.definition)).toEqual({
      rollSummary: '+7 · 4d6',
      subtitle: '1st-level Evocation',
      tags: [
        'Attack',
        'Radiant',
        'Wizard',
        'Concentration',
        'Ritual',
        'V, S, M',
      ],
    });
  });

  it('summarizes saves, healing, general rolls, and details-only casts', () => {
    const { character, derived, spell } = fixture();
    spell.rollSteps = [
      {
        ability: 'wisdom',
        dc: { dc: 17, kind: 'fixed' },
        failure: '',
        id: '10000000-0000-4000-8000-000000000001',
        label: 'Save',
        purpose: 'save',
        success: '',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        label: 'Healing',
        purpose: 'healing',
        terms: [
          { count: 3, kind: 'dice', scaling: 'fixed', sides: 8, tiers: [] },
          { kind: 'spellcasting-modifier' },
        ],
      },
    ];
    let compiled = compileDnd5eSpellCast(
      'Restoring Word', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(presentDnd5eSpellHeader(spell, compiled.definition).rollSummary)
      .toBe('DC 17 · 3d8 + 4');

    spell.rollSteps = [{
      id: '10000000-0000-4000-8000-000000000003',
      label: 'General Roll',
      purpose: 'roll',
      terms: [
        { count: 2, kind: 'dice', scaling: 'fixed', sides: 4, tiers: [] },
        { kind: 'flat', value: 3 },
      ],
    }];
    compiled = compileDnd5eSpellCast(
      'Fortune', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(presentDnd5eSpellHeader(spell, compiled.definition)).toMatchObject({
      rollSummary: '2d4 + 3',
      tags: expect.arrayContaining(['General']),
    });

    spell.rollSteps = [];
    compiled = compileDnd5eSpellCast(
      'Quiet Detail', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(presentDnd5eSpellHeader(spell, compiled.definition).rollSummary).toBe('N/A');
    expect(presentDnd5eSpellHeader(spell, null).rollSummary).toBe('N/A');
  });

  it('updates the primary roll summary for fixed attacks and upcasting', () => {
    const { character, derived, spell } = fixture();
    spell.rollSteps = [
      {
        attackBonus: { kind: 'fixed', modifier: 9 },
        id: '10000000-0000-4000-8000-000000000001',
        label: 'Fixed Attack',
        purpose: 'attack',
      },
      {
        criticalSourceStepId: null,
        damageType: 'force',
        id: '10000000-0000-4000-8000-000000000002',
        label: 'Damage',
        purpose: 'damage',
        terms: [{
          count: 1,
          kind: 'dice',
          scaling: 'cast-level',
          sides: 6,
          tiers: [{ count: 3, minimum: 3 }],
        }],
      },
    ];
    const base = compileDnd5eSpellCast(
      'Force Lance', spell, character, derived, { kind: 'without-slot' },
    );
    const upcast = compileDnd5eSpellCast(
      'Force Lance', spell, character, derived, { kind: 'slot', level: 3 },
    );
    expect(base.ok && presentDnd5eSpellHeader(spell, base.definition).rollSummary)
      .toBe('+9 · 1d6');
    expect(upcast.ok && presentDnd5eSpellHeader(spell, upcast.definition).rollSummary)
      .toBe('+9 · 3d6');
  });

  it('creates a complete details-only card', () => {
    const { character, derived, spell } = fixture();
    spell.rollSteps = [];
    const compiled = compileDnd5eSpellCast(
      ' Arcane Ward ',
      spell,
      character,
      derived,
      { kind: 'without-slot' },
    );

    expect(compiled).toMatchObject({
      definition: {
        category: 'Spell',
        sections: [{
          kind: 'effect',
          label: 'Spell Details',
          text: expect.stringContaining('Cast: Without a slot at 1st Level'),
        }],
        title: 'Arcane Ward',
      },
      issues: [],
      ok: true,
    });
    if (!compiled.ok) return;
    expect(compiled.definition.sections[0]).toMatchObject({
      text: expect.stringContaining('Material: a silver thread'),
    });
    expect(compiled.definition.sections[0]).toMatchObject({
      text: expect.stringContaining('Higher-Level Casting: The damage increases when upcast.'),
    });
  });

  it('resolves every authored step and term type in order while upcasting', () => {
    const { character, derived, spell } = fixture();
    const spellAttackId = '10000000-0000-4000-8000-000000000001';
    spell.rollSteps = [
      {
        attackBonus: { kind: 'spell-attack-bonus' },
        id: spellAttackId,
        label: 'Spell Attack',
        purpose: 'attack',
      },
      {
        attackBonus: { kind: 'fixed', modifier: 9 },
        id: '10000000-0000-4000-8000-000000000002',
        label: 'Fixed Attack',
        purpose: 'attack',
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        label: 'General',
        purpose: 'roll',
        terms: [{ count: 1, kind: 'dice', scaling: 'fixed', sides: 4, tiers: [] }],
      },
      {
        criticalSourceStepId: spellAttackId,
        damageType: 'force',
        id: '10000000-0000-4000-8000-000000000004',
        label: 'Damage',
        purpose: 'damage',
        terms: [
          {
            count: 1,
            kind: 'dice',
            scaling: 'cast-level',
            sides: 6,
            tiers: [{ count: 3, minimum: 3 }],
          },
          { kind: 'spellcasting-modifier' },
          { kind: 'caster-level' },
          { kind: 'cast-level' },
          { kind: 'flat', value: 2 },
        ],
      },
      {
        id: '10000000-0000-4000-8000-000000000005',
        label: 'Healing',
        purpose: 'healing',
        terms: [{
          count: 1,
          kind: 'dice',
          scaling: 'caster-level',
          sides: 8,
          tiers: [{ count: 2, minimum: 5 }],
        }],
      },
      {
        ability: 'dexterity',
        dc: { kind: 'spell-save-dc' },
        failure: 'The target falls.',
        id: '10000000-0000-4000-8000-000000000006',
        label: 'Spell Save',
        purpose: 'save',
        success: 'The target remains standing.',
      },
      {
        ability: 'wisdom',
        dc: { dc: 17, kind: 'fixed' },
        failure: '',
        id: '10000000-0000-4000-8000-000000000007',
        label: 'Fixed Save',
        purpose: 'save',
        success: '',
      },
      {
        id: '10000000-0000-4000-8000-000000000008',
        label: 'Effect',
        purpose: 'effect',
        text: 'The area glows.',
      },
    ];

    const compiled = compileDnd5eSpellCast(
      'Arcane Storm',
      spell,
      character,
      derived,
      { kind: 'slot', level: 3 },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.definition.sections).toEqual([
      expect.objectContaining({
        kind: 'effect',
        text: expect.stringContaining('Cast: 3rd Level slot'),
      }),
      {
        label: 'Spell Attack',
        modifiers: [{ label: 'Spell Attack Bonus', value: 7 }],
        notation: '1d20',
        typeLabel: 'Attack',
      },
      {
        label: 'Fixed Attack',
        modifiers: [{ label: 'Spell Attack Bonus', value: 9 }],
        notation: '1d20',
        typeLabel: 'Attack',
      },
      {
        label: 'General',
        modifiers: [],
        notation: '1d4',
        typeLabel: null,
      },
      {
        alternateNotation: '6d6',
        condition: 'first-d20-natural-maximum',
        kind: 'conditional-roll',
        label: 'Damage',
        modifiers: [
          { label: 'Spellcasting Modifier', value: 4 },
          { label: 'Caster Level', value: 5 },
          { label: 'Cast Level', value: 3 },
          { label: 'Flat Modifier', value: 2 },
        ],
        notation: '3d6',
        sourceSection: 1,
        typeLabel: 'Force',
      },
      {
        label: 'Healing',
        modifiers: [],
        notation: '2d8',
        typeLabel: 'Healing',
      },
      {
        detail: 'Success: The target remains standing.\nFailure: The target falls.',
        kind: 'prompt',
        label: 'Spell Save',
        value: 'DC 15 Dexterity Save',
      },
      {
        detail: null,
        kind: 'prompt',
        label: 'Fixed Save',
        value: 'DC 17 Wisdom Save',
      },
      { kind: 'effect', label: 'Effect', text: 'The area glows.' },
    ]);
  });

  it('rejects invalid modes and authored steps as a whole', () => {
    const { character, derived, spell } = fixture();
    spell.ritual = false;
    spell.rollSteps = [{
      criticalSourceStepId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      damageType: null,
      id: '10000000-0000-4000-8000-000000000001',
      label: 'Damage',
      purpose: 'damage',
      terms: [{ count: 1, kind: 'dice', scaling: 'fixed', sides: 6, tiers: [] }],
    }];

    const compiled = compileDnd5eSpellCast(
      'Broken Spell',
      spell,
      character,
      derived,
      { kind: 'ritual' },
    );
    expect(compiled).toEqual({
      issues: [
        { message: 'This spell is not authored as a ritual.', stepId: null },
        {
          message: 'Choose a valid Attack for critical damage.',
          stepId: '10000000-0000-4000-8000-000000000001',
        },
      ],
      ok: false,
    });
    expect(compiled).not.toHaveProperty('definition');
  });

  it('casts cantrip caster-level tiers and rejects cast-level terms', () => {
    const { character, derived, spell } = fixture();
    spell.level = 0;
    spell.rollSteps = [{
      id: '10000000-0000-4000-8000-000000000001',
      label: 'Cantrip Damage',
      purpose: 'damage',
      criticalSourceStepId: null,
      damageType: null,
      terms: [{
        count: 1,
        kind: 'dice',
        scaling: 'caster-level',
        sides: 10,
        tiers: [{ count: 2, minimum: 5 }],
      }],
    }];
    expect(compileDnd5eSpellCast(
      'Spark', spell, character, derived, { kind: 'cantrip' },
    )).toMatchObject({
      definition: { sections: [expect.anything(), { notation: '2d10' }] },
      ok: true,
    });

    spell.rollSteps[0] = {
      ...spell.rollSteps[0],
      terms: [{ kind: 'cast-level' }],
    } as typeof spell.rollSteps[0];
    expect(compileDnd5eSpellCast(
      'Spark', spell, character, derived, { kind: 'cantrip' },
    )).toMatchObject({ issues: [{ stepId: spell.rollSteps[0].id }], ok: false });
  });
});
