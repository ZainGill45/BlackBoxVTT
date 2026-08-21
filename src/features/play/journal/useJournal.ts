import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { JournalApi, JournalManifest } from '../../../shared/journal';
import type { PermissionSubject } from '../../../shared/permissions';

/**
 * A campaign's journal, already read.
 *
 * Handed to the store at construction so the journal tab paints its entries on
 * the first render rather than an empty journal it fills in later.
 */
export interface JournalSnapshot {
  manifest: JournalManifest;
  users: readonly PermissionSubject[];
}

export interface JournalStore {
  error: string | null;
  /** Null only until the first read lands for a campaign opened without a seed. */
  manifest: JournalManifest | null;
  /**
   * Announces a journal that just came back from a read, before it is on
   * screen. Anything holding a copy of one entry reconciles here, in the same
   * update that applies the read, so nothing renders against a journal its own
   * copy has not been checked against yet. Returns its own removal.
   */
  onRead: (listener: (manifest: JournalManifest) => void) => () => void;
  refresh: () => Promise<void>;
  /**
   * Re-reads who can be granted access. The roster changes in server settings
   * rather than here, so whoever is about to show it asks for it first.
   */
  refreshUsers: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setManifest: Dispatch<SetStateAction<JournalManifest | null>>;
  users: PermissionSubject[];
}

/**
 * Owns the campaign's journal for the play screen.
 *
 * It lives above the journal tab because that panel is unmounted every time the
 * sidebar switches away from it. Owned here, the journal outlives the switch,
 * so returning to the tab shows the entries rather than an empty journal being
 * read all over again.
 */
export function useJournal(
  journalApi: JournalApi | undefined,
  campaignId: string,
  role: 'gm' | 'player',
  seed?: JournalSnapshot,
): JournalStore {
  const [manifest, setManifest] = useState<JournalManifest | null>(
    () => seed?.manifest ?? null,
  );
  const [users, setUsers] = useState<PermissionSubject[]>(() => [
    ...(seed?.users ?? []),
  ]);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const usersRequestRef = useRef(0);
  const readListeners = useRef(
    new Set<(manifest: JournalManifest) => void>(),
  );

  const onRead = useCallback(
    (listener: (manifest: JournalManifest) => void) => {
      readListeners.current.add(listener);
      return () => {
        readListeners.current.delete(listener);
      };
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!journalApi) {
      return;
    }
    const request = ++requestRef.current;
    const result = await journalApi.list({ campaignId });
    // A newer read started while this one was in flight, and it wins.
    if (request !== requestRef.current) return;
    if (result.ok) {
      setManifest(result.value);
      for (const listener of readListeners.current) {
        listener(result.value);
      }
    } else {
      setError(result.error.message);
    }
  }, [campaignId, journalApi]);

  const refreshUsers = useCallback(async () => {
    // Only the Game Master is offered the roster, or allowed to read it.
    if (!journalApi || role !== 'gm') {
      return;
    }
    const request = ++usersRequestRef.current;
    const result = await journalApi.listUsers({ campaignId });
    if (request === usersRequestRef.current && result.ok) {
      setUsers(result.value);
    }
  }, [campaignId, journalApi, role]);

  useEffect(() => {
    if (!journalApi) {
      return undefined;
    }
    let active = true;
    const remove = journalApi.onChanged((event) => {
      if (event.campaignId === campaignId) void refresh();
    });
    /* Read even when seeded, because the snapshot was taken before the
       subscription above existed and a change landing in that gap would
       otherwise be lost. A seeded journal is already on screen, so this
       replaces it without ever showing an empty one. */
    void Promise.resolve().then(async () => {
      if (active) await refresh();
    });
    // Deferred so the first roster never lands during this effect.
    void Promise.resolve().then(refreshUsers);
    return () => {
      active = false;
      remove();
    };
  }, [campaignId, journalApi, refresh, refreshUsers, role]);

  return {
    error,
    manifest,
    onRead,
    refresh,
    refreshUsers,
    setError,
    setManifest,
    users,
  };
}
