import { Button } from '../../components/ui/Button';
import styles from './ConnectionScreen.module.css';

export interface SavedEntryViewModel {
  detail: string;
  id: string;
  title: string;
  unavailable?: boolean;
}

interface SavedEntryListProps {
  deletingId: string | null;
  entries: readonly SavedEntryViewModel[];
  exportingId: string | null;
  label: string;
  pendingDeleteId: string | null;
  salvagingId: string | null;
  onDeleteRequest: (id: string) => void;
  onExport: (id: string) => void;
  onOpen: (id: string) => void;
  onSalvage: (id: string) => void;
}

export function SavedEntryList({
  deletingId,
  entries,
  exportingId,
  label,
  pendingDeleteId,
  salvagingId,
  onDeleteRequest,
  onExport,
  onOpen,
  onSalvage,
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
          const isExporting = exportingId === entry.id;
          const isSalvaging = salvagingId === entry.id;
          const isUnavailable = entry.unavailable === true;
          const isBusy = isDeleting || isExporting || isSalvaging;

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
                  disabled={isBusy}
                  onClick={() => onDeleteRequest(entry.id)}
                >
                  {isDeleting
                    ? 'Deleting…'
                    : isPendingDelete
                      ? 'Confirm'
                      : 'Delete'}
                </Button>
                {isUnavailable ? (
                  <Button
                    size="compact"
                    variant="secondary"
                    aria-label={`Salvage ${entry.title}`}
                    disabled={isBusy}
                    onClick={() => onSalvage(entry.id)}
                  >
                    {isSalvaging ? 'Salvaging…' : 'Salvage'}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="compact"
                      variant="secondary"
                      aria-label={`Export ${entry.title}`}
                      disabled={isBusy}
                      onClick={() => onExport(entry.id)}
                    >
                      {isExporting ? 'Exporting' : 'Export'}
                    </Button>
                    <Button
                      size="compact"
                      variant="secondary"
                      aria-label={`Open ${entry.title}`}
                      disabled={isBusy}
                      onClick={() => onOpen(entry.id)}
                    >
                      Open
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
