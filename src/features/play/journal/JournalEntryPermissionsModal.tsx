import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import type {
  JournalAccessLevel,
  JournalPermissionConfiguration,
  JournalPermissionSubject,
  SystemJournalEntrySummary,
} from '../../../shared/journal';
import styles from './JournalEntryPermissionsModal.module.css';

interface JournalEntryPermissionsModalProps {
  entry: SystemJournalEntrySummary;
  onDismiss: () => void;
  onSave: (permissions: JournalPermissionConfiguration<JournalAccessLevel>) => Promise<string | null>;
  users: JournalPermissionSubject[];
}

const LABELS: Record<JournalAccessLevel, string> = {
  edit: 'Edit',
  none: 'No access',
  view: 'View',
};

export function JournalEntryPermissionsModal({
  entry,
  onDismiss,
  onSave,
  users,
}: JournalEntryPermissionsModalProps) {
  const [permissions, setPermissions] = useState<
    JournalPermissionConfiguration<JournalAccessLevel>
  >(() => ({
    allPlayers: entry.permissions!.allPlayers,
    overrides: entry.permissions!.overrides.map((override) => ({ ...override })),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = [{ id: null, username: 'All players' }, ...users];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const failure = await onSave(permissions);
      if (failure) setError(failure);
      else onDismiss();
    } catch {
      setError('The permission changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      accessibleLabel={`Edit permissions for ${entry.name}`}
      className={styles.modal}
      contentClassName={styles.content}
      initialFocus="dialog"
      isOpen
      onDismiss={() => !saving && onDismiss()}
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>Journal access</span>
        <h2>Edit permissions</h2>
        <p>
          Set the default for <strong>{entry.name}</strong>, then override only
          the players who need different access.
        </p>
      </header>
      <div className={styles.permissionMatrix} role="table" aria-label="Permission access matrix">
        <div className={styles.permissionMatrixHeader} role="row">
          <span role="columnheader">Player</span>
          <span role="columnheader">Access</span>
          <span role="columnheader">Effective</span>
        </div>
        {rows.map((user) => {
          const override = user.id
            ? permissions.overrides.find((item) => item.userId === user.id)?.access
            : permissions.allPlayers;
          const effective = user.id
            ? override ?? permissions.allPlayers
            : permissions.allPlayers;
          return (
            <div className={styles.permissionMatrixRow} key={user.id ?? 'all'} role="row">
              <span className={styles.player} role="cell">
                {user.username}
                {!user.id ? <small>Campaign default</small> : null}
              </span>
              <select
                aria-label={`${user.username} permission`}
                disabled={saving}
                value={user.id ? override ?? 'use_default' : override}
                onChange={(event) => {
                  const access = event.currentTarget.value;
                  if (!user.id) {
                    setPermissions((current) => ({
                      ...current,
                      allPlayers: access as JournalAccessLevel,
                    }));
                    return;
                  }
                  setPermissions((current) => ({
                    ...current,
                    overrides: access === 'use_default'
                      ? current.overrides.filter((item) => item.userId !== user.id)
                      : [
                          ...current.overrides.filter((item) => item.userId !== user.id),
                          { access: access as JournalAccessLevel, userId: user.id! },
                        ],
                  }));
                }}
              >
                {user.id ? <option value="use_default">Use default</option> : null}
                {(['none', 'view', 'edit'] as const).map((access) => (
                  <option key={access} value={access}>{LABELS[access]}</option>
                ))}
              </select>
              <strong data-access={effective} role="cell">{LABELS[effective]}</strong>
            </div>
          );
        })}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <footer className={styles.actions}>
        <Button disabled={saving} onClick={onDismiss}>Cancel</Button>
        <Button disabled={saving} variant="primary" onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </footer>
    </Modal>
  );
}
