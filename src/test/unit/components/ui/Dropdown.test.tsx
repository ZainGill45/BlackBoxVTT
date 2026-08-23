import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown, DropdownOption } from '../../../../components/ui/Dropdown';

function choices(mode: 'single' | 'multiple' | 'action' = 'single') {
  const onSelect = vi.fn();
  render(
    <Dropdown label="Species" mode={mode}>
      <DropdownOption active label="Human" onSelect={onSelect} />
      <DropdownOption label="Elf" onSelect={onSelect} />
      <DropdownOption disabled label="Dwarf" onSelect={onSelect} />
    </Dropdown>,
  );
  return onSelect;
}

describe('Dropdown', () => {
  it('exposes single and multiple selection with listbox semantics', () => {
    choices();
    expect(screen.getByRole('listbox', { hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Human', hidden: true }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('uses menu semantics for action mode', () => {
    choices('action');
    expect(screen.getByRole('menu', { hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Human', hidden: true }))
      .toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: 'Elf', hidden: true }))
      .toBeInTheDocument();
  });

  it('opens from an arrow key and moves between enabled options', async () => {
    choices();
    const trigger = screen.getByRole('button', { name: 'Species' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Human' })).toHaveFocus();
    });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Elf' })).toHaveFocus();
  });

  it('keeps a multiple-selection panel open after a choice', async () => {
    const user = userEvent.setup();
    const onSelect = choices('multiple');
    const trigger = screen.getByRole('button', { name: 'Species' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Elf' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(trigger.closest('details')).toHaveAttribute('open');
  });
});
