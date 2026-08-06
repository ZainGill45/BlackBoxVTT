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
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { ErrorModal } from '../../../components/ui/ErrorModal';
import { IconButton } from '../../../components/ui/IconButton';
import { InlineRename } from '../../../components/ui/InlineRename';
import type { AssetApi } from '../../../shared/assets';
import { describeScene, type SceneRecord } from '../../../shared/scenes';
import { useDeleteConfirmation } from '../../connection/useDeleteConfirmation';
import { SceneSettingsModal } from './SceneSettingsModal';
import type { AssetThumbnail } from './useAssetThumbnails';
import type { SceneStore } from './useScenes';
import styles from './ScenePanel.module.css';

interface ScenePanelProps {
  assetApi?: AssetApi;
  campaignId: string;
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
  deleteArmed,
  isActive,
  isViewed,
  onDelete,
  onEdit,
  onPresent,
  onRename,
  onView,
  previewUrl,
  scene,
}: {
  deleteArmed: boolean;
  isActive: boolean;
  isViewed: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onPresent: () => void;
  onRename: (name: string) => Promise<boolean>;
  onView: () => void;
  previewUrl: string | undefined;
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
      data-viewing={isViewed}
      onClick={handleRowClick}
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
        maxLength={64}
        onRename={onRename}
        value={scene.name}
      />
      <div className={styles.actions}>
        <IconButton
          active={isActive}
          aria-pressed={isActive}
          className={styles.action}
          icon={MonitorPlay}
          label={`Present ${scene.name}`}
          onClick={onPresent}
        />
        <IconButton
          className={styles.action}
          icon={Settings2}
          label={`Edit ${scene.name}`}
          onClick={onEdit}
        />
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
      </div>
    </li>
  );
}

export function ScenePanel({
  assetApi,
  campaignId,
  store,
  thumbnails,
}: ScenePanelProps) {
  const [query, setQuery] = useState('');
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const { pendingId: pendingDeleteId, request: requestDelete } =
    useDeleteConfirmation();

  const normalizedQuery = query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US');
  const filtered = normalizedQuery
    ? store.scenes.filter((scene) =>
        scene.name
          .normalize('NFKC')
          .toLocaleLowerCase('en-US')
          .includes(normalizedQuery),
      )
    : store.scenes;
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
      <ul className={styles.sceneList}>
        {filtered.map((scene) => (
          <SceneRow
            key={`${scene.id}:${scene.revision}`}
            deleteArmed={pendingDeleteId === scene.id}
            isActive={store.activeSceneId === scene.id}
            isViewed={store.viewedSceneId === scene.id}
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
      </div>

      <div className={styles.scenes}>{body}</div>

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
