import {
  Dice,
  DiceRoll,
  NumberGenerator,
  Parser,
  Results,
  RollGroup,
} from '@dice-roller/rpg-dice-roller';
import {
  type ChatRollCard,
  type ChatRollDefinition,
  type ChatRollExpressionNode,
  type ChatRollGroupNode,
} from '../shared/chatRoll';

type RandomEngine = typeof NumberGenerator.generator.engine;

function normalizeGroup(
  parsed: RollGroup,
  rolled: InstanceType<typeof Results.ResultGroup>,
): ChatRollGroupNode {
  return {
    children: normalizeSequence(parsed.expressions, rolled.results),
    kind: 'group',
    modifiers: [...rolled.modifiers],
    useInTotal: rolled.useInTotal,
    value: rolled.value,
  };
}

function normalizeSequence(
  parsed: unknown[],
  rolled: unknown[],
): ChatRollExpressionNode[] {
  return parsed.map((item, index): ChatRollExpressionNode => {
    const result = rolled[index];
    if (item instanceof RollGroup && result instanceof Results.ResultGroup) {
      return normalizeGroup(item, result);
    }
    if (item instanceof Dice.StandardDice && result instanceof Results.RollResults) {
      const dieKind = item instanceof Dice.FudgeDice
        ? 'fudge'
        : item instanceof Dice.PercentileDice
          ? 'percentile'
          : 'standard';
      return {
        dieKind,
        kind: 'die',
        max: item.max,
        min: item.min,
        notation: item.notation,
        results: result.rolls.map((roll) => ({
          calculationValue: roll.calculationValue,
          initialValue: roll.initialValue,
          modifiers: [...roll.modifiers],
          useInTotal: roll.useInTotal,
          value: roll.value,
        })),
        sides: item.sides,
      };
    }
    if (typeof result === 'number' || typeof item === 'number') {
      return { kind: 'number', value: Number(result ?? item) };
    }
    return { kind: 'token', value: String(result ?? item) };
  });
}

/** Rolls and normalizes a definition without leaking third-party instances. */
export function rollChatCard(
  definition: ChatRollDefinition,
  engine: RandomEngine = NumberGenerator.engines.nodeCrypto,
): ChatRollCard {
  const previousEngine = NumberGenerator.generator.engine;
  NumberGenerator.generator.engine = engine;
  try {
    const sections = definition.sections.map((section) => {
      const parsed = Parser.parse(section.notation);
      const roll = new DiceRoll(section.notation);
      const baseTotal = roll.total;
      const total = section.modifiers.reduce(
        (value, modifier) => value + modifier.value,
        baseTotal,
      );
      if (!Number.isFinite(total)) {
        throw new Error('The roll total is not finite.');
      }
      return {
        ...section,
        baseTotal,
        expression: normalizeSequence(parsed, roll.rolls),
        total,
      };
    });
    return { ...definition, sections };
  } finally {
    NumberGenerator.generator.engine = previousEngine;
  }
}
