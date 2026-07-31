import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Collapsible } from './Collapsible';

describe('Collapsible', () => {
  it('toggles its accessible content region', async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <Collapsible
        label="Advanced details"
        onExpandedChange={onExpandedChange}
      >
        Diagnostic content
      </Collapsible>,
    );

    const trigger = screen.getByRole('button', {
      name: 'Advanced details',
    });
    const region = screen.getByRole('region', { hidden: true });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(
      trigger.querySelector('[data-collapsible-icon="open"]'),
    ).toBeInTheDocument();
    const iconPath = trigger.querySelector(
      '[data-collapsible-icon="open"] path',
    );
    expect(iconPath).toHaveAttribute('stroke-linecap', 'butt');
    expect(iconPath).toHaveAttribute('stroke-linejoin', 'miter');
    expect(iconPath).toHaveAttribute('stroke-width', '1');
    expect(region).not.toBeVisible();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      trigger.querySelector('[data-collapsible-icon="close"]'),
    ).toBeInTheDocument();
    const closePath = trigger.querySelector(
      '[data-collapsible-icon="close"] path',
    );
    expect(closePath).toHaveAttribute('stroke-linecap', 'butt');
    expect(closePath).toHaveAttribute('stroke-linejoin', 'miter');
    expect(closePath).toHaveAttribute('stroke-width', '1');
    expect(region).toBeVisible();
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });
});
