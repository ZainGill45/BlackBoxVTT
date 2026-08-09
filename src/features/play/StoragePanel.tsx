import {
  Archive,
  Check,
  FileAudio,
  FileImage,
  FileText,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { CanonicalLoader } from '../../components/ui/CanonicalLoader';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../components/ui/contextMenu';
import { ErrorModal } from '../../components/ui/ErrorModal';
import { InlineRename } from '../../components/ui/InlineRename';
import { OrderedCollectionController } from '../../components/ui/orderedCollection';
import type {
  AssetApi,
  AssetErrorEvent,
  AssetKind,
  AssetPreview,
  AssetProgressEvent,
  AssetView,
} from '../../shared/assets';
import { CANVAS_IMAGE_DRAG_TYPE } from '../../shared/assets';
import type { SceneRecord } from '../../shared/scenes';
import type { JournalAssetDependent } from '../../shared/journal';
import {
  DELETE_CONFIRMATION_TIMEOUT_MS,
  useDeleteConfirmation,
} from '../connection/useDeleteConfirmation';
import { AssetPreviewModal } from './AssetPreviewModal';
import {
  SidebarCollectionGroup,
  SidebarCollectionPanel,
} from './SidebarCollectionPanel';
import styles from './StoragePanel.module.css';

/* `singular` names one member of the group, for menu entries that act on a
   single asset ("Move Image Up") rather than on the group heading. */
const GROUPS: Array<{ id: AssetKind; label: string; singular: string }> = [
  { id: 'image', label: 'Images', singular: 'Image' },
  { id: 'audio', label: 'Audio', singular: 'Audio File' },
  { id: 'document', label: 'Documents', singular: 'Document' },
];

const GROUP_ICONS = {
  audio: FileAudio,
  document: FileText,
  image: FileImage,
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function AssetRow({
  asset,
  deleteArmed,
  onContextMenu,
  onDelete,
  onPreview,
  onRename,
  canDrag,
  reordering,
}: {
  asset: AssetView;
  deleteArmed: boolean;
  onContextMenu: (event: ReactMouseEvent) => void;
  onDelete: () => void;
  onPreview: (button: HTMLButtonElement) => void;
  onRename: (displayName: string) => Promise<boolean>;
  canDrag: boolean;
  reordering: boolean;
}) {
  const Icon = GROUP_ICONS[asset.kind];

  return (
    <li
      className={styles.assetRow}
      data-asset-kind={asset.kind}
      data-asset-order-id={asset.id}
      data-reordering={reordering}
      data-sync-state={asset.syncState}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className={styles.assetIcon}
        aria-label={`Preview ${asset.displayName}`}
        aria-disabled={
          !asset.capabilities.preview || asset.syncState === 'unavailable'
        }
        data-unavailable={asset.syncState === 'unavailable'}
        disabled={
          !asset.capabilities.preview || asset.syncState === 'unavailable'
        }
        draggable={canDrag && asset.kind === 'image' && asset.syncState === 'ready'}
        onDragStart={(event) => {
          if (!canDrag || asset.kind !== 'image') {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(CANVAS_IMAGE_DRAG_TYPE, asset.id);
          event.dataTransfer.setDragImage(
            event.currentTarget,
            event.currentTarget.clientWidth / 2,
            event.currentTarget.clientHeight / 2,
          );
        }}
        onClick={(event) => onPreview(event.currentTarget)}
      >
        <Icon aria-hidden size="1.625rem" strokeWidth={1.4} />
      </button>
      <InlineRename
        accessibleLabel={`Name for ${asset.displayName}`}
        detail={`${asset.format.toUpperCase()} · ${formatBytes(asset.sizeBytes)}`}
        disabled={!asset.capabilities.rename}
        maxLength={256}
        onRename={onRename}
        value={asset.displayName}
      />
      <Button
        aria-label={
          deleteArmed
            ? `Confirm deletion of ${asset.displayName}`
            : `Delete ${asset.displayName}`
        }
        aria-pressed={deleteArmed}
        className={styles.deleteButton}
        disabled={!asset.capabilities.delete}
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
    </li>
  );
}

interface StoragePanelProps {
  assetApi: AssetApi;
  campaignId: string;
  canDragImages?: boolean;
  /** Clears the asset from every canonical or additional scene placement. */
  onDetachFromScenes?: (assetId: string) => Promise<void>;
  /** Scenes that contain a canonical or additional placement of the asset. */
  onFindSceneDependents?: (assetId: string) => Promise<SceneRecord[]>;
  onDetachFromJournal?: (assetId: string) => Promise<void>;
  onFindJournalDependents?: (assetId: string) => Promise<JournalAssetDependent[]>;
}

export function StoragePanel({
  assetApi,
  campaignId,
  canDragImages = false,
  onDetachFromScenes,
  onFindSceneDependents,
  onDetachFromJournal,
  onFindJournalDependents,
}: StoragePanelProps) {
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<AssetKind, boolean>>({
    audio: false,
    document: false,
    image: false,
  });
  const [error, setError] = useState<AssetErrorEvent | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<AssetProgressEvent | null>(null);
  const [selected, setSelected] = useState<AssetView | null>(null);
  const [preview, setPreview] = useState<AssetPreview | null>(null);
  const [dependencyPrompt, setDependencyPrompt] = useState<{
    asset: AssetView;
    journal: JournalAssetDependent[];
    scenes: SceneRecord[];
  } | null>(null);
  const [reorderState, setReorderState] = useState<{
    activeId: string;
    kind: AssetKind;
    orderedIds: readonly string[];
    x: number;
    y: number;
  } | null>(null);
  const previewButtonRef = useRef<HTMLElement | null>(null);
  const previewTokenRef = useRef<string | null>(null);
  const menu = useRef<ContextMenuController | null>(null);
  const reorder = useRef<OrderedCollectionController | null>(null);
  const listsRef = useRef(new Map<AssetKind, HTMLUListElement>());
  const {
    pendingId: pendingDeleteId,
    request: requestDelete,
  } = useDeleteConfirmation();

  useEffect(
    () => () => {
      if (previewTokenRef.current) {
        void assetApi.releasePreview({ token: previewTokenRef.current });
        previewTokenRef.current = null;
      }
    },
    [assetApi],
  );

  useEffect(() => {
    menu.current = new ContextMenuController();
    return () => menu.current?.close();
  }, []);

  useEffect(() => {
    let current = true;
    void assetApi.list({ campaignId }).then((result) => {
      if (!current) {
        return;
      }
      if (result.ok) {
        setAssets(result.value);
      } else {
        setError({
          ...result.error,
          campaignId,
          title: 'Campaign assets could not be loaded',
        });
      }
    });
    const removeChanged = assetApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        setAssets(event.assets);
      }
    });
    const removeProgress = assetApi.onProgress((event) => {
      if (event.scope === 'import') {
        setProgress(event);
      }
    });
    return () => {
      current = false;
      removeChanged();
      removeProgress();
    };
  }, [assetApi, campaignId]);

  useEffect(() => {
    if (!selected || preview) {
      return;
    }
    const current = assets.find((asset) => asset.id === selected.id);
    if (current && current.syncState !== 'ready') {
      return;
    }
    let active = true;
    void assetApi
      .getPreview({ assetId: selected.id, campaignId })
      .then((result) => {
        if (!active) {
          if (result.ok) {
            void assetApi.releasePreview({ token: result.value.token });
          }
          return;
        }
        if (result.ok) {
          previewTokenRef.current = result.value.token;
          setPreview(result.value);
        } else if (result.error.code !== 'unavailable') {
          setSelected(null);
          setError({
            ...result.error,
            campaignId,
            title: 'Asset preview failed',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [assetApi, assets, campaignId, preview, selected]);

  const commitOrder = async (
    kind: AssetKind,
    orderedAssetIds: readonly string[],
  ) => {
    const result = await assetApi.reorder({
      campaignId,
      kind,
      orderedAssetIds: [...orderedAssetIds],
    });
    if (!result.ok) {
      setError({
        ...result.error,
        campaignId,
        title: 'Asset order could not be saved',
      });
      return false;
    }
    setAssets(result.value);
    return true;
  };

  const beginReorder = (asset: AssetView, event: ReactMouseEvent) => {
    /* Cleared because reordering acts on the group as displayed, and a search
       filter would hide members of the very list being rearranged. */
    setQuery('');
    setExpanded((current) => ({ ...current, [asset.kind]: true }));
    const controller = new OrderedCollectionController(
      () => assets.filter(({ kind }) => kind === asset.kind).map(({ id }) => id),
      (orderedIds) => commitOrder(asset.kind, orderedIds),
    );
    reorder.current = controller;
    const snapshot = controller.begin(asset.id);
    if (snapshot) {
      setReorderState({
        activeId: asset.id,
        kind: asset.kind,
        orderedIds: snapshot.orderedIds,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const list = listsRef.current.get(reorderState.kind);
    const move = (event: PointerEvent) => {
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) list.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) list.scrollBy({ top: 20 });
      }
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-asset-order-id]');
      let snapshot = reorder.current?.active;
      if (target && target.dataset.assetKind === reorderState.kind) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.assetOrderId!) ?? 0;
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

  const openContext = (event: ReactMouseEvent, asset: AssetView) => {
    event.preventDefault();
    const group = assets.filter(({ kind }) => kind === asset.kind);
    const index = group.findIndex(({ id }) => id === asset.id);
    const label = GROUPS.find(({ id }) => id === asset.kind)?.singular ?? 'Asset';
    const entries: ContextMenuEntry[] = [];
    let deleteArmedUntil = 0;
    const step = (direction: -1 | 1) => {
      const ordered = group.map(({ id }) => id);
      const [moved] = ordered.splice(index, 1);
      ordered.splice(index + direction, 0, moved);
      void commitOrder(asset.kind, ordered);
    };
    if (asset.capabilities.reorder) {
      entries.push(
        {
          disabled: index <= 0,
          kind: 'action',
          label: `Move ${label} Up`,
          onSelect: () => step(-1),
        },
        {
          disabled: index === group.length - 1,
          kind: 'action',
          label: `Move ${label} Down`,
          onSelect: () => step(1),
        },
        {
          kind: 'action',
          label: `Reorder ${label} Freely`,
          onSelect: () => beginReorder(asset, event),
        },
      );
    }
    if (asset.capabilities.delete) {
      /* Guarded because reorder is Game Master only: for a player, delete can
         be the sole entry and the menu would otherwise open on a separator. */
      if (entries.length > 0) entries.push({ kind: 'divider' });
      entries.push({
        danger: true,
        kind: 'action',
        label: `Delete ${label}`,
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = `Confirm Delete ${label}`;
            button.setAttribute('aria-label', `Confirm deletion of ${asset.displayName}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = `Delete ${label}`;
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void resolveAssetDelete(asset);
        },
      });
    }
    if (entries.length === 0) return;
    menu.current?.open(
      event.clientX,
      event.clientY,
      `${asset.displayName} actions`,
      entries,
      () => document
        .querySelector<HTMLElement>(`[data-asset-order-id="${asset.id}"] button`)
        ?.focus(),
    );
  };

  /*
   * Manifest order, not an alphabetical sort. The manifest array is the stored
   * order, so re-sorting here would silently discard whatever the Game Master
   * arranged. Newly imported assets therefore land at the end of their group.
   */
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const filtered = normalizedQuery
    ? assets.filter((asset) =>
        asset.displayName
          .normalize('NFKC')
          .toLocaleLowerCase('en-US')
          .includes(normalizedQuery),
      )
    : assets;

  const importAssets = async () => {
    setImporting(true);
    setProgress(null);
    const result = await assetApi.pickAndImport({ campaignId });
    setImporting(false);
    if (result.ok) {
      if (result.value.length > 0) {
        setAssets(result.value);
      }
    } else {
      setError({
        ...result.error,
        campaignId,
        title: 'Asset import failed',
      });
    }
  };

  const deleteAsset = (asset: AssetView) => {
    const previous = assets;
    setAssets((current) =>
      current.filter((candidate) => candidate.id !== asset.id),
    );
    void assetApi
      .trash({
        assetId: asset.id,
        campaignId,
        expectedRevision: asset.revision,
      })
      .then(async (result) => {
        if (!result.ok) {
          setAssets(previous);
          setError({
            ...result.error,
            campaignId,
            title: 'Asset deletion failed',
          });
          return;
        }
        await onDetachFromScenes?.(asset.id);
        await onDetachFromJournal?.(asset.id);
      });
  };

  /*
   * Everything after the confirming press. Split out because the row button and
   * the context menu prime independently — the row through
   * useDeleteConfirmation, the menu through its own armed entry — and the menu
   * must not be made to ask a second time.
   */
  const resolveAssetDelete = async (asset: AssetView) => {
    const [scenes, journal] = await Promise.all([
      onFindSceneDependents?.(asset.id) ?? Promise.resolve([]),
      onFindJournalDependents?.(asset.id) ?? Promise.resolve([]),
    ]);
    if (scenes.length > 0 || journal.length > 0) {
      setDependencyPrompt({ asset, journal, scenes });
      return;
    }
    deleteAsset(asset);
  };

  const requestAssetDelete = async (asset: AssetView) => {
    if (!requestDelete(asset.id)) {
      return;
    }
    await resolveAssetDelete(asset);
  };

  const dismissPreview = () => {
    if (previewTokenRef.current) {
      void assetApi.releasePreview({ token: previewTokenRef.current });
      previewTokenRef.current = null;
    }
    setPreview(null);
    setSelected(null);
  };

  return (
    <>
      <SidebarCollectionPanel
        addLabel="Add campaign assets"
        clearLabel="Clear asset search"
        emptyIcon={Archive}
        emptyIconId="storage"
        onAdd={() => void importAssets()}
        onQueryChange={setQuery}
        query={query}
        searchLabel="Search campaign assets"
        searchPlaceholder="Search assets"
        showEmpty={filtered.length === 0}
      >
        {GROUPS.map((group) => {
          const matching = filtered.filter((asset) => asset.kind === group.id);
          /* While reordering, the in-flight snapshot drives the order so the
             rows follow the pointer before anything is persisted. */
          const entries = reorderState?.kind === group.id
            ? reorderState.orderedIds.flatMap(
                (id) => matching.find((asset) => asset.id === id) ?? [],
              )
            : matching;
          if (entries.length === 0) {
            return null;
          }
          return (
            <SidebarCollectionGroup
              key={group.id}
              expanded={normalizedQuery ? true : expanded[group.id]}
              label={group.label}
              onExpandedChange={(value) => {
                if (!normalizedQuery) {
                  setExpanded((current) => ({
                    ...current,
                    [group.id]: value,
                  }));
                }
              }}
            >
              <ul
                className={styles.assetList}
                ref={(node) => {
                  if (node) listsRef.current.set(group.id, node);
                  else listsRef.current.delete(group.id);
                }}
              >
                {entries.map((asset) => (
                  <AssetRow
                    key={`${asset.id}:${asset.revision}`}
                    asset={asset}
                    canDrag={canDragImages}
                    deleteArmed={pendingDeleteId === asset.id}
                    reordering={reorderState?.activeId === asset.id}
                    onContextMenu={(event) => openContext(event, asset)}
                    onPreview={(button) => {
                      previewButtonRef.current = button;
                      setSelected(asset);
                      setPreview(null);
                    }}
                    onRename={async (displayName) => {
                      setAssets((current) =>
                        current.map((candidate) =>
                          candidate.id === asset.id
                            ? { ...candidate, displayName }
                            : candidate,
                        ),
                      );
                      const result = await assetApi.rename({
                        assetId: asset.id,
                        campaignId,
                        displayName,
                        expectedRevision: asset.revision,
                      });
                      if (result.ok) {
                        setAssets((current) =>
                          current.map((candidate) =>
                            candidate.id === asset.id ? result.value : candidate,
                          ),
                        );
                        return true;
                      }
                      setAssets((current) =>
                        current.map((candidate) =>
                          candidate.id === asset.id ? asset : candidate,
                        ),
                      );
                      if (
                        result.error.code === 'storage_error' ||
                        result.error.code === 'sync_error'
                      ) {
                        setError({
                          ...result.error,
                          campaignId,
                          title: 'Asset rename failed',
                        });
                      }
                      return false;
                    }}
                    onDelete={() => void requestAssetDelete(asset)}
                  />
                ))}
              </ul>
            </SidebarCollectionGroup>
          );
        })}
      </SidebarCollectionPanel>

      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}
        >
          Move {assets.find(({ id }) => id === reorderState.activeId)?.displayName}
        </div>
      ) : null}

      {importing ? (
        <CanonicalLoader
          completedBytes={progress?.completedBytes}
          currentName={progress?.currentName}
          label="Adding campaign assets…"
          mode="fullscreen"
          totalBytes={progress?.totalBytes}
        />
      ) : null}

      <AssetPreviewModal
        asset={selected}
        preview={preview}
        returnFocusRef={previewButtonRef}
        onDismiss={dismissPreview}
      />
      <ConfirmModal
        confirmLabel="Delete anyway"
        isOpen={dependencyPrompt !== null}
        message={`${dependencyPrompt?.asset.displayName ?? 'This image'} is used by ${dependencyPrompt?.scenes.length ?? 0} scene(s) and ${dependencyPrompt?.journal.length ?? 0} Journal page(s). Deleting it removes every placement too.`}
        title="Delete an image that campaign content uses?"
        onCancel={() => setDependencyPrompt(null)}
        onConfirm={() => {
          if (dependencyPrompt) {
            deleteAsset(dependencyPrompt.asset);
          }
          setDependencyPrompt(null);
        }}
      >
        <ul className={styles.dependentScenes}>
          {dependencyPrompt?.scenes.map((scene) => (
            <li key={scene.id}>{scene.name}</li>
          ))}
          {dependencyPrompt?.journal.map((page) => (
            <li key={page.pageId}>{page.title} (Journal)</li>
          ))}
        </ul>
      </ConfirmModal>

      <ErrorModal
        isOpen={error !== null}
        message={error?.message ?? ''}
        title={error?.title ?? 'Campaign asset error'}
        onDismiss={() => setError(null)}
      />
    </>
  );
}
