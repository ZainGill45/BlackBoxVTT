import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import type {
  JournalAccessLevel,
  JournalEntrySummary,
  JournalPageAccessLevel,
  JournalPermissionConfiguration,
  JournalPermissionSubject,
} from '../../../shared/journal';
import styles from './NoteModal.module.css';

const ACCESS_LABELS: Record<JournalAccessLevel | JournalPageAccessLevel, string> = {
  edit: 'Edit',
  inherit: 'Inherit note default',
  none: 'No access',
  view: 'View',
};

export interface JournalPermissionDraft {
  note: JournalPermissionConfiguration<JournalAccessLevel>;
  pages: Record<
    string,
    JournalPermissionConfiguration<JournalPageAccessLevel>
  >;
}

interface JournalPermissionsModalProps {
  initialPageId?: string;
  note: JournalEntrySummary;
  onDismiss: () => void;
  onSave: (draft: JournalPermissionDraft) => Promise<string | null>;
  users: JournalPermissionSubject[];
}

function cloneConfiguration<TAccess extends string>(
  configuration: JournalPermissionConfiguration<TAccess>,
): JournalPermissionConfiguration<TAccess> {
  return {
    allPlayers: configuration.allPlayers,
    overrides: configuration.overrides.map((override) => ({ ...override })),
  };
}

function accessFor<TAccess extends string>(
  configuration: JournalPermissionConfiguration<TAccess>,
  userId: string | null,
): TAccess {
  return userId
    ? configuration.overrides.find((override) => override.userId === userId)
        ?.access ?? configuration.allPlayers
    : configuration.allPlayers;
}

function PermissionMatrix<TAccess extends string>({
  configuration,
  inherited,
  levels,
  onChange,
  users,
}: {
  configuration: JournalPermissionConfiguration<TAccess>;
  inherited?: JournalPermissionConfiguration<JournalAccessLevel>;
  levels: readonly TAccess[];
  onChange: (configuration: JournalPermissionConfiguration<TAccess>) => void;
  users: JournalPermissionSubject[];
}) {
  const rows = [{ id: null, username: 'All players' }, ...users];
  return (
    <div className={styles.permissionMatrix} role="table" aria-label="Permission access matrix">
      <div className={styles.permissionMatrixHeader} role="row">
        <span role="columnheader">Player</span>
        <span role="columnheader">Override</span>
        <span role="columnheader">Effective access</span>
      </div>
      {rows.map((user) => {
        const direct = accessFor(configuration, user.id);
        const inheritedAccess = inherited ? accessFor(inherited, user.id) : null;
        const effective = direct === 'inherit' ? inheritedAccess ?? 'none' : direct;
        const override = user.id
          ? configuration.overrides.find((item) => item.userId === user.id)?.access
          : configuration.allPlayers;
        return (
          <div className={styles.permissionMatrixRow} key={user.id ?? 'all'} role="row">
            <span role="cell">{user.username}</span>
            <select
              aria-label={`${user.username} permission`}
              value={user.id ? override ?? 'use_default' : override}
              onChange={(event) => {
                const access = event.currentTarget.value;
                if (!user.id) {
                  onChange({
                    ...configuration,
                    allPlayers: access as TAccess,
                  });
                  return;
                }
                const otherOverrides = configuration.overrides.filter(
                  (item) => item.userId !== user.id,
                );
                onChange({
                  ...configuration,
                  overrides:
                    access === 'use_default'
                      ? otherOverrides
                      : [
                          ...otherOverrides,
                          { access: access as TAccess, userId: user.id },
                        ],
                });
              }}
            >
              {user.id ? <option value="use_default">Use default</option> : null}
              {levels.map((level) => (
                <option key={level} value={level}>
                  {ACCESS_LABELS[level as JournalAccessLevel | JournalPageAccessLevel] ?? level}
                </option>
              ))}
            </select>
            <strong data-access={effective} role="cell">
              {ACCESS_LABELS[effective as JournalAccessLevel | JournalPageAccessLevel] ?? effective}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function JournalPermissionsModal({
  initialPageId,
  note,
  onDismiss,
  onSave,
  users,
}: JournalPermissionsModalProps) {
  const [selectedScope, setSelectedScope] = useState<'note' | string>(
    initialPageId && note.pages.some(({ id }) => id === initialPageId)
      ? initialPageId
      : 'note',
  );
  const [notePermissions, setNotePermissions] = useState(() =>
    cloneConfiguration(note.permissions!),
  );
  const [pagePermissions, setPagePermissions] = useState(() =>
    Object.fromEntries(
      note.pages.flatMap((page) =>
        page.permissions
          ? [[page.id, cloneConfiguration(page.permissions)] as const]
          : [],
      ),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPage = useMemo(
    () => note.pages.find(({ id }) => id === selectedScope),
    [note.pages, selectedScope],
  );
  const selectedPagePermissions = selectedPage
    ? pagePermissions[selectedPage.id]
    : undefined;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const failure = await onSave({ note: notePermissions, pages: pagePermissions });
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
      accessibleLabel="Edit Journal permissions"
      className={styles.permissionsModal}
      contentClassName={styles.permissionsModalContent}
      initialFocus="dialog"
      isOpen
      onDismiss={() => {
        if (!saving) onDismiss();
      }}
    >
      <header className={styles.permissionsModalHeader}>
        <div>
          <span className={styles.eyebrow}>Access control</span>
          <h2>{note.name}</h2>
        </div>
        <p>
          The note defines the default. Every page can inherit it or grant its
          own access, including when the note default is private.
        </p>
      </header>

      <div className={styles.permissionsModalWorkspace}>
        <nav aria-label="Permission scope" className={styles.permissionScopeList}>
          <button
            aria-current={selectedScope === 'note' ? 'page' : undefined}
            onClick={() => setSelectedScope('note')}
            type="button"
          >
            <span>Note default</span>
            <small>{ACCESS_LABELS[notePermissions.allPlayers]}</small>
          </button>
          {note.pages.map((page) => {
            const configuration = pagePermissions[page.id];
            const custom = Boolean(configuration?.overrides.length);
            return (
              <button
                aria-current={selectedScope === page.id ? 'page' : undefined}
                key={page.id}
                onClick={() => setSelectedScope(page.id)}
                type="button"
              >
                <span>{page.title}</span>
                <small>
                  {custom
                    ? 'Custom'
                    : configuration
                      ? ACCESS_LABELS[configuration.allPlayers]
                      : 'Unavailable'}
                </small>
              </button>
            );
          })}
        </nav>

        <section className={styles.permissionScopeEditor}>
          {selectedScope === 'note' ? (
            <>
              <header>
                <h3>Note default</h3>
                <p>
                  This is the fallback for pages set to inherit. A page can
                  still explicitly grant access when this default is private.
                </p>
              </header>
              <PermissionMatrix
                configuration={notePermissions}
                levels={['none', 'view', 'edit']}
                onChange={setNotePermissions}
                users={users}
              />
            </>
          ) : selectedPage && selectedPagePermissions ? (
            <>
              <header>
                <h3>{selectedPage.title}</h3>
                <p>
                  Choose inherit for the note default, or set access only for
                  this page.
                </p>
              </header>
              <PermissionMatrix
                configuration={selectedPagePermissions}
                inherited={notePermissions}
                levels={['inherit', 'none', 'view', 'edit']}
                onChange={(configuration) =>
                  setPagePermissions((current) => ({
                    ...current,
                    [selectedPage.id]: configuration,
                  }))
                }
                users={users}
              />
            </>
          ) : (
            <p>This page is no longer available.</p>
          )}
        </section>
      </div>

      {error ? <p className={styles.permissionSaveError} role="alert">{error}</p> : null}
      <footer className={styles.permissionsModalActions}>
        <Button disabled={saving} onClick={onDismiss}>Cancel</Button>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </footer>
    </Modal>
  );
}
