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
        { kind: 'flat', scaling: 'fixed', tiers: [], value: 3 },
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

  it('scales Magic Missile dice and Flat Values together when upcast', () => {
    const { character, derived, spell } = fixture();
    spell.level = 1;
    spell.rollSteps = [{
      criticalSourceStepId: null,
      damageType: 'force',
      id: '10000000-0000-4000-8000-000000000001',
      label: 'Missile Damage',
      purpose: 'damage',
      terms: [
        {
          count: 3,
          kind: 'dice',
          scaling: 'cast-level',
          sides: 4,
          tiers: [
            { count: 4, minimum: 2 },
            { count: 11, minimum: 9 },
          ],
        },
        {
          kind: 'flat',
          scaling: 'cast-level',
          tiers: [
            { minimum: 2, value: 4 },
            { minimum: 9, value: 11 },
          ],
          value: 3,
        },
      ],
    }];

    for (const [mode, expectedNotation, expectedFlat] of [
      [{ kind: 'without-slot' as const }, '3d4', 3],
      [{ kind: 'slot' as const, level: 2 as const }, '4d4', 4],
      [{ kind: 'slot' as const, level: 9 as const }, '11d4', 11],
    ] as const) {
      const compiled = compileDnd5eSpellCast(
        'Magic Missile', spell, character, derived, mode,
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) continue;
      expect(compiled.definition.sections.at(-1)).toMatchObject({
        modifiers: [{ label: 'Flat Modifier', value: expectedFlat }],
        notation: expectedNotation,
      });
      expect(presentDnd5eSpellHeader(spell, compiled.definition).rollSummary)
        .toBe(`${expectedNotation} + ${expectedFlat}`);
    }
  });

  it('resolves signed caster-level Flat Value tiers for cantrips', () => {
    const { character, derived, spell } = fixture();
    spell.level = 0;
    spell.rollSteps = [{
      criticalSourceStepId: null,
      damageType: null,
      id: '10000000-0000-4000-8000-000000000001',
      label: 'Cantrip Value',
      purpose: 'damage',
      terms: [{
        kind: 'flat',
        scaling: 'caster-level',
        tiers: [
          { minimum: 1, value: -1 },
          { minimum: 5, value: 2 },
          { minimum: 11, value: -4 },
        ],
        value: 0,
      }],
    }];
    const compiled = compileDnd5eSpellCast(
      'Level Pulse', spell, character, derived, { kind: 'cantrip' },
    );
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.definition.sections.at(-1)).toMatchObject({
        modifiers: [{ label: 'Flat Modifier', value: 2 }],
        notation: '0',
      });
    }
  });

  it('creates sectioned details-only cards and exposes higher text only for a true upcast', () => {
    const { character, derived, spell } = fixture();
    spell.rollSteps = [];
    const base = compileDnd5eSpellCast(
      ' Arcane Ward ',
      spell,
      character,
      derived,
      { kind: 'without-slot' },
    );

    expect(base).toEqual({
      definition: {
        category: 'Spell',
        sections: [
          { kind: 'effect', label: 'Detail/Casting Time', text: '1 Action' },
          { kind: 'effect', label: 'Detail/Range', text: '60 feet' },
          { kind: 'effect', label: 'Detail/Duration', text: '1 Minute' },
          { kind: 'effect', label: 'Detail/Target', text: 'One creature' },
          { kind: 'effect', label: 'Detail/Components', text: 'V, S, M, C, R' },
          { kind: 'effect', label: 'Detail/Material', text: 'a silver thread' },
          {
            kind: 'effect',
            label: 'Description',
            text: 'Arcane force strikes the target.',
          },
        ],
        title: 'Arcane Ward',
      },
      issues: [],
      ok: true,
    });
    expect(JSON.stringify(base)).not.toMatch(/Spell Details|Cast:|Level:|School:|Classes:/u);

    for (const mode of [
      { kind: 'ritual' as const },
      { kind: 'slot' as const, level: 1 as const },
    ]) {
      const ordinaryCast = compileDnd5eSpellCast(
        'Arcane Ward', spell, character, derived, mode,
      );
      expect(ordinaryCast.ok).toBe(true);
      if (ordinaryCast.ok) {
        expect(ordinaryCast.definition.sections).not.toContainEqual(
          expect.objectContaining({ text: spell.higherLevelDescription }),
        );
      }
    }

    const upcast = compileDnd5eSpellCast(
      'Arcane Ward', spell, character, derived, { kind: 'slot', level: 3 },
    );
    expect(upcast.ok).toBe(true);
    if (upcast.ok) {
      expect(upcast.definition.sections.at(-1)).toEqual({
        kind: 'effect',
        label: 'Details',
        text: 'The damage increases when upcast.',
      });
    }

    spell.level = 0;
    const cantrip = compileDnd5eSpellCast(
      'Arcane Ward', spell, character, derived, { kind: 'cantrip' },
    );
    expect(cantrip.ok).toBe(true);
    if (cantrip.ok) {
      expect(cantrip.definition.sections).not.toContainEqual(
        expect.objectContaining({ text: spell.higherLevelDescription }),
      );
    }
  });

  it('uses N/A for empty details and omits Material when it is not a component', () => {
    const { character, derived, spell } = fixture();
    spell.castingTime = ' ';
    spell.range = '';
    spell.duration = '';
    spell.target = '';
    spell.components = {
      material: false,
      materialDescription: 'ignored material text',
      somatic: false,
      verbal: false,
    };
    spell.concentration = false;
    spell.ritual = false;
    spell.description = '';
    spell.rollSteps = [];

    const compiled = compileDnd5eSpellCast(
      'Quiet Ward', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compiled).toMatchObject({
      definition: {
        sections: [
          { label: 'Detail/Casting Time', text: 'N/A' },
          { label: 'Detail/Range', text: 'N/A' },
          { label: 'Detail/Duration', text: 'N/A' },
          { label: 'Detail/Target', text: 'N/A' },
          { label: 'Detail/Components', text: 'N/A' },
        ],
      },
      ok: true,
    });
    if (compiled.ok) {
      expect(compiled.definition.sections).not.toContainEqual(
        expect.objectContaining({ label: 'Detail/Material' }),
      );
      expect(compiled.definition.sections).not.toContainEqual(
        expect.objectContaining({ label: 'Description' }),
      );
    }

    spell.components.material = true;
    spell.components.materialDescription = ' ';
    const emptyMaterial = compileDnd5eSpellCast(
      'Quiet Ward', spell, character, derived, { kind: 'without-slot' },
    );
    expect(emptyMaterial).toMatchObject({
      definition: {
        sections: expect.arrayContaining([
          { kind: 'effect', label: 'Detail/Material', text: 'N/A' },
        ]),
      },
      ok: true,
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
          {
            kind: 'flat',
            scaling: 'cast-level',
            tiers: [{ minimum: 3, value: 2 }],
            value: 1,
          },
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
      { kind: 'effect', label: 'Detail/Casting Time', text: '1 Action' },
      { kind: 'effect', label: 'Detail/Range', text: '60 feet' },
      { kind: 'effect', label: 'Detail/Duration', text: '1 Minute' },
      { kind: 'effect', label: 'Detail/Target', text: 'One creature' },
      { kind: 'effect', label: 'Detail/Components', text: 'V, S, M, C, R' },
      { kind: 'effect', label: 'Detail/Material', text: 'a silver thread' },
      {
        kind: 'effect',
        label: 'Description',
        text: 'Arcane force strikes the target.',
      },
      {
        kind: 'effect',
        label: 'Details',
        text: 'The damage increases when upcast.',
      },
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
        sourceSection: 8,
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
    ]);

    spell.components.material = false;
    spell.description = '';
    spell.higherLevelDescription = '';
    const compactInformation = compileDnd5eSpellCast(
      'Arcane Storm', spell, character, derived, { kind: 'without-slot' },
    );
    expect(compactInformation.ok).toBe(true);
    if (compactInformation.ok) {
      expect(compactInformation.definition.sections).toContainEqual(
        expect.objectContaining({
          kind: 'conditional-roll',
          label: 'Damage',
          sourceSection: 5,
        }),
      );
    }
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
    const compiled = compileDnd5eSpellCast(
      'Spark', spell, character, derived, { kind: 'cantrip' },
    );
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.definition.sections.at(-1)).toMatchObject({ notation: '2d10' });
    }

    spell.rollSteps[0] = {
      ...spell.rollSteps[0],
      terms: [{ kind: 'cast-level' }],
    } as typeof spell.rollSteps[0];
    expect(compileDnd5eSpellCast(
      'Spark', spell, character, derived, { kind: 'cantrip' },
    )).toMatchObject({ issues: [{ stepId: spell.rollSteps[0].id }], ok: false });
  });
});
