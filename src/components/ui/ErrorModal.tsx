import { Button } from './Button';
import { Modal } from './Modal';
import styles from './ErrorModal.module.css';

interface ErrorModalProps {
  isOpen: boolean;
  message: string;
  onDismiss: () => void;
  title: string;
}

export function ErrorModal({
  isOpen,
  message,
  onDismiss,
  title,
}: ErrorModalProps) {
  return (
    <Modal
      accessibleLabel={title}
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      <div className={styles.content}>
        <h2>{title}</h2>
        <p>{message}</p>
        <Button type="button" variant="primary" onClick={onDismiss} autoFocus>
          OK
        </Button>
      </div>
    </Modal>
  );
}
