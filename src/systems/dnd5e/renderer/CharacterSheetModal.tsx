import { Modal } from '../../../components/ui/Modal';
import type { SystemJournalEntry } from '../../../shared/journal';
import styles from './CharacterSheetModal.module.css';

interface CharacterSheetModalProps {
  entry: SystemJournalEntry;
  onDismiss: () => void;
}

export function CharacterSheetModal({ entry, onDismiss }: CharacterSheetModalProps) {
  return (
    <Modal
      accessibleLabel={`${entry.name} character sheet`}
      className={styles.modal}
      contentClassName={styles.content}
      initialFocus="dialog"
      isOpen
      onDismiss={onDismiss}
    >
      <div aria-hidden />
    </Modal>
  );
}
