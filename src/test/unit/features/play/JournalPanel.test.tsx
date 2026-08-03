import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { JournalPanel } from '../../../../features/play/JournalPanel';

describe('JournalPanel', () => {
  it('renders the empty searchable shell with an enabled no-op add control', async () => {
    const user = userEvent.setup();
    const { container } = render(<JournalPanel />);
    const search = screen.getByRole('searchbox', { name: 'Search journal' });
    const add = screen.getByRole('button', { name: 'Add journal entry' });

    expect(add).toBeEnabled();
    expect(
      container.querySelector('[data-sidebar-icon="journal"] svg'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Characters|Monsters|Items|Spells|Notes/ }))
      .not.toBeInTheDocument();

    const beforeAdd = container.innerHTML;
    await user.click(add);
    expect(container.innerHTML).toBe(beforeAdd);

    await user.type(search, 'goblin');
    expect(search).toHaveValue('goblin');
    expect(
      screen.getByRole('button', { name: 'Clear journal search' }),
    ).toBeVisible();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
  });
});
