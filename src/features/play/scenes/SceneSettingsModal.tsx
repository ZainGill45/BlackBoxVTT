import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import {
  FormField,
  SelectInput,
  TextInput,
} from '../../../components/ui/FormField';
import { Modal } from '../../../components/ui/Modal';
import type { AssetApi, AssetView } from '../../../shared/assets';
import {
  GRID_COLOR_PATTERN,
  GRID_COLOR_PRESETS,
  sceneBounds,
  type ScenePatch,
  type SceneGridType,
  type SceneRecord,
} from '../../../shared/scenes';
import {
  MapImageChooserModal,
  type MapImageSelection,
} from './MapImageChooserModal';
import type { AssetThumbnail } from './useAssetThumbnails';
import styles from './SceneSettingsModal.module.css';

interface SceneSettingsModalProps {
  assetApi?: AssetApi;
  campaignId: string;
  onDismiss: () => void;
  onUpdate: (
    scene: SceneRecord,
    patch: ScenePatch,
  ) => Promise<SceneRecord | null>;
  scene: SceneRecord | null;
  thumbnails: ReadonlyMap<string, AssetThumbnail>;
}

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

/**
 * Commits on blur and silently reverts anything out of range, so the form never
 * holds a value the repository would reject.
 */
function NumberField({
  id,
  integer = false,
  label,
  max,
  min,
  onCommit,
  step,
  suffix,
  value,
}: {
  id: string;
  integer?: boolean;
  label: string;
  max: number;
  min: number;
  onCommit: (next: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  // Keyed by the committed value so a saved change re-seeds the draft without
  // an effect, and a rejected one snaps straight back.
  const [edit, setEdit] = useState({ base: value, text: String(value) });
  const draft = edit.base === value ? edit.text : String(value);

  const revert = () => setEdit({ base: value, text: String(value) });

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      revert();
      return;
    }
    const next = integer ? Math.round(parsed) : parsed;
    if (next < min || next > max || next === value) {
      revert();
      return;
    }
    onCommit(next);
  };

  return (
    <FormField
      className={styles.field}
      htmlFor={id}
      label={label}
      showLabel
    >
      <span className={styles.numberShell}>
        <TextInput
          id={id}
          inputMode="decimal"
          max={max}
          min={min}
          step={step ?? (integer ? 1 : 'any')}
          type="number"
          value={draft}
          onBlur={commit}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={blurOnEnter}
        />
        {suffix ? <span aria-hidden>{suffix}</span> : null}
      </span>
    </FormField>
  );
}

function TextField({
  id,
  label,
  maxLength,
  onCommit,
  value,
}: {
  id: string;
  label: string;
  maxLength: number;
  onCommit: (next: string) => void;
  value: string;
}) {
  const [edit, setEdit] = useState({ base: value, text: value });
  const draft = edit.base === value ? edit.text : value;

  return (
    <FormField
      className={styles.field}
      htmlFor={id}
      label={label}
      showLabel
    >
      <TextInput
        id={id}
        maxLength={maxLength}
        value={draft}
        onBlur={() => {
          if (draft !== value) {
            onCommit(draft);
          }
        }}
        onChange={(event) =>
          setEdit({ base: value, text: event.currentTarget.value })
        }
        onKeyDown={blurOnEnter}
      />
    </FormField>
  );
}

function GridColorField({
  onCommit,
  value,
}: {
  onCommit: (next: string) => void;
  value: string;
}) {
  const [edit, setEdit] = useState({ base: value, text: value });
  const draft = edit.base === value ? edit.text : value;

  const commit = (next: string) => {
    const candidate = next.trim().toLowerCase();
    if (!GRID_COLOR_PATTERN.test(candidate) || candidate === value) {
      setEdit({ base: value, text: value });
      return;
    }
    onCommit(candidate);
  };

  return (
    <div className={styles.colorField}>
      <label className={styles.colorLabel} htmlFor="scene-grid-color">
        Grid color
      </label>
      <div className={styles.colorRow}>
        <span
          className={styles.colorPreview}
          role="img"
          aria-label={`Current grid color ${value}`}
          // Scene data, not part of the app's grayscale surface.
          style={{ backgroundColor: value }}
        />
        <TextInput
          aria-label="Grid color hex code"
          className={styles.colorInput}
          id="scene-grid-color"
          maxLength={7}
          spellCheck={false}
          value={draft}
          onBlur={() => commit(draft)}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={blurOnEnter}
        />
        <div className={styles.swatches}>
          {GRID_COLOR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Use grid color ${preset}`}
              aria-pressed={preset === value}
              className={styles.swatch}
              style={{ backgroundColor: preset }}
              onClick={() => commit(preset)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SceneSettingsModal({
  assetApi,
  campaignId,
  onDismiss,
  onUpdate,
  scene,
  thumbnails,
}: SceneSettingsModalProps) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [resolvedName, setResolvedName] = useState<{
    assetId: string | null;
    name: string | null;
  }>({ assetId: null, name: null });
  const assetId = scene?.mapImage?.assetId ?? null;
  const imageName = resolvedName.assetId === assetId ? resolvedName.name : null;

  useEffect(() => {
    if (!assetApi || !assetId) {
      return undefined;
    }
    let current = true;
    void assetApi.list({ campaignId }).then((result) => {
      if (!current) {
        return;
      }
      const match = result.ok
        ? result.value.find((asset: AssetView) => asset.id === assetId)
        : undefined;
      setResolvedName({ assetId, name: match?.displayName ?? null });
    });
    return () => {
      current = false;
    };
  }, [assetApi, assetId, campaignId]);

  if (!scene) {
    return null;
  }

  const commit = (patch: ScenePatch) => {
    void onUpdate(scene, patch);
  };

  const selectImage = (selection: MapImageSelection) => {
    setChooserOpen(false);
    const width = selection.width > 0 ? selection.width : scene.width;
    const height = selection.height > 0 ? selection.height : scene.height;
    const isFirstImage = scene.mapImage === null;
    commit({
      mapImage: {
        assetId: selection.assetId,
        height,
        rotation: 0,
        width,
        x: width / 2,
        y: height / 2,
      },
      // The canvas bounds follow the map only until the scene has one.
      ...(isFirstImage
        ? { height: Math.round(height), width: Math.round(width) }
        : {}),
    });
  };

  return (
    <>
      <Modal
        accessibleLabel={`Scene settings for ${scene.name}`}
        className={styles.settingsModal}
        // Two open dialogs would stack two backdrops and black out the screen,
        // so the settings step steps aside while the chooser is up.
        isOpen={!chooserOpen}
        onDismiss={onDismiss}
      >
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 title={imageName ?? undefined}>{imageName ?? 'No map image'}</h2>
            <Button
              size="compact"
              type="button"
              onClick={() => setChooserOpen(true)}
            >
              Import/Replace
            </Button>
          </div>

          <TextField
            id="scene-name"
            label="Scene name"
            maxLength={sceneBounds.name.max}
            value={scene.name}
            onCommit={(name) => commit({ name })}
          />

          <div className={styles.row}>
            <NumberField
              id="scene-width"
              integer
              label="Scene width"
              max={sceneBounds.width.max}
              min={sceneBounds.width.min}
              value={scene.width}
              onCommit={(width) => commit({ width })}
            />
            <NumberField
              id="scene-height"
              integer
              label="Scene height"
              max={sceneBounds.height.max}
              min={sceneBounds.height.min}
              value={scene.height}
              onCommit={(height) => commit({ height })}
            />
          </div>

          <div className={styles.row}>
            <NumberField
              id="scene-pixel-scale"
              label="Scene pixel scale"
              max={sceneBounds.pixelScale.max}
              min={sceneBounds.pixelScale.min}
              value={scene.pixelScale}
              onCommit={(pixelScale) => commit({ pixelScale })}
            />
            <NumberField
              id="scene-distance"
              label="Distance"
              max={sceneBounds.distance.max}
              min={sceneBounds.distance.min}
              value={scene.distance}
              onCommit={(distance) => commit({ distance })}
            />
            <TextField
              id="scene-unit"
              label="Unit"
              maxLength={sceneBounds.unit.max}
              value={scene.unit}
              onCommit={(unit) => commit({ unit })}
            />
          </div>

          <FormField
            className={styles.field}
            htmlFor="scene-grid-type"
            label="Grid"
            showLabel
          >
            <SelectInput
              id="scene-grid-type"
              value={scene.grid.type}
              onChange={(event) =>
                commit({
                  grid: {
                    type: event.currentTarget.value as SceneGridType,
                  },
                })
              }
            >
              <option value="gridless">Gridless</option>
              <option value="square">Square Grid</option>
            </SelectInput>
          </FormField>

          {scene.grid.type === 'square' ? (
            <>
              <div className={styles.row}>
                <NumberField
                  id="scene-grid-size"
                  label="Grid size"
                  max={sceneBounds.gridSize.max}
                  min={sceneBounds.gridSize.min}
                  value={scene.grid.size}
                  onCommit={(size) => commit({ grid: { size } })}
                />
                <NumberField
                  id="scene-grid-thickness"
                  label="Line thickness"
                  max={sceneBounds.gridLineThickness.max}
                  min={sceneBounds.gridLineThickness.min}
                  value={scene.grid.lineThickness}
                  onCommit={(lineThickness) =>
                    commit({ grid: { lineThickness } })
                  }
                />
              </div>
              <div className={styles.row}>
                <NumberField
                  id="scene-grid-offset-x"
                  label="Offset X"
                  max={sceneBounds.gridOffset.max}
                  min={sceneBounds.gridOffset.min}
                  value={scene.grid.offsetX}
                  onCommit={(offsetX) => commit({ grid: { offsetX } })}
                />
                <NumberField
                  id="scene-grid-offset-y"
                  label="Offset Y"
                  max={sceneBounds.gridOffset.max}
                  min={sceneBounds.gridOffset.min}
                  value={scene.grid.offsetY}
                  onCommit={(offsetY) => commit({ grid: { offsetY } })}
                />
              </div>
              <div className={styles.colorOpacityRow}>
                <GridColorField
                  value={scene.grid.color}
                  onCommit={(color) => commit({ grid: { color } })}
                />
                <NumberField
                  id="scene-grid-opacity"
                  integer
                  label="Grid opacity"
                  max={100}
                  min={0}
                  suffix="%"
                  value={Math.round(scene.grid.opacity * 100)}
                  onCommit={(percent) =>
                    commit({ grid: { opacity: percent / 100 } })
                  }
                />
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      <MapImageChooserModal
        assetApi={assetApi}
        campaignId={campaignId}
        isOpen={chooserOpen}
        selectedAssetId={assetId}
        thumbnails={thumbnails}
        onDismiss={() => setChooserOpen(false)}
        onSelect={selectImage}
      />
    </>
  );
}
