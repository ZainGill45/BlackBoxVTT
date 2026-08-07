import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('4D4 + 4')).toBeInTheDocument();
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
    expect(screen.getByText('Fixture - Roll')).toBeInTheDocument();
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
          sections: fixture.sections.map(
            ({ label, modifiers, notation, typeLabel }) => ({
              label,
              modifiers,
              notation,
              typeLabel,
            }),
          ),
          title: fixture.title,
        }}
      />,
    );
    expect(screen.getAllByLabelText('Roll pending')).toHaveLength(2);
  });
});
