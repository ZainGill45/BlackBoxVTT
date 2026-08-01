import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Surface } from './Surface';
import styles from './Modal.module.css';

interface ModalProps {
  accessibleLabel: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dismissDisabled?: boolean;
  isOpen: boolean;
  initialFocus?: 'dialog' | 'first-control';
  onDismiss: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function Modal({
  accessibleLabel,
  children,
  className,
  contentClassName,
  dismissDisabled = false,
  isOpen,
  initialFocus = 'first-control',
  onDismiss,
  returnFocusRef,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pressStartedInsideContent = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return undefined;
    }

    if (!isOpen) {
      return undefined;
    }

    previousFocusRef.current =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    if (initialFocus === 'dialog') {
      dialog.focus();
    } else {
      dialog
        .querySelector<HTMLElement>(
          [
            '[autofocus]:not(:disabled)',
            'button:not(:disabled)',
            '[href]',
            'input:not(:disabled)',
            'select:not(:disabled)',
            'textarea:not(:disabled)',
            '[tabindex]:not([tabindex="-1"])',
          ].join(', '),
        )
        ?.focus();
    }

    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }

      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;

      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [initialFocus, isOpen, returnFocusRef]);

  const dismiss = () => {
    if (!dismissDisabled) {
      onDismiss();
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    dismiss();
  };

  // A drag that starts inside the dialog — selecting text in a field, say — and
  // ends on the backdrop still reports the dialog itself as the click target.
  // Vetoing those presses stops the modal from vanishing mid-edit, while a
  // click with no press behind it (a synthesized or keyboard one) still counts.
  const handleMouseDown = (event: MouseEvent<HTMLDialogElement>) => {
    pressStartedInsideContent.current = event.target !== event.currentTarget;
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    const startedInsideContent = pressStartedInsideContent.current;
    pressStartedInsideContent.current = false;
    if (!startedInsideContent && event.target === event.currentTarget) {
      dismiss();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={accessibleLabel}
      aria-modal="true"
      className={[styles.modal, className].filter(Boolean).join(' ')}
      tabIndex={initialFocus === 'dialog' ? -1 : undefined}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      onMouseDown={handleMouseDown}
    >
      <Surface className={styles.surface}>
        <div
          className={[styles.content, contentClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </Surface>
    </dialog>
  );
}
