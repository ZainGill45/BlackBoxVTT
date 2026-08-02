import { FormField, SelectInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import {
  SCENE_TEXT_FAMILIES,
  SCENE_TEXT_FAMILY_LABELS,
  SCENE_TEXT_WEIGHTS,
  SCENE_TEXT_WEIGHT_LABELS,
  sceneBounds,
} from '../../shared/scenes';
import { ColorControl, NumberControl } from './ToolSettingsControls';
import type { ShapeSettings } from './shapeSettings';
import styles from './ShapeSettingsModal.module.css';

interface ShapeSettingsModalProps {
  isOpen: boolean;
  onChange: (settings: ShapeSettings) => void;
  onDismiss: () => void;
  settings: ShapeSettings;
}

export function ShapeSettingsModal({
  isOpen,
  onChange,
  onDismiss,
  settings,
}: ShapeSettingsModalProps) {
  const update = (patch: Partial<ShapeSettings>) =>
    onChange({ ...settings, ...patch });
  return (
    <Modal
      accessibleLabel="Shape settings"
      className={styles.modal}
      initialFocus="dialog"
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      <div className={styles.content}>
        <section
          aria-labelledby="shape-settings-background-heading"
          className={styles.section}
        >
          <h2 id="shape-settings-background-heading">Background</h2>
          <div className={styles.fields}>
            <ColorControl
              id="shape-background-color"
              label="Background color"
              value={settings.backgroundColor}
              onChange={(backgroundColor) => update({ backgroundColor })}
            />
            <NumberControl
              id="shape-background-opacity"
              label="Background opacity"
              max={100}
              min={0}
              suffix="%"
              value={Math.round(settings.backgroundOpacity * 100)}
              onChange={(backgroundOpacity) =>
                update({ backgroundOpacity: backgroundOpacity / 100 })
              }
            />
            <FormField
              className={styles.fullField}
              htmlFor="shape-background-type"
              label="Background type"
              showLabel
            >
              <SelectInput
                id="shape-background-type"
                value={settings.backgroundType}
                onChange={(event) =>
                  update({
                    backgroundType: event.currentTarget
                      .value as ShapeSettings['backgroundType'],
                  })
                }
              >
                <option value="fill">Fill</option>
                <option value="crosshatched">Crosshatched</option>
                <option value="transparent">Transparent</option>
              </SelectInput>
            </FormField>
          </div>
        </section>

        <section
          aria-labelledby="shape-settings-stroke-heading"
          className={styles.section}
        >
          <h2 id="shape-settings-stroke-heading">Stroke</h2>
          <div className={styles.fields}>
            <ColorControl
              id="shape-stroke-color"
              label="Stroke color"
              value={settings.strokeColor}
              onChange={(strokeColor) => update({ strokeColor })}
            />
            <NumberControl
              id="shape-stroke-opacity"
              label="Stroke opacity"
              max={100}
              min={0}
              suffix="%"
              value={Math.round(settings.strokeOpacity * 100)}
              onChange={(strokeOpacity) =>
                update({ strokeOpacity: strokeOpacity / 100 })
              }
            />
            <FormField
              htmlFor="shape-stroke-type"
              label="Stroke type"
              showLabel
            >
              <SelectInput
                id="shape-stroke-type"
                value={settings.strokeType}
                onChange={(event) =>
                  update({
                    strokeType: event.currentTarget
                      .value as ShapeSettings['strokeType'],
                  })
                }
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </SelectInput>
            </FormField>
            <NumberControl
              id="shape-stroke-width"
              label="Stroke width"
              max={sceneBounds.shapeStrokeWidth.max}
              min={sceneBounds.shapeStrokeWidth.min}
              suffix="px"
              value={settings.strokeWidth}
              onChange={(strokeWidth) => update({ strokeWidth })}
            />
          </div>
        </section>

        <section
          aria-labelledby="shape-settings-label-heading"
          className={styles.section}
        >
          <h2 id="shape-settings-label-heading">Measurement labels</h2>
          <div className={styles.fields}>
            <FormField
              htmlFor="shape-font-family"
              label="Font family"
              showLabel
            >
              <SelectInput
                id="shape-font-family"
                value={settings.fontFamily}
                onChange={(event) =>
                  update({
                    fontFamily: event.currentTarget
                      .value as ShapeSettings['fontFamily'],
                  })
                }
              >
                {SCENE_TEXT_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {SCENE_TEXT_FAMILY_LABELS[family]}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField
              htmlFor="shape-font-weight"
              label="Font weight"
              showLabel
            >
              <SelectInput
                id="shape-font-weight"
                value={String(settings.fontWeight)}
                onChange={(event) =>
                  update({
                    fontWeight: Number(
                      event.currentTarget.value,
                    ) as ShapeSettings['fontWeight'],
                  })
                }
              >
                {SCENE_TEXT_WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {SCENE_TEXT_WEIGHT_LABELS[weight]}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <ColorControl
              id="shape-font-color"
              label="Font color"
              value={settings.fontColor}
              onChange={(fontColor) => update({ fontColor })}
            />
            <NumberControl
              id="shape-font-size"
              label="Font size"
              max={sceneBounds.shapeFontSize.max}
              min={sceneBounds.shapeFontSize.min}
              suffix="px"
              value={settings.fontSize}
              onChange={(fontSize) => update({ fontSize })}
            />
            <ColorControl
              id="shape-font-stroke-color"
              label="Font stroke color"
              value={settings.fontStrokeColor}
              onChange={(fontStrokeColor) => update({ fontStrokeColor })}
            />
            <NumberControl
              id="shape-font-stroke-width"
              label="Font stroke width"
              max={sceneBounds.shapeFontStrokeWidth.max}
              min={sceneBounds.shapeFontStrokeWidth.min}
              suffix="px"
              value={settings.fontStrokeWidth}
              onChange={(fontStrokeWidth) => update({ fontStrokeWidth })}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}
