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

describe('Collapsible when closed', () => {
  it('reports itself collapsed to assistive technology', () => {
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides its content region', () => {
    expect(region).not.toBeVisible();
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
  it('notifies its owner of the change', () => {
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });
});
