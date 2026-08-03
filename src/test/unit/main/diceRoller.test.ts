import { NumberGenerator } from '@dice-roller/rpg-dice-roller';
import { describe, expect, it } from 'vitest';
import { rollChatCard } from '../../../main/diceRoller';
import {
  classifyRollOutcome,
  type ChatRollDefinition,
  type ChatRollDieNode,
  type ChatRollExpressionNode,
} from '../../../shared/chatRoll';

function definition(notation: string): ChatRollDefinition {
  return {
    category: 'Roll',
    sections: [{ label: notation, modifiers: [], notation, typeLabel: null }],
    title: null,
  };
}

function die(
  value: number,
  options: { included?: boolean; modifiers?: string[] } = {},
): ChatRollDieNode {
  return {
    dieKind: 'standard',
    kind: 'die',
    max: 20,
    min: 1,
    notation: '1d20',
    results: [
      {
        calculationValue: value,
        initialValue: value,
        modifiers: options.modifiers ?? [],
        useInTotal: options.included ?? true,
        value,
      },
    ],
    sides: 20,
  };
}

describe('authoritative dice normalization', () => {
  it('uses an injected deterministic engine and appends labelled modifiers', () => {
    const input = definition('1d20');
    input.sections[0].modifiers = [{ label: 'WIS', value: 2 }];
    const card = rollChatCard(input, NumberGenerator.engines.max);

    expect(card.sections[0]).toMatchObject({ baseTotal: 20, total: 22 });
    expect(card.sections[0].expression[0]).toMatchObject({
      dieKind: 'standard',
      kind: 'die',
      results: [{ initialValue: 20, useInTotal: true }],
      sides: 20,
    });
    expect(JSON.stringify(card)).not.toContain('RollResult');
  });

  it.each([
    ['percentile', '1d%', 'percentile'],
    ['Fudge', '1dF.2', 'fudge'],
    ['arbitrary sides', '1d7', 'standard'],
    ['grouped keep', '{1d6, 1d8}kh1', undefined],
    ['mathematical', 'floor(1d6 / 2)', undefined],
    ['keep/drop', '4d6kh3', 'standard'],
    ['reroll', '1d6ro=1', 'standard'],
    ['explode', '1d6!', 'standard'],
    ['target', '1d6>=4', 'standard'],
    ['critical', '1d6cs=6cf=1', 'standard'],
  ])('normalizes %s notation', (_name, notation, dieKind) => {
    const card = rollChatCard(definition(notation), NumberGenerator.engines.max);
    expect(card.sections[0].total).toBeTypeOf('number');
    expect(card.sections[0].expression.length).toBeGreaterThan(0);
    if (dieKind) {
      expect(JSON.stringify(card.sections[0].expression)).toContain(
        `"dieKind":"${dieKind}"`,
      );
    }
  });
});

describe('roll outcome classification', () => {
  it.each<[string, ChatRollExpressionNode[], string]>([
    ['maximum', [die(20)], 'success'],
    ['minimum', [die(1)], 'failure'],
    ['mixed', [die(20), die(1)], 'mixed'],
    ['neutral', [die(10)], 'neutral'],
    ['excluded', [die(20, { included: false })], 'neutral'],
    ['explicit success', [die(10, { modifiers: ['target-success'] })], 'success'],
    ['explicit failure', [die(10, { modifiers: ['critical-failure'] })], 'failure'],
  ])('classifies %s results', (_name, nodes, expected) => {
    expect(classifyRollOutcome(nodes)).toBe(expected);
  });
});
