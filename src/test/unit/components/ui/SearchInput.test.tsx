import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../../../../components/ui/SearchInput';

describe('SearchInput', () => {
  it('owns clearing through both Escape and its clear action', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchInput label="Search pages" onChange={onChange} value="dragon" />,
    );

    await user.click(screen.getByLabelText('Search pages'));
    await user.keyboard('{Escape}');
    expect(onChange).toHaveBeenLastCalledWith('');

    rerender(
      <SearchInput label="Search pages" onChange={onChange} value="wizard" />,
    );
    await user.click(screen.getByRole('button', { name: 'Clear search pages' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
