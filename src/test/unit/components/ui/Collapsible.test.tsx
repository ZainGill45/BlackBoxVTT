import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collapsible } from '../../../../components/ui/Collapsible';

let onExpandedChange: ReturnType<typeof vi.fn>;
let trigger: HTMLElement;
let region: HTMLElement;

beforeEach(() => {
  onExpandedChange = vi.fn();
  render(
    <Collapsible label="Advanced details" onExpandedChange={onExpandedChange}>
      Diagnostic content
    </Collapsible>,
  );
  trigger = screen.getByRole('button', { name: 'Advanced details' });
  region = screen.getByRole('region', { hidden: true });
});

/** The icon stroke must stay square-cornered to match the visual system. */
function expectSquareStroke(icon: Element | null) {
  expect(icon).toHaveAttribute('stroke-linecap', 'butt');
  expect(icon).toHaveAttribute('stroke-linejoin', 'miter');
  expect(icon).toHaveAttribute('stroke-width', '1');
}

describe('Collapsible when closed', () => {
  it('reports itself collapsed to assistive technology', () => {
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides its content region', () => {
    expect(region).not.toBeVisible();
  });

  it('shows the open affordance drawn with a square stroke', () => {
    const icon = trigger.querySelector('[data-collapsible-icon="open"]');
    expect(icon).toBeInTheDocument();
    expectSquareStroke(icon?.querySelector('path') ?? null);
  });
});

describe('Collapsible once opened', () => {
  beforeEach(async () => {
    await userEvent.setup().click(trigger);
  });

  it('reports itself expanded to assistive technology', () => {
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('reveals its content region', () => {
    expect(region).toBeVisible();
  });

  it('shows the close affordance drawn with a square stroke', () => {
    const icon = trigger.querySelector('[data-collapsible-icon="close"]');
    expect(icon).toBeInTheDocument();
    expectSquareStroke(icon?.querySelector('path') ?? null);
  });

  it('notifies its owner of the change', () => {
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });
});
