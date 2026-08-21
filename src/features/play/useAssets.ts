import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  AssetApi,
  AssetErrorEvent,
  AssetProgressEvent,
  AssetView,
} from '../../shared/assets';
import type { PermissionSubject } from '../../shared/permissions';

/**
 * A campaign's asset library, already read.
 *
 * Handed to the store at construction so the storage tab paints a populated
 * list on its very first render instead of an empty one it fills in later.
 */
export interface AssetSnapshot {
  assets: readonly AssetView[];
  users: readonly PermissionSubject[];
}

export interface AssetStore {
  assets: AssetView[];
  error: AssetErrorEvent | null;
  /**
   * Announces an asset library that just arrived from the main process, before
   * it is on screen. Anything holding a copy of one asset reconciles here, in
   * the same update that applies the change, so nothing renders against a
   * library its own copy has not been checked against yet. Returns its own
   * removal.
   */
  onChanged: (listener: (assets: AssetView[]) => void) => () => void;
  progress: AssetProgressEvent | null;
  /**
   * Re-reads who can be granted access. The roster changes in server settings
   * rather than here, so whoever is about to show it asks for it first.
   */
  refreshUsers: () => Promise<void>;
  /* How a mutation lands - optimistically, confirmed, or rolled back - is the
     panel's decision, so the panel writes the list directly. The store owns
     where the list comes from and how long it survives. */
  setAssets: Dispatch<SetStateAction<AssetView[]>>;
  setError: Dispatch<SetStateAction<AssetErrorEvent | null>>;
  setProgress: Dispatch<SetStateAction<AssetProgressEvent | null>>;
  users: PermissionSubject[];
}

/**
 * Owns the campaign's asset library for the play screen.
 *
 * It lives above the storage tab because that panel is unmounted every time the
 * sidebar switches away from it. Owned here, the library outlives the switch,
 * so returning to the tab shows the assets rather than an empty library being
 * fetched all over again.
 */
export function useAssets(
  assetApi: AssetApi,
  campaignId: string,
  seed?: AssetSnapshot,
): AssetStore {
  const [assets, setAssets] = useState<AssetView[]>(() => [
    ...(seed?.assets ?? []),
  ]);
  const [users, setUsers] = useState<PermissionSubject[]>(() => [
    ...(seed?.users ?? []),
  ]);
  const [error, setError] = useState<AssetErrorEvent | null>(null);
  const [progress, setProgress] = useState<AssetProgressEvent | null>(null);
  const changedListeners = useRef(new Set<(assets: AssetView[]) => void>());
  const usersRequestRef = useRef(0);

  const refreshUsers = useCallback(async () => {
    /* Only the Game Master is offered the roster, and only the Game Master is
       ever allowed to read it, so a player's denial is not an error to show. */
    const request = ++usersRequestRef.current;
    const result = await assetApi.listUsers({ campaignId });
    if (request === usersRequestRef.current && result.ok) {
      setUsers(result.value);
    }
  }, [assetApi, campaignId]);

  const onChanged = useCallback((listener: (assets: AssetView[]) => void) => {
    changedListeners.current.add(listener);
    return () => {
      changedListeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let current = true;
    let receivedChange = false;
    const removeChanged = assetApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        receivedChange = true;
        setAssets(event.assets);
        for (const listener of changedListeners.current) {
          listener(event.assets);
        }
      }
    });
    const removeProgress = assetApi.onProgress((event) => {
      if (event.scope === 'import') {
        setProgress(event);
      }
    });
    /* Read even when seeded, because the snapshot was taken before the
       subscription above existed and a change landing in that gap would
       otherwise be lost. A seeded library is already on screen, so this
       replaces it without ever showing an empty one. */
    void assetApi.list({ campaignId }).then((result) => {
      if (!current) {
        return;
      }
      if (result.ok) {
        if (!receivedChange) {
          setAssets(result.value);
        }
      } else {
        setError({
          ...result.error,
          campaignId,
          title: 'Campaign assets could not be loaded',
        });
      }
    });
    // Deferred so the first roster never lands during this effect.
    void Promise.resolve().then(refreshUsers);
    return () => {
      current = false;
      removeChanged();
      removeProgress();
    };
  }, [assetApi, campaignId, refreshUsers]);

  return {
    assets,
    error,
    onChanged,
    progress,
    refreshUsers,
    setAssets,
    setError,
    setProgress,
    users,
  };
}
