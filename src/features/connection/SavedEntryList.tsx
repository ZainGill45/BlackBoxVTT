import { Button } from '../../components/ui/Button';
import styles from './ConnectionScreen.module.css';

export interface SavedEntryViewModel {
  detail: string;
  id: string;
  title: string;
}

interface SavedEntryListProps {
  deletingId: string | null;
  entries: readonly SavedEntryViewModel[];
  label: string;
  pendingDeleteId: string | null;
  onDeleteRequest: (id: string) => void;
  onOpen: (id: string) => void;
}

export function SavedEntryList({
  deletingId,
  entries,
  label,
  pendingDeleteId,
  onDeleteRequest,
  onOpen,
}: SavedEntryListProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className={styles.savedSection} aria-labelledby="campaign-heading">
      <div className={styles.divider}>
        <span aria-hidden="true" />
        <h2 id="campaign-heading">{label}</h2>
        <span aria-hidden="true" />
      </div>

      <ul className={styles.savedList}>
        {entries.map((entry) => {
          const isPendingDelete = pendingDeleteId === entry.id;
          const isDeleting = deletingId === entry.id;

          return (
            <li className={styles.savedEntry} key={entry.id}>
              <div className={styles.savedEntryCopy}>
                <strong>{entry.title}</strong>
                <span>{entry.detail}</span>
              </div>

              <div className={styles.savedEntryActions}>
                <Button
                  size="compact"
                  variant="danger"
                  aria-label={
                    isDeleting
                      ? `Deleting ${entry.title}`
                      : isPendingDelete
                      ? `Confirm deletion of ${entry.title}`
                      : `Delete ${entry.title}`
                  }
                  aria-pressed={isPendingDelete}
                  disabled={isDeleting}
                  onClick={() => onDeleteRequest(entry.id)}
                >
                  {isDeleting
                    ? 'Deleting…'
                    : isPendingDelete
                      ? 'Confirm'
                      : 'Delete'}
                </Button>
                <Button
                  size="compact"
                  variant="secondary"
                  aria-label={`Open ${entry.title}`}
                  onClick={() => onOpen(entry.id)}
                >
                  Open
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
