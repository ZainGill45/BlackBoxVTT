import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownOption } from './Dropdown';
import { Modal } from './Modal';
import {
  PERMISSION_AUTOSAVE_DELAY_MS,
  clonePermissionConfiguration,
  samePermissionConfiguration,
  withPermissionOverride,
  type PermissionConfiguration,
  type PermissionSubject,
} from '../../shared/permissions';
import styles from './PermissionsModal.module.css';

export type PermissionCommitOutcome =
  | { kind: 'ok' }
  | { kind: 'stale'; revision: number }
  | { kind: 'failed'; message: string };

export interface PermissionsModalSubject<TAccess extends string> {
  /** Writes the whole configuration. Returning `stale` reports the live revision. */
  commit(
    permissions: PermissionConfiguration<TAccess>,
    revision: number,
  ): Promise<PermissionCommitOutcome>;
  configuration: PermissionConfiguration<TAccess>;
  /** Explains what this particular subject's access governs. */
  description: string;
  /** Resolves per user so a subject can spell out what an inherited level means. */
  levelLabel(level: TAccess, userId: string | null): string;
  levels: readonly TAccess[];
  revision: number;
  users: readonly PermissionSubject[];
}

interface PermissionsModalProps<TAccess extends string> {
  onDismiss: () => void;
  subject: PermissionsModalSubject<TAccess>;
}

/**
 * The one permissions editor in the app.
 *
 * Every subject gets the same shape: a default for all players, then one row
 * per player. There is no Cancel and no Save because a change is the save; the
 * modal only closes once the last edit has landed, so dismissing can never be
 * the thing that loses one.
 */
export function PermissionsModal<TAccess extends string>({
  onDismiss,
  subject,
}: PermissionsModalProps<TAccess>) {
  const [draft, setDraft] = useState(() =>
    clonePermissionConfiguration(subject.configuration),
  );
  const [status, setStatus] = useState<'failed' | 'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const draftRef = useRef(draft);
  const savedRef = useRef(subject.configuration);
  const revisionRef = useRef(subject.revision);
  const commitRef = useRef(subject.commit);
  const timerRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /* A save bumps the revision, so the queued write reads the freshest one at
     dispatch rather than whichever was current when the row was clicked. */
  useEffect(() => {
    commitRef.current = subject.commit;
    revisionRef.current = subject.revision;
  });

  /* Adopting an outside change while an edit is pending would silently discard
     what the user just chose, so the incoming configuration only wins when
     nothing local is waiting to be written. */
  useEffect(() => {
    if (timerRef.current !== null) return;
    if (samePermissionConfiguration(subject.configuration, savedRef.current)) return;
    savedRef.current = subject.configuration;
    const adopted = clonePermissionConfiguration(subject.configuration);
    draftRef.current = adopted;
    setDraft(adopted);
  }, [subject.configuration]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = queueRef.current.then(async () => {
      const next = draftRef.current;
      if (samePermissionConfiguration(next, savedRef.current)) return;
      setStatus('saving');
      let outcome = await commitRef.current(next, revisionRef.current);
      if (outcome.kind === 'stale') {
        revisionRef.current = outcome.revision;
        outcome = await commitRef.current(next, outcome.revision);
      }
      if (outcome.kind === 'ok') {
        savedRef.current = next;
        setError(null);
        setStatus('idle');
        return;
      }
      setError(
        outcome.kind === 'failed'
          ? outcome.message
          : 'These permissions changed elsewhere. Check the current access and try again.',
      );
      setStatus('failed');
    });
    queueRef.current = pending;
    return pending;
  }, []);

  const change = (next: PermissionConfiguration<TAccess>) => {
    setDraft(next);
    draftRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, PERMISSION_AUTOSAVE_DELAY_MS);
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  /* Dismissing writes whatever is still pending and stays open if that write
     fails, so the only way out is with the changes safely stored. */
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    void flush().then(() => {
      setClosing(false);
      if (samePermissionConfiguration(draftRef.current, savedRef.current)) onDismiss();
    });
  };

  const rows: { id: string | null; username: string }[] = [
    { id: null, username: 'All players' },
    ...subject.users,
  ];

  return (
    <Modal
      accessibleLabel="Edit Permissions"
      className={styles.modal}
      contentClassName={styles.content}
      initialFocus="dialog"
      isOpen
      onDismiss={dismiss}
    >
      <header className={styles.header}>
        <h2>Edit Permissions</h2>
        <p>{subject.description}</p>
      </header>

      <div className={styles.rows}>
        {rows.map((user) => {
          const selected = user.id
            ? draft.overrides.find((override) => override.userId === user.id)?.access
            : draft.allPlayers;
          const label = selected === undefined
            ? 'Use default'
            : subject.levelLabel(selected, user.id);
          return (
            <div className={styles.row} key={user.id ?? 'all-players'}>
              <span className={styles.rowLabel}>{user.username}</span>
              <Dropdown
                accessibleLabel={`${user.username} permission`}
                className={styles.rowDropdown}
                disabled={closing}
                label={label}
                panelLabel={`${user.username} permission options`}
              >
                {user.id ? (
                  <DropdownOption
                    active={selected === undefined}
                    label="Use default"
                    onSelect={() =>
                      change(withPermissionOverride(draft, user.id!, null))
                    }
                  />
                ) : null}
                {subject.levels.map((level) => (
                  <DropdownOption
                    active={selected === level}
                    key={level}
                    label={subject.levelLabel(level, user.id)}
                    onSelect={() =>
                      change(
                        user.id
                          ? withPermissionOverride(draft, user.id, level)
                          : { ...draft, allPlayers: level },
                      )
                    }
                  />
                ))}
              </Dropdown>
            </div>
          );
        })}
      </div>

      <p className={styles.status} role={status === 'failed' ? 'alert' : 'status'}>
        {status === 'failed' ? error : status === 'saving' ? 'Saving…' : null}
      </p>
    </Modal>
  );
}
