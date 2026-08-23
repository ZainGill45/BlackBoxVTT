import { Dropdown, DropdownOption } from '../../components/ui/Dropdown';
import { FormField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { ColorControl, NumberControl } from './ToolSettingsControls';
import type { TextSettings } from './textSettings';
import {
  SCENE_TEXT_FAMILIES,
  SCENE_TEXT_FAMILY_LABELS,
  SCENE_TEXT_WEIGHTS,
  SCENE_TEXT_WEIGHT_LABELS,
  sceneBounds,
} from '../../shared/scenes';
import styles from './TextSettingsModal.module.css';

interface TextSettingsModalProps {
  isOpen: boolean;
  onChange: (settings: TextSettings) => void;
  onDismiss: () => void;
  settings: TextSettings;
}

export function TextSettingsModal({
  isOpen,
  onChange,
  onDismiss,
  settings,
}: TextSettingsModalProps) {
  const update = (patch: Partial<TextSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <Modal
      accessibleLabel="Text settings"
      className={styles.modal}
      initialFocus="dialog"
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      <div className={styles.fields}>
        <FormField htmlFor="text-font-family" label="Font family" showLabel>
          <Dropdown
            accessibleLabel="Font family"
            id="text-font-family"
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
        <FormField htmlFor="text-font-weight" label="Font weight" showLabel>
          <Dropdown
            accessibleLabel="Font weight"
            id="text-font-weight"
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
        <NumberControl
          id="text-font-size"
          label="Font size"
          max={sceneBounds.textFontSize.max}
          min={sceneBounds.textFontSize.min}
          suffix="units"
          value={settings.fontSize}
          onChange={(fontSize) => update({ fontSize })}
        />
        <NumberControl
          id="text-stroke-width"
          label="Stroke width"
          max={sceneBounds.textStrokeWidth.max}
          min={sceneBounds.textStrokeWidth.min}
          suffix="units"
          value={settings.strokeWidth}
          onChange={(strokeWidth) => update({ strokeWidth })}
        />
        <ColorControl
          id="text-primary-color"
          label="Primary color"
          value={settings.primaryColor}
          onChange={(primaryColor) => update({ primaryColor })}
        />
        <ColorControl
          id="text-stroke-color"
          label="Stroke color"
          value={settings.strokeColor}
          onChange={(strokeColor) => update({ strokeColor })}
        />
      </div>
    </Modal>
  );
}
