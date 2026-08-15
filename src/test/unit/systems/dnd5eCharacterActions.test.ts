import { NumberGenerator } from '@dice-roller/rpg-dice-roller';
import { describe, expect, it } from 'vitest';
import { rollChatCard } from '../../../main/diceRoller';
import {
  compileDnd5eCharacterAction,
  createDnd5eAbilityRollDefinition,
  createDnd5eHitDieRollDefinition,
  createDnd5eSkillRollDefinition,
  createDnd5eStatisticRollDefinition,
} from '../../../systems/dnd5e/characterActions';
import {
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
  type Dnd5eCharacterAction,
} from '../../../systems/dnd5e/characterData';
import type {
  ChatRollConditionalSectionResult,
  ChatRollOrdinarySectionResult,
} from '../../../shared/chatRoll';

const actionId = '10000000-0000-4000-8000-000000000001';
const attackId = '20000000-0000-4000-8000-000000000001';
const damageId = '20000000-0000-4000-8000-000000000002';
const saveId = '20000000-0000-4000-8000-000000000003';

function fixture() {
  const data = createDefaultDnd5eCharacterData();
  data.abilities.strength.score = 16;
  data.identity.level = 5;
  const derived = deriveDnd5eCharacterValues(data, '5.5e');
  if (!derived) throw new Error('Fixture Character must derive.');
  const action: Dnd5eCharacterAction = {
    activation: 'Action',
    description: 'A guided strike.',
    duration: 'Instantaneous',
    id: actionId,
    name: 'Planar Strike',
    range: '5 feet',
    steps: [
      {
        id: attackId,
        label: 'Attack',
        purpose: 'attack',
        terms: [
          { ability: 'strength', kind: 'ability' },
          { kind: 'proficiency', scale: 'once' },
          { count: 1, kind: 'dice', sides: 6, tiers: [] },
        ],
      },
      {
        criticalSourceStepId: attackId,
        damageType: 'void',
        id: damageId,
        label: 'Damage',
        purpose: 'damage',
        terms: [
          {
            count: 1,
            kind: 'dice',
            sides: 7,
            tiers: [{ count: 2, minimumLevel: 5 }],
          },
          { kind: 'flat', value: 2 },
        ],
      },
      {
        ability: 'dexterity',
        dcTerms: [
          { kind: 'flat', value: 8 },
          { kind: 'proficiency', scale: 'once' },
          { ability: 'strength', kind: 'ability' },
        ],
        failure: 'The target falls prone.',
        id: saveId,
        label: 'Resist',
        purpose: 'save',
        success: 'The target remains standing.',
      },
    ],
    target: 'One creature',
  };
  return { action, data, derived };
}

describe('D&D Character Action compilation', () => {
  it('builds checks and saving throws from their current derived totals', () => {
    const data = createDefaultDnd5eCharacterData();
    data.abilities.strength.modifierOffset = 1;
    data.abilities.strength.savingThrowOffset = 2;
    data.abilities.strength.score = 16;
    data.abilities.constitution.score = 14;
    data.abilities.dexterity.score = 14;
    data.importantStats.concentrationSaveOffset = 1;
    data.identity.className = 'Fighter';
    data.identity.level = 5;
    const derived = deriveDnd5eCharacterValues(data, '5.5e');
    if (!derived) throw new Error('Fixture Character must derive.');

    expect(createDnd5eAbilityRollDefinition(
      'strength',
      derived,
      'check',
    )).toEqual({
      category: 'Ability Check',
      sections: [{
        label: 'Strength',
        modifiers: [{ label: 'Ability Check', value: 4 }],
        notation: '1d20',
        typeLabel: 'Ability Check',
      }],
      title: null,
    });
    expect(createDnd5eAbilityRollDefinition(
      'strength',
      derived,
      'saving-throw',
    )).toMatchObject({
      category: 'Saving Throw',
      sections: [{
        modifiers: [{ label: 'Saving Throw', value: 9 }],
        typeLabel: 'Saving Throw',
      }],
    });
    expect(createDnd5eStatisticRollDefinition(derived, 'initiative')).toEqual({
      category: 'Initiative',
      sections: [{
        label: 'Initiative',
        modifiers: [{ label: 'Initiative', value: 2 }],
        notation: '1d20',
        typeLabel: null,
      }],
      title: null,
    });
    expect(createDnd5eStatisticRollDefinition(
      derived,
      'concentration',
    )).toEqual({
      category: 'Saving Throw',
      sections: [{
        label: 'Concentration',
        modifiers: [{ label: 'Saving Throw', value: 6 }],
        notation: '1d20',
        typeLabel: 'Saving Throw',
      }],
      title: null,
    });
  });

  it('builds a healing roll from a configured D&D Hit Die', () => {
    expect(createDnd5eHitDieRollDefinition(' D10 ')).toEqual({
      category: 'Hit Dice',
      sections: [{
        label: 'Hit Die',
        modifiers: [],
        notation: '1d10',
        typeLabel: 'Healing',
      }],
      title: null,
    });
    expect(createDnd5eHitDieRollDefinition('d20')).toBeNull();
    expect(createDnd5eHitDieRollDefinition('not dice')).toBeNull();
  });

  it('builds skill checks from current derived bonuses', () => {
    expect(createDnd5eSkillRollDefinition('  Sleight of Hand  ', 7)).toEqual({
      category: 'Skill Check',
      sections: [{
        label: 'Sleight of Hand',
        modifiers: [{ label: 'Skill Check', value: 7 }],
        notation: '1d20',
        typeLabel: 'Skill Check',
      }],
      title: null,
    });
  });

  it('resolves current values, custom dice and types, tiers, and prompts in order', () => {
    const { action, data, derived } = fixture();
    const compiled = compileDnd5eCharacterAction(action, data, derived);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.definition).toEqual({
      category: 'Roll',
      sections: [
        {
          kind: 'effect',
          label: 'Details',
          text:
            'Activation: Action\nRange: 5 feet\nTarget: One creature\n' +
            'Duration: Instantaneous\nA guided strike.',
        },
        {
          label: 'Attack',
          modifiers: [
            { label: 'Strength', value: 3 },
            { label: 'Proficiency', value: 3 },
          ],
          notation: '1d20 + 1d6',
          typeLabel: 'Attack',
        },
        {
          alternateNotation: '4d7',
          condition: 'first-d20-natural-maximum',
          kind: 'conditional-roll',
          label: 'Damage',
          modifiers: [{ label: 'Flat Modifier', value: 2 }],
          notation: '2d7',
          sourceSection: 1,
          typeLabel: 'Void',
        },
        {
          detail:
            'Success: The target remains standing.\n' +
            'Failure: The target falls prone.',
          kind: 'prompt',
          label: 'Resist',
          value: 'DC 14 Dexterity Save',
        },
      ],
      title: 'Planar Strike',
    });
  });

  it('doubles linked Damage dice on a natural 20 while applying modifiers once', () => {
    const { action, data, derived } = fixture();
    const compiled = compileDnd5eCharacterAction(action, data, derived);
    if (!compiled.ok) throw new Error('Fixture Action must compile.');
    const card = rollChatCard(compiled.definition, NumberGenerator.engines.max);
    const damage = card.sections[2] as ChatRollConditionalSectionResult;
    expect(damage).toMatchObject({
      baseTotal: 28,
      modifiers: [{ label: 'Flat Modifier', value: 2 }],
      rolledNotation: '4d7',
      total: 30,
      usedAlternate: true,
    });
  });

  it('uses ordinary Damage on a noncritical attack', () => {
    const { action, data, derived } = fixture();
    const compiled = compileDnd5eCharacterAction(action, data, derived);
    if (!compiled.ok) throw new Error('Fixture Action must compile.');
    const card = rollChatCard(compiled.definition, NumberGenerator.engines.min);
    expect(card.sections[2]).toMatchObject({
      baseTotal: 2,
      rolledNotation: '2d7',
      total: 4,
      usedAlternate: false,
    });
  });

  it('does not let an Attack bonus die trigger a critical', () => {
    const { action, data, derived } = fixture();
    const compiled = compileDnd5eCharacterAction(action, data, derived);
    if (!compiled.ok) throw new Error('Fixture Action must compile.');
    let generated = 0;
    const engine = {
      range: [0, 0],
      next() {
        generated += 1;
        return generated === 1 ? 0 : this.range[1] - this.range[0];
      },
    };
    const card = rollChatCard(compiled.definition, engine);
    const attack = card.sections[1] as ChatRollOrdinarySectionResult;
    const damage = card.sections[2] as ChatRollConditionalSectionResult;
    expect(attack.expression).toMatchObject([
      { kind: 'die', results: [{ initialValue: 1 }], sides: 20 },
      expect.anything(),
      { kind: 'die', results: [{ initialValue: 6 }], sides: 6 },
    ]);
    expect(damage.usedAlternate).toBe(false);
  });

  it('uses level one for a blank level and refuses level-dependent terms outside 1–20', () => {
    const { action, data, derived } = fixture();
    action.steps = [{
      id: damageId,
      label: 'Scaling',
      purpose: 'healing',
      terms: [
        {
          count: 1,
          kind: 'dice',
          sides: 8,
          tiers: [{ count: 2, minimumLevel: 5 }],
        },
        { kind: 'level' },
      ],
    }];
    data.identity.level = null;
    expect(compileDnd5eCharacterAction(action, data, derived)).toMatchObject({
      definition: {
        sections: [
          expect.anything(),
          {
            modifiers: [{ label: 'Level', value: 1 }],
            notation: '1d8',
          },
        ],
      },
      ok: true,
    });
    data.identity.level = 21;
    expect(compileDnd5eCharacterAction(action, data, derived)).toMatchObject({
      issues: [{ stepId: damageId }],
      ok: false,
    });
  });

  it('keeps incomplete drafts unusable and rejects invalid critical references', () => {
    const { action, data, derived } = fixture();
    action.name = '';
    action.steps[1] = { ...action.steps[1], criticalSourceStepId: saveId } as never;
    const compiled = compileDnd5eCharacterAction(action, data, derived);
    expect(compiled.ok).toBe(false);
    expect(compiled.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        'Give the Action a name.',
        'Choose a valid Attack for critical damage.',
      ]),
    );
  });
});
