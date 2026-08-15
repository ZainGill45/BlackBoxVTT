import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DiceRollCard,
  PendingDiceRollCard,
} from '../../../../../features/play/chat/DiceRollCard';
import type {
  ChatRollCard,
  ChatRollDieNode,
} from '../../../../../shared/chatRoll';

function die(sides: number, value: number): ChatRollDieNode {
  return {
    dieKind: 'standard',
    kind: 'die',
    max: sides,
    min: 1,
    notation: `1d${sides}`,
    results: [
      {
        calculationValue: value,
        initialValue: value,
        modifiers: [],
        useInTotal: true,
        value,
      },
    ],
    sides,
  };
}

function card(sides: number, value: number, total = value): ChatRollCard {
  return {
    category: 'Damage',
    sections: [
      {
        baseTotal: value,
        expression: [die(sides, value)],
        label: `1d${sides}`,
        modifiers: [],
        notation: `1d${sides}`,
        total,
        typeLabel: null,
      },
    ],
    title: 'Fixture',
  };
}

describe('DiceRollCard', () => {
  it.each([
    [20, 20, 20],
    [6, 6, 7],
    [4, 4, 15],
  ])('renders an accessible total for d%s', (sides, value, total) => {
    render(<DiceRollCard card={card(sides, value, total)} />);
    const icon = screen.getByRole('img', { name: `Total ${total}` });
    expect(icon).toHaveTextContent(String(total));
  });

  it('preserves exact negative, decimal, and long totals', () => {
    render(<DiceRollCard card={card(6, 6, -123456.75)} />);
    const icon = screen.getByRole('img', { name: 'Total -123456.75' });
    expect(icon).toHaveTextContent('-123456.75');
  });

  it('labels active min and max results and excluded dice', () => {
    const fixture = card(4, 2, 14);
    fixture.sections[0] = {
      ...fixture.sections[0],
      baseTotal: 14,
      expression: [
        {
          ...die(4, 2),
          notation: '4d4',
          results: [
            {
              calculationValue: 2,
              initialValue: 2,
              modifiers: [],
              useInTotal: true,
              value: 2,
            },
            {
              calculationValue: 1,
              initialValue: 1,
              modifiers: [],
              useInTotal: true,
              value: 1,
            },
            {
              calculationValue: 4,
              initialValue: 4,
              modifiers: [],
              useInTotal: true,
              value: 4,
            },
            {
              calculationValue: 3,
              initialValue: 3,
              modifiers: [],
              useInTotal: false,
              value: 3,
            },
          ],
        },
        { kind: 'token', value: '+' },
        { kind: 'number', value: 4 },
      ],
      label: '4d4 + 4',
      notation: '4d4 + 4',
      total: 14,
    };
    render(<DiceRollCard card={fixture} />);

    expect(screen.queryByLabelText('Individual die results')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show rolls for 4d4 + 4' }),
    );
    expect(screen.queryByRole('button', { name: /Show rolls/ })).not.toBeInTheDocument();
    const results = screen
      .getByLabelText('Individual die results')
      .querySelectorAll('[data-outcome]');
    expect([...results].map((result) => result.getAttribute('data-outcome'))).toEqual([
      'neutral',
      'failure',
      'success',
      'neutral',
    ]);
    expect(results[3]).toHaveAttribute('data-included', 'false');
    expect(screen.getByText('4d4 + 4')).toBeInTheDocument();
  });

  it('reveals every dice term, operator, and literal value in the audit trail', () => {
    const fixture = card(4, 2, 36);
    const firstDice = {
      ...die(4, 2),
      notation: '4d4',
    };
    const secondDice = {
      ...die(8, 6),
      notation: '2d8',
    };
    fixture.sections[0] = {
      ...fixture.sections[0],
      baseTotal: 36,
      expression: [
        firstDice,
        { kind: 'token', value: '+' },
        { kind: 'number', value: 4 },
        { kind: 'token', value: '+' },
        secondDice,
        { kind: 'token', value: '+' },
        { kind: 'number', value: 10 },
      ],
      label: '4d4 + 4 + 2d8 + 10',
      notation: '4d4 + 4 + 2d8 + 10',
      total: 36,
    };
    render(<DiceRollCard card={fixture} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show rolls for 4d4 + 4 + 2d8 + 10',
      }),
    );
    expect(screen.getByText('4d4')).toBeInTheDocument();
    expect(screen.getByText('2d8')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getAllByText('+')).toHaveLength(3);
  });

  it('shows titled multi-section equations and a static pending state', () => {
    const fixture = card(20, 20);
    fixture.sections.push({
      ...card(6, 5, 7).sections[0],
      label: 'Damage',
      modifiers: [{ label: 'Flat', value: 2 }],
      typeLabel: 'Fire',
    });
    const { rerender } = render(<DiceRollCard card={fixture} />);
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.queryByText('/R')).not.toBeInTheDocument();
    expect(screen.queryByText('ROLL')).not.toBeInTheDocument();
    expect(screen.getByText('Fire')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Show rolls/ })).toHaveLength(2);
    fireEvent.click(
      screen.getByRole('button', { name: 'Show rolls for Damage' }),
    );
    expect(screen.getByText(/Flat/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show rolls for 1d20' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show rolls for Damage' }),
    ).not.toBeInTheDocument();

    rerender(
      <PendingDiceRollCard
        definition={{
          category: fixture.category,
          sections: fixture.sections.map((section) => {
            if ('kind' in section) throw new Error('Expected an ordinary roll section.');
            const { label, modifiers, notation, typeLabel } = section;
            return {
              label,
              modifiers,
              notation,
              typeLabel,
            };
          }),
          title: fixture.title,
        }}
      />,
    );
    expect(screen.getAllByLabelText('Roll pending')).toHaveLength(2);
    expect(screen.queryByText('/R')).not.toBeInTheDocument();
    expect(screen.queryByText('ROLL')).not.toBeInTheDocument();
  });

  it('groups detail fields and preserves unheaded prose in completed and pending cards', () => {
    const sections = [
      { kind: 'effect' as const, label: 'Detail/Casting Time', text: 'Action' },
      { kind: 'effect' as const, label: 'Detail/Range', text: '60 feet' },
      { kind: 'effect' as const, label: 'Detail/Duration', text: '1 minute' },
      { kind: 'effect' as const, label: 'Detail/Target', text: '1 creature' },
      { kind: 'effect' as const, label: 'Detail/Components', text: 'V, S, M, C, R' },
      { kind: 'effect' as const, label: 'Detail/Material', text: 'a silver thread' },
      { kind: 'effect' as const, label: 'Description', text: 'A bright bolt.' },
      { kind: 'effect' as const, label: 'Details', text: 'The damage increases.' },
    ];
    const { rerender } = render(<DiceRollCard card={{
      category: 'Spell',
      sections,
      title: 'Guiding Bolt',
    }} />);

    const assertPresentation = () => {
      const grid = screen.getByLabelText('Roll details');
      expect(grid.tagName).toBe('DL');
      expect(within(grid).getByText('Casting Time')).toBeInTheDocument();
      expect(within(grid).getByText('Components')).toBeInTheDocument();
      expect(within(grid).getByText('V, S, M, C, R')).toBeInTheDocument();
      expect(within(grid).getByText('Material')).toBeInTheDocument();
      expect(within(grid).getByText('a silver thread')).toBeInTheDocument();
      expect(screen.queryByText('Detail/Casting Time')).not.toBeInTheDocument();
      expect(screen.queryByText('Description')).not.toBeInTheDocument();
      expect(screen.getByText('A bright bolt.')).toBeInTheDocument();
      expect(screen.getByText('The damage increases.')).toBeInTheDocument();
      expect(screen.queryByText('Details')).not.toBeInTheDocument();
      expect(screen.getByText('A bright bolt.').closest('section'))
        .toHaveAttribute('data-static-role', 'description');
      expect(screen.getByText('The damage increases.').closest('section'))
        .toHaveAttribute('data-static-role', 'unheaded');
    };

    assertPresentation();
    rerender(<PendingDiceRollCard definition={{
      category: 'Spell',
      sections,
      title: 'Guiding Bolt',
    }} />);
    assertPresentation();
  });

  it('renders ordered Details, prompts, effects, and critical branch results', () => {
    const fixture: ChatRollCard = {
      category: 'Roll',
      sections: [
        { kind: 'effect', label: 'Details', text: 'Range: 5 feet' },
        {
          baseTotal: 20,
          expression: [die(20, 20)],
          label: 'Attack',
          modifiers: [],
          notation: '1d20',
          total: 20,
          typeLabel: 'Attack',
        },
        {
          alternateNotation: '2d8',
          baseTotal: 12,
          condition: 'first-d20-natural-maximum',
          expression: [die(8, 6), die(8, 6)],
          kind: 'conditional-roll',
          label: 'Damage',
          modifiers: [{ label: 'Strength', value: 3 }],
          notation: '1d8',
          rolledNotation: '2d8',
          sourceSection: 1,
          total: 15,
          typeLabel: 'Slashing',
          usedAlternate: true,
        },
        {
          detail: 'Failure: knocked prone',
          kind: 'prompt',
          label: 'Save',
          value: 'DC 14 DEXTERITY save',
        },
        { kind: 'effect', label: 'Effect', text: 'The weapon hums.' },
      ],
      title: 'Longsword',
    };
    const { rerender } = render(<DiceRollCard card={fixture} />);
    expect(screen.getByText('Range: 5 feet')).toBeInTheDocument();
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
    expect(screen.getByText('Effect')).toBeInTheDocument();
    expect(screen.getByText(/DC 14 DEXTERITY save/)).toBeInTheDocument();
    expect(screen.getByText(/Failure: knocked prone/)).toBeInTheDocument();
    expect(screen.getByText('The weapon hums.')).toBeInTheDocument();
    expect(screen.getByText('Critical damage')).toBeInTheDocument();

    rerender(<PendingDiceRollCard definition={{
      category: fixture.category,
      sections: [
        fixture.sections[0],
        { label: 'Attack', modifiers: [], notation: '1d20', typeLabel: 'Attack' },
        {
          alternateNotation: '2d8',
          condition: 'first-d20-natural-maximum',
          kind: 'conditional-roll',
          label: 'Damage',
          modifiers: [{ label: 'Strength', value: 3 }],
          notation: '1d8',
          sourceSection: 1,
          typeLabel: 'Slashing',
        },
        fixture.sections[3],
        fixture.sections[4],
      ],
      title: fixture.title,
    }} />);
    expect(screen.getAllByLabelText('Roll pending')).toHaveLength(2);
    expect(screen.getByText('Range: 5 feet')).toBeInTheDocument();
    expect(screen.getByText(/DC 14 DEXTERITY save/)).toBeInTheDocument();
  });
});
