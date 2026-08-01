import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';

function renderModal({
  dismissDisabled = false,
  isOpen = true,
  onDismiss = vi.fn(),
}: {
  dismissDisabled?: boolean;
  isOpen?: boolean;
  onDismiss?: () => void;
} = {}) {
  const view = render(
    <Modal
      accessibleLabel="Trust this campaign"
      dismissDisabled={dismissDisabled}
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      <p>Fingerprint details</p>
      <Button autoFocus>Cancel</Button>
    </Modal>,
  );

  return { onDismiss, ...view };
}

describe('Modal', () => {
  it('opens with accessible modal semantics and closes when requested', () => {
    const { rerender } = renderModal();
    const dialog = screen.getByRole('dialog', {
      name: 'Trust this campaign',
    });

    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    rerender(
      <Modal
        accessibleLabel="Trust this campaign"
        isOpen={false}
        onDismiss={vi.fn()}
      >
        <p>Fingerprint details</p>
        <Button>Cancel</Button>
      </Modal>,
    );

    expect(dialog).not.toHaveAttribute('open');
  });

  it('renders one content box without a visible heading or footer', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', {
      name: 'Trust this campaign',
    });

    expect(dialog.querySelector('header')).toBeNull();
    expect(dialog.querySelector('footer')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Trust this campaign' }),
    ).not.toBeInTheDocument();
  });

  it('dismisses from Escape and backdrop clicks but not content clicks', () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    const dialog = screen.getByRole('dialog', {
      name: 'Trust this campaign',
    });

    fireEvent.click(screen.getByText('Fingerprint details'));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('survives a drag that starts in the content and ends on the backdrop', () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    const dialog = screen.getByRole('dialog', {
      name: 'Trust this campaign',
    });

    // Selecting text in a field and releasing past the edge of the dialog: the
    // click lands on the dialog, but the press began inside it.
    fireEvent.mouseDown(screen.getByText('Fingerprint details'));
    fireEvent.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();

    // A press that genuinely starts on the backdrop still dismisses.
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('blocks dismissal while disabled', () => {
    const onDismiss = vi.fn();
    renderModal({ dismissDisabled: true, onDismiss });
    const dialog = screen.getByRole('dialog', {
      name: 'Trust this campaign',
    });

    fireEvent.click(dialog);
    fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true }),
    );

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restores focus to the element active before opening', () => {
    const { rerender } = render(
      <>
        <button type="button">Open modal</button>
        <Modal
          accessibleLabel="Trust this campaign"
          isOpen={false}
          onDismiss={vi.fn()}
        >
          Fingerprint details
          <Button autoFocus>Cancel</Button>
        </Modal>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open modal' });
    trigger.focus();

    rerender(
      <>
        <button type="button">Open modal</button>
        <Modal
          accessibleLabel="Trust this campaign"
          isOpen
          onDismiss={vi.fn()}
        >
          Fingerprint details
          <Button autoFocus>Cancel</Button>
        </Modal>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    rerender(
      <>
        <button type="button">Open modal</button>
        <Modal
          accessibleLabel="Trust this campaign"
          isOpen={false}
          onDismiss={vi.fn()}
        >
          Fingerprint details
          <Button>Cancel</Button>
        </Modal>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Open modal' })).toHaveFocus();
  });

  it('can focus the dialog without arbitrarily focusing its first control', () => {
    render(
      <Modal
        accessibleLabel="Tool settings"
        initialFocus="dialog"
        isOpen
        onDismiss={vi.fn()}
      >
        <select aria-label="First setting">
          <option>Default</option>
        </select>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Tool settings' });
    expect(dialog).toHaveFocus();
    expect(screen.getByLabelText('First setting')).not.toHaveFocus();
  });
});
