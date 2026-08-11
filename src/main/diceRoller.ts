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
  type ChatRollConditionalSectionDefinition,
  type ChatRollDefinition,
  type ChatRollExpressionNode,
  type ChatRollGroupNode,
  type ChatRollOrdinarySectionDefinition,
  type ChatRollOrdinarySectionResult,
  type ChatRollSectionResult,
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
    const rollOrdinary = (
      section: ChatRollOrdinarySectionDefinition,
      notation = section.notation,
    ): ChatRollOrdinarySectionResult => {
      const parsed = Parser.parse(notation);
      const roll = new DiceRoll(notation);
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
    };
    const ordinaryResults = new Map<number, ChatRollOrdinarySectionResult>();
    const ordinaryAt = (index: number): ChatRollOrdinarySectionResult => {
      const existing = ordinaryResults.get(index);
      if (existing) return existing;
      const section = definition.sections[index];
      if (!section || 'kind' in section) {
        throw new Error('Conditional roll source is not an ordinary roll.');
      }
      const result = rollOrdinary(section);
      ordinaryResults.set(index, result);
      return result;
    };
    const isNaturalMaximumD20 = (source: ChatRollOrdinarySectionResult) => {
      const die = source.expression.find((node) => node.kind === 'die');
      return !!die &&
        die.dieKind === 'standard' &&
        die.sides === 20 &&
        die.results.length === 1 &&
        die.results[0].initialValue === die.max;
    };
    const rollConditional = (
      section: ChatRollConditionalSectionDefinition,
    ): ChatRollSectionResult => {
      const usedAlternate = isNaturalMaximumD20(
        ordinaryAt(section.sourceSection),
      );
      const rolledNotation = usedAlternate
        ? section.alternateNotation
        : section.notation;
      const rolled = rollOrdinary(section, rolledNotation);
      return {
        ...section,
        baseTotal: rolled.baseTotal,
        expression: rolled.expression,
        rolledNotation,
        total: rolled.total,
        usedAlternate,
      };
    };
    const sections = definition.sections.map((section, index) => {
      if (!('kind' in section)) return ordinaryAt(index);
      if (section.kind === 'conditional-roll') return rollConditional(section);
      return section;
    });
    return { ...definition, sections };
  } finally {
    NumberGenerator.generator.engine = previousEngine;
  }
}
