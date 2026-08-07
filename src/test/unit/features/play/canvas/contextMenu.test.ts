import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuController } from '../../../../../features/play/canvas/contextMenu';

afterEach(() => {
  document.body.replaceChildren();
});

describe('ContextMenuController', () => {
  it('renders accessible actions, closes on selection, and runs the action', () => {
    const selected = vi.fn();
    const menu = new ContextMenuController({
      deleteItem: 'danger',
      divider: 'divider',
      item: 'item',
      menu: 'menu',
    });

    menu.open(20, 30, 'Canvas actions', [
      { disabled: true, kind: 'action', label: 'Disabled', onSelect: vi.fn() },
      { kind: 'divider' },
      {
        ariaLabel: 'Delete selection',
        danger: true,
        kind: 'action',
        label: 'Delete',
        onSelect: selected,
      },
    ]);

    const root = document.querySelector('[role="menu"]');
    const deleteButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Delete selection"]',
    );
    expect(root?.getAttribute('aria-label')).toBe('Canvas actions');
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    expect(document.activeElement).toBe(deleteButton);

    deleteButton?.click();
    expect(selected).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('returns focus on Escape', () => {
    const returnFocus = vi.fn();
    const menu = new ContextMenuController({
      deleteItem: 'danger',
      divider: 'divider',
      item: 'item',
      menu: 'menu',
    });
    menu.open(
      20,
      30,
      'Image actions',
      [{ kind: 'action', label: 'Duplicate', onSelect: vi.fn() }],
      returnFocus,
    );

    document
      .querySelector('[role="menu"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(returnFocus).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
