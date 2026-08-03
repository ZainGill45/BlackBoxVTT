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
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { CanonicalLoader } from '../../components/ui/CanonicalLoader';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { ErrorModal } from '../../components/ui/ErrorModal';
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
import { useDeleteConfirmation } from '../connection/useDeleteConfirmation';
import { AssetPreviewModal } from './AssetPreviewModal';
import {
  SidebarCollectionGroup,
  SidebarCollectionPanel,
} from './SidebarCollectionPanel';
import styles from './StoragePanel.module.css';

const GROUPS: Array<{ id: AssetKind; label: string }> = [
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' },
  { id: 'document', label: 'Documents' },
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
  onDelete,
  onPreview,
  onRename,
  canDrag,
}: {
  asset: AssetView;
  deleteArmed: boolean;
  onDelete: () => void;
  onPreview: (button: HTMLButtonElement) => void;
  onRename: (displayName: string) => Promise<boolean>;
  canDrag: boolean;
}) {
  const [draft, setDraft] = useState(asset.displayName);
  const Icon = GROUP_ICONS[asset.kind];

  const commit = async () => {
    if (draft === asset.displayName) {
      return;
    }
    const saved = await onRename(draft);
    if (!saved) {
      setDraft(asset.displayName);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(asset.displayName);
      event.currentTarget.blur();
    }
  };

  return (
    <li className={styles.assetRow} data-sync-state={asset.syncState}>
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
      <div className={styles.assetCopy}>
        <input
          aria-label={`Name for ${asset.displayName}`}
          disabled={!asset.capabilities.rename}
          maxLength={256}
          value={draft}
          onBlur={() => void commit()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <span>{`${asset.format.toUpperCase()} · ${formatBytes(asset.sizeBytes)}`}</span>
      </div>
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
}

export function StoragePanel({
  assetApi,
  campaignId,
  canDragImages = false,
  onDetachFromScenes,
  onFindSceneDependents,
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
    scenes: SceneRecord[];
  } | null>(null);
  const previewButtonRef = useRef<HTMLElement | null>(null);
  const previewTokenRef = useRef<string | null>(null);
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

  const sorted = useMemo(
    () =>
      [...assets].sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName, 'en-US', {
            sensitivity: 'base',
          }) || left.id.localeCompare(right.id),
      ),
    [assets],
  );
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const filtered = normalizedQuery
    ? sorted.filter((asset) =>
        asset.displayName
          .normalize('NFKC')
          .toLocaleLowerCase('en-US')
          .includes(normalizedQuery),
      )
    : sorted;

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
      });
  };

  const requestAssetDelete = async (asset: AssetView) => {
    if (!requestDelete(asset.id)) {
      return;
    }
    const dependents = (await onFindSceneDependents?.(asset.id)) ?? [];
    if (dependents.length > 0) {
      setDependencyPrompt({ asset, scenes: dependents });
      return;
    }
    deleteAsset(asset);
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
          const entries = filtered.filter((asset) => asset.kind === group.id);
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
              <ul className={styles.assetList}>
                {entries.map((asset) => (
                  <AssetRow
                    key={`${asset.id}:${asset.revision}`}
                    asset={asset}
                    canDrag={canDragImages}
                    deleteArmed={pendingDeleteId === asset.id}
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
        message={`${dependencyPrompt?.asset.displayName ?? 'This image'} is placed in ${
          dependencyPrompt?.scenes.length === 1
            ? '1 scene'
            : `${dependencyPrompt?.scenes.length ?? 0} scenes`
        }. Deleting it removes every placement too.`}
        title="Delete an image that scenes use?"
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
