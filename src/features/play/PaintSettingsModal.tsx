import { FormField, SelectInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import type { PaintSettings } from './paintSettings';
import { ColorControl, NumberControl } from './ToolSettingsControls';
import styles from './PaintSettingsModal.module.css';

interface PaintSettingsModalProps {
  isOpen: boolean;
  onChange: (settings: PaintSettings) => void;
  onDismiss: () => void;
  settings: PaintSettings;
}

export function PaintSettingsModal({
  isOpen,
  onChange,
  onDismiss,
  settings,
}: PaintSettingsModalProps) {
  const updateFreeform = (
    patch: Partial<PaintSettings['freeform']>,
  ) =>
    onChange({
      ...settings,
      freeform: { ...settings.freeform, ...patch },
    });
  const updatePolyline = (
    patch: Partial<PaintSettings['polyline']>,
  ) =>
    onChange({
      ...settings,
      polyline: { ...settings.polyline, ...patch },
    });

  return (
    <Modal
      accessibleLabel="Paint settings"
      className={styles.modal}
      initialFocus="dialog"
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      <div className={styles.content}>
        <section
          aria-labelledby="paint-settings-freeform-heading"
          className={styles.section}
        >
          <h2 id="paint-settings-freeform-heading">Freeform Brush</h2>
          <div className={styles.fields}>
            <ColorControl
              id="freeform-color"
              label="Color"
              value={settings.freeform.color}
              onChange={(color) => updateFreeform({ color })}
            />
            <NumberControl
              id="freeform-width"
              label="Width"
              max={256}
              min={1}
              suffix="units"
              value={settings.freeform.width}
              onChange={(width) => updateFreeform({ width })}
            />
            <NumberControl
              id="freeform-opacity"
              label="Opacity"
              max={100}
              min={1}
              suffix="%"
              value={Math.round(settings.freeform.opacity * 100)}
              onChange={(opacity) =>
                updateFreeform({ opacity: opacity / 100 })
              }
            />
            <NumberControl
              id="freeform-hardness"
              label="Hardness"
              max={100}
              min={0}
              suffix="%"
              value={Math.round(settings.freeform.hardness * 100)}
              onChange={(hardness) =>
                updateFreeform({ hardness: hardness / 100 })
              }
            />
          </div>
        </section>

        <section
          aria-labelledby="paint-settings-polyline-heading"
          className={styles.section}
        >
          <h2 id="paint-settings-polyline-heading">Polyline Brush</h2>
          <div className={styles.fields}>
            <ColorControl
              id="polyline-color"
              label="Color"
              value={settings.polyline.color}
              onChange={(color) =>
                updatePolyline({
                  color,
                  ...(settings.polyline.fillColorLinked
                    ? { fillColor: color }
                    : {}),
                })
              }
            />
            <NumberControl
              id="polyline-width"
              label="Width"
              max={256}
              min={1}
              suffix="units"
              value={settings.polyline.width}
              onChange={(width) => updatePolyline({ width })}
            />
            <NumberControl
              id="polyline-opacity"
              label="Opacity"
              max={100}
              min={1}
              suffix="%"
              value={Math.round(settings.polyline.opacity * 100)}
              onChange={(opacity) =>
                updatePolyline({ opacity: opacity / 100 })
              }
            />
            <FormField
              className={styles.field}
              htmlFor="polyline-fill-enabled"
              label="Fill"
              showLabel
            >
              <SelectInput
                id="polyline-fill-enabled"
                value={settings.polyline.fillEnabled ? 'on' : 'off'}
                onChange={(event) =>
                  updatePolyline({
                    fillEnabled: event.currentTarget.value === 'on',
                  })
                }
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </SelectInput>
            </FormField>
          </div>
          {settings.polyline.fillEnabled ? (
            <div className={styles.fields}>
              <ColorControl
                id="polyline-fill-color"
                label="Fill color"
                value={settings.polyline.fillColor}
                onChange={(fillColor) =>
                  updatePolyline({
                    fillColor,
                    fillColorLinked: false,
                  })
                }
              />
              <NumberControl
                id="polyline-fill-opacity"
                label="Fill opacity"
                max={100}
                min={1}
                suffix="%"
                value={Math.round(settings.polyline.fillOpacity * 100)}
                onChange={(fillOpacity) =>
                  updatePolyline({ fillOpacity: fillOpacity / 100 })
                }
              />
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
