import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../../../components/ui/Checkbox';

describe('Checkbox', () => {
  it('uses a native checkbox and reports changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Checkbox onChange={onChange}>Clean up image</Checkbox>);

    const checkbox = screen.getByRole('checkbox', { name: 'Clean up image' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('preserves the disabled native state', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Checkbox disabled onChange={onChange}>
        Used elsewhere
      </Checkbox>,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Used elsewhere' });
    expect(checkbox).toBeDisabled();

    await user.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes an indeterminate native and accessible state', () => {
    const { rerender } = render(
      <Checkbox checked={false} indeterminate readOnly>Always prepared</Checkbox>,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'Always prepared',
    }) as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');

    rerender(<Checkbox checked readOnly>Prepared</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Prepared' })).toBeChecked();
    expect(checkbox.indeterminate).toBe(false);
  });
});
