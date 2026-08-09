import {
  Check,
  Clapperboard,
  Map as MapIcon,
  MonitorPlay,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/ui/Button';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { ErrorModal } from '../../../components/ui/ErrorModal';
import { IconButton } from '../../../components/ui/IconButton';
import { InlineRename } from '../../../components/ui/InlineRename';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import type { AssetApi } from '../../../shared/assets';
import {
  describeScene,
  type SceneApi,
  type SceneCapabilities,
  type SceneRecord,
} from '../../../shared/scenes';
import type { PermissionSubject } from '../../../shared/permissions';
import { PermissionsModal } from '../../../components/ui/PermissionsModal';
import { scenePermissionSubject } from './scenePermissionSubject';
import {
  DELETE_CONFIRMATION_TIMEOUT_MS,
  useDeleteConfirmation,
} from '../../connection/useDeleteConfirmation';
import { SceneSettingsModal } from './SceneSettingsModal';
import type { AssetThumbnail } from './useAssetThumbnails';
import type { SceneStore } from './useScenes';
import styles from './ScenePanel.module.css';

interface ScenePanelProps {
  assetApi?: AssetApi;
  campaignId: string;
  canCreate: boolean;
  sceneApi: SceneApi;
  /** Resolved above the panel so thumbnails survive a sidebar tab switch. */
  thumbnails: ReadonlyMap<string, AssetThumbnail>;
  store: SceneStore;
}

function ScenePreview({
  scene,
  url,
}: {
  scene: SceneRecord;
  url: string | undefined;
}) {
  if (!scene.mapImage || !url) {
    return <MapIcon aria-hidden size="1.25rem" strokeWidth={1.4} />;
  }
  return (
    <img alt="" className={styles.previewImage} decoding="async" src={url} />
  );
}

function SceneRow({
  capabilities,
  deleteArmed,
  isActive,
  isViewed,
  onContextMenu,
  onDelete,
  onEdit,
  onPresent,
  onRename,
  onView,
  previewUrl,
  reordering,
  scene,
}: {
  capabilities: SceneCapabilities;
  deleteArmed: boolean;
  isActive: boolean;
  isViewed: boolean;
  onContextMenu: (event: MouseEvent) => void;
  onDelete: () => void;
  onEdit: () => void;
  onPresent: () => void;
  onRename: (name: string) => Promise<boolean>;
  onView: () => void;
  previewUrl: string | undefined;
  reordering: boolean;
  scene: SceneRecord;
}) {
  // Clicking the row views the scene, except on the controls it contains.
  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, input')
    ) {
      return;
    }
    onView();
  };

  return (
    <li
      className={styles.sceneRow}
      data-active={isActive}
      data-reordering={reordering}
      data-scene-order-id={scene.id}
      data-viewing={isViewed}
      onClick={handleRowClick}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className={styles.preview}
        aria-label={`View ${scene.name}`}
        onClick={onView}
      >
        <ScenePreview scene={scene} url={previewUrl} />
      </button>
      <InlineRename
        accessibleLabel={`Name for ${scene.name}`}
        detail={describeScene(scene)}
        disabled={!capabilities.update}
        maxLength={64}
        onRename={onRename}
        value={scene.name}
      />
      <div className={styles.actions}>
        {capabilities.present ? (
          <IconButton
            active={isActive}
            aria-pressed={isActive}
            className={styles.action}
            icon={MonitorPlay}
            label={`Present ${scene.name}`}
            onClick={onPresent}
          />
        ) : null}
        {capabilities.update ? (
          <IconButton
            className={styles.action}
            icon={Settings2}
            label={`Edit ${scene.name}`}
            onClick={onEdit}
          />
        ) : null}
        {capabilities.delete ? (
          <Button
            aria-label={
              deleteArmed
                ? `Confirm deletion of ${scene.name}`
                : `Delete ${scene.name}`
            }
            aria-pressed={deleteArmed}
            className={styles.deleteButton}
            size="compact"
            variant="danger"
            onClick={onDelete}
          >
            {deleteArmed ? (
              <Check aria-hidden size="1.125rem" strokeWidth={1.75} />
            ) : (
              <Trash2 aria-hidden size="1.125rem" strokeWidth={1.75} />
            )}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ScenePanel({
  assetApi,
  campaignId,
  canCreate,
  sceneApi,
  store,
  thumbnails,
}: ScenePanelProps) {
  const [query, setQuery] = useState('');
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editingPermissionsId, setEditingPermissionsId] = useState<string | null>(null);
  const [users, setUsers] = useState<PermissionSubject[]>([]);
  const [reorderState, setReorderState] = useState<{
    activeId: string;
    orderedIds: readonly string[];
    x: number;
    y: number;
  } | null>(null);
  const { pendingId: pendingDeleteId, request: requestDelete } =
    useDeleteConfirmation();
  const menu = useRef<ContextMenuController | null>(null);
  const reorder = useRef<OrderedCollectionController | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    menu.current = new ContextMenuController();
    return () => menu.current?.close();
  }, []);

  /* Only the Game Master may read the roster, so a player's refusal is not an
     error to raise: they are simply never offered the editor. */
  useEffect(() => {
    if (!canCreate) return undefined;
    let current = true;
    void sceneApi.listUsers({ campaignId }).then((result) => {
      /* A player is refused, and an empty roster is the same as no roster, so
         neither is worth a render. */
      if (current && result.ok && result.value.length > 0) setUsers(result.value);
    });
    return () => {
      current = false;
    };
  }, [campaignId, canCreate, sceneApi]);

  const capabilitiesFor = (sceneId: string) =>
    store.access.find((entry) => entry.sceneId === sceneId)?.capabilities ?? {
      delete: false,
      managePermissions: false,
      present: false,
      reorder: false,
      update: false,
      view: false,
    };

  const permissionSubject = useMemo(() => {
    const entry = store.access.find(
      ({ sceneId }) => sceneId === editingPermissionsId,
    );
    const scene = store.scenes.find(({ id }) => id === editingPermissionsId);
    return entry?.permissions && scene
      ? scenePermissionSubject({
        access: entry,
        campaignId,
        sceneApi,
        sceneName: scene.name,
        users,
      })
      : null;
  }, [campaignId, editingPermissionsId, sceneApi, store.access, store.scenes, users]);

  const beginReorder = (scene: SceneRecord, event: MouseEvent) => {
    /* Cleared because reordering acts on the list as displayed, and a search
       filter would hide members of the very list being rearranged. */
    setQuery('');
    const controller = new OrderedCollectionController(
      () => store.scenes.map(({ id }) => id),
      (orderedIds) => store.reorderScenes(orderedIds),
    );
    reorder.current = controller;
    const snapshot = controller.begin(scene.id);
    if (snapshot) {
      setReorderState({
        activeId: scene.id,
        orderedIds: snapshot.orderedIds,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const list = listRef.current;
    const move = (event: PointerEvent) => {
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) list.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) list.scrollBy({ top: 20 });
      }
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-scene-order-id]');
      let snapshot = reorder.current?.active;
      if (target) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.sceneOrderId!) ?? 0;
        const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = reorder.current?.placeAt(index + (after ? 1 : 0));
      }
      if (snapshot) {
        setReorderState((current) => current ? {
          ...current,
          orderedIds: snapshot!.orderedIds,
          x: event.clientX,
          y: event.clientY,
        } : current);
      }
    };
    const down = (event: PointerEvent) => {
      if (event.button === 2 || !list?.contains(event.target as Node)) {
        reorder.current?.cancel();
        setReorderState(null);
      } else if (event.button === 0) {
        event.preventDefault();
        void reorder.current?.commit().then(() => setReorderState(null));
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        reorder.current?.cancel();
        setReorderState(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const snapshot = reorder.current?.step(event.key === 'ArrowUp' ? 'up' : 'down');
        if (snapshot) setReorderState((current) => current ? { ...current, orderedIds: snapshot.orderedIds } : current);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void reorder.current?.commit().then(() => setReorderState(null));
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [reorderState]);

  const openContext = (event: MouseEvent, scene: SceneRecord) => {
    event.preventDefault();
    const index = store.scenes.findIndex(({ id }) => id === scene.id);
    let deleteArmedUntil = 0;
    const step = (direction: -1 | 1) => {
      const ordered = store.scenes.map(({ id }) => id);
      const [moved] = ordered.splice(index, 1);
      ordered.splice(index + direction, 0, moved);
      void store.reorderScenes(ordered);
    };
    const capabilities = capabilitiesFor(scene.id);
    const entries: ContextMenuEntry[] = [];
    if (capabilities.managePermissions) {
      entries.push({
        kind: 'action',
        label: 'Edit Permissions',
        onSelect: () => setEditingPermissionsId(scene.id),
      });
    }
    if (capabilities.present) {
      entries.push({
        disabled: store.activeSceneId === scene.id,
        kind: 'action',
        label: 'Present Scene',
        onSelect: () => void store.present(scene.id),
      });
    }
    if (capabilities.update) {
      entries.push({
        kind: 'action',
        label: 'Scene Settings',
        onSelect: () => setEditingSceneId(scene.id),
      });
    }
    if (capabilities.reorder) {
      entries.push(
        { kind: 'divider' },
        {
          disabled: index <= 0,
          kind: 'action',
          label: 'Move Scene Up',
          onSelect: () => step(-1),
        },
        {
          disabled: index === store.scenes.length - 1,
          kind: 'action',
          label: 'Move Scene Down',
          onSelect: () => step(1),
        },
        {
          kind: 'action',
          label: 'Reorder Scene Freely',
          onSelect: () => beginReorder(scene, event),
        },
      );
    }
    if (capabilities.delete) {
      /* Guarded because everything above is conditional: with delete as the
         only entry the menu would otherwise open on a separator. */
      if (entries.length > 0) entries.push({ kind: 'divider' });
      entries.push({
        danger: true,
        kind: 'action',
        label: 'Delete Scene',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Scene';
            button.setAttribute('aria-label', `Confirm deletion of ${scene.name}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = 'Delete Scene';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void store.trashScene(scene);
        },
      });
    }
    if (entries.length === 0) return;
    menu.current?.open(
      event.clientX,
      event.clientY,
      `${scene.name} actions`,
      entries,
      () => document
        .querySelector<HTMLElement>(`[data-scene-order-id="${scene.id}"] button`)
        ?.focus(),
    );
  };

  const normalizedQuery = query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US');
  const accessibleScenes = store.scenes.filter(
    (scene) => capabilitiesFor(scene.id).view,
  );
  const filtered = normalizedQuery
    ? accessibleScenes.filter((scene) =>
      scene.name
        .normalize('NFKC')
        .toLocaleLowerCase('en-US')
        .includes(normalizedQuery),
    )
    : accessibleScenes;
  /* While reordering, the in-flight snapshot drives the order so rows follow
     the pointer before anything is persisted. */
  const visible = reorderState
    ? reorderState.orderedIds.flatMap(
      (id) => filtered.find((scene) => scene.id === id) ?? [],
    )
    : filtered;
  const editingScene =
    store.scenes.find((scene) => scene.id === editingSceneId) ?? null;

  let body: ReactNode;
  if (filtered.length === 0) {
    body = (
      <div className={styles.emptyIcon} data-sidebar-icon="scenes">
        <Clapperboard aria-hidden size="5rem" strokeWidth={1} />
      </div>
    );
  } else {
    body = (
      <ul className={styles.sceneList} ref={listRef}>
        {visible.map((scene) => (
          <SceneRow
            key={`${scene.id}:${scene.revision}`}
            capabilities={capabilitiesFor(scene.id)}
            deleteArmed={pendingDeleteId === scene.id}
            isActive={store.activeSceneId === scene.id}
            isViewed={store.viewedSceneId === scene.id}
            reordering={reorderState?.activeId === scene.id}
            onContextMenu={(event) => openContext(event, scene)}
            previewUrl={
              scene.mapImage
                ? thumbnails.get(scene.mapImage.assetId)?.url
                : undefined
            }
            scene={scene}
            onDelete={() => {
              if (requestDelete(scene.id)) {
                void store.trashScene(scene);
              }
            }}
            onEdit={() => setEditingSceneId(scene.id)}
            onPresent={() => void store.present(scene.id)}
            onRename={async (name) =>
              (await store.updateScene(scene, { name })) !== null
            }
            onView={() => store.viewScene(scene.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className={styles.scenePanel}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search aria-hidden size="1rem" />
          <span className="sr-only">Search scenes</span>
          <input
            type="search"
            placeholder="Search scenes"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
              }
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear scene search"
              onClick={() => setQuery('')}
            >
              <X aria-hidden size="1rem" />
            </button>
          ) : null}
        </label>
        {canCreate ? (
          <IconButton
            icon={Plus}
            label="Add scene"
            onClick={() => {
              void store.createScene().then((scene) => {
                if (scene) {
                  setEditingSceneId(scene.id);
                }
              });
            }}
          />
        ) : null}
      </div>

      <div className={styles.scenes}>{body}</div>

      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}
        >
          Move {store.scenes.find(({ id }) => id === reorderState.activeId)?.name}
        </div>
      ) : null}

      {permissionSubject ? (
        <PermissionsModal
          onDismiss={() => setEditingPermissionsId(null)}
          subject={permissionSubject}
        />
      ) : null}

      <SceneSettingsModal
        assetApi={assetApi}
        campaignId={campaignId}
        scene={editingScene}
        thumbnails={thumbnails}
        onDismiss={() => setEditingSceneId(null)}
        onUpdate={store.updateScene}
      />

      <ErrorModal
        isOpen={store.error !== null}
        message={store.error?.message ?? ''}
        title="Scene error"
        onDismiss={store.clearError}
      />
    </div>
  );
}
