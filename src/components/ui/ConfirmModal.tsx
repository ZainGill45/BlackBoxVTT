import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import styles from './ConfirmModal.module.css';

interface ConfirmModalProps {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel?: string;
  isOpen: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

export function ConfirmModal({
  cancelLabel = 'Cancel',
  children,
  confirmLabel = 'Delete',
  isOpen,
  message,
  onCancel,
  onConfirm,
  title,
}: ConfirmModalProps) {
  return (
    <Modal accessibleLabel={title} isOpen={isOpen} onDismiss={onCancel}>
      <div className={styles.content}>
        <h2>{title}</h2>
        <p>{message}</p>
        {children}
        <div className={styles.actions}>
          <Button autoFocus type="button" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
