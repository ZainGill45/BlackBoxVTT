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
});
