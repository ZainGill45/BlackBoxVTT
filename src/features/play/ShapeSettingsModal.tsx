import { Dropdown, DropdownOption } from '../../components/ui/Dropdown';
import { FormField } from '../../components/ui/FormField';
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
              <Dropdown
                accessibleLabel="Background type"
                id="shape-background-type"
                label={settings.backgroundType === 'crosshatched'
                  ? 'Crosshatched'
                  : settings.backgroundType === 'transparent'
                    ? 'Transparent'
                    : 'Fill'}
              >
                {([
                  ['fill', 'Fill'],
                  ['crosshatched', 'Crosshatched'],
                  ['transparent', 'Transparent'],
                ] as const).map(([value, label]) => (
                  <DropdownOption
                    active={settings.backgroundType === value}
                    key={value}
                    label={label}
                    onSelect={() => update({ backgroundType: value })}
                  />
                ))}
              </Dropdown>
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
              <Dropdown
                accessibleLabel="Stroke type"
                id="shape-stroke-type"
                label={settings.strokeType[0].toUpperCase() + settings.strokeType.slice(1)}
              >
                {(['solid', 'dashed', 'dotted'] as const).map((value) => (
                  <DropdownOption
                    active={settings.strokeType === value}
                    key={value}
                    label={value[0].toUpperCase() + value.slice(1)}
                    onSelect={() => update({ strokeType: value })}
                  />
                ))}
              </Dropdown>
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
              <Dropdown
                accessibleLabel="Font family"
                id="shape-font-family"
                label={SCENE_TEXT_FAMILY_LABELS[settings.fontFamily]}
              >
                {SCENE_TEXT_FAMILIES.map((family) => (
                  <DropdownOption
                    active={settings.fontFamily === family}
                    key={family}
                    label={SCENE_TEXT_FAMILY_LABELS[family]}
                    onSelect={() => update({ fontFamily: family })}
                  />
                ))}
              </Dropdown>
            </FormField>
            <FormField
              htmlFor="shape-font-weight"
              label="Font weight"
              showLabel
            >
              <Dropdown
                accessibleLabel="Font weight"
                id="shape-font-weight"
                label={SCENE_TEXT_WEIGHT_LABELS[settings.fontWeight]}
              >
                {SCENE_TEXT_WEIGHTS.map((weight) => (
                  <DropdownOption
                    active={settings.fontWeight === weight}
                    key={weight}
                    label={SCENE_TEXT_WEIGHT_LABELS[weight]}
                    onSelect={() => update({ fontWeight: weight })}
                  />
                ))}
              </Dropdown>
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
