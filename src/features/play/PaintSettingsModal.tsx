import { useState, type KeyboardEvent } from 'react';
import {
  FormField,
  SelectInput,
  TextInput,
} from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import type { PaintSettings } from './paintSettings';
import styles from './PaintSettingsModal.module.css';

interface PaintSettingsModalProps {
  isOpen: boolean;
  onChange: (settings: PaintSettings) => void;
  onDismiss: () => void;
  settings: PaintSettings;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function ColorControl({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [edit, setEdit] = useState({ base: value, text: value });
  const draft = edit.base === value ? edit.text : value;

  const revert = () => setEdit({ base: value, text: value });
  const commit = () => {
    const candidate = draft.trim().toLowerCase();
    if (!COLOR_PATTERN.test(candidate) || candidate === value) {
      revert();
      return;
    }
    onChange(candidate);
  };

  return (
    <FormField
      className={styles.field}
      htmlFor={`${id}-text`}
      label={label}
      showLabel
    >
      <div className={styles.colorRow}>
        <label
          aria-label={`${label} picker`}
          className={styles.colorSwatch}
          htmlFor={`${id}-picker`}
          style={{ backgroundColor: value }}
        >
          <input
            id={`${id}-picker`}
            type="color"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </label>
        <TextInput
          autoComplete="off"
          className={styles.hexInput}
          id={`${id}-text`}
          maxLength={7}
          spellCheck={false}
          value={draft}
          onBlur={commit}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
              return;
            }
            handleFieldKeyDown(event);
          }}
        />
      </div>
    </FormField>
  );
}

function NumberControl({
  id,
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  const [edit, setEdit] = useState({ base: value, text: String(value) });
  const draft = edit.base === value ? edit.text : String(value);

  const revert = () => setEdit({ base: value, text: String(value) });
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      revert();
      return;
    }

    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    if (next === value) {
      revert();
      return;
    }
    onChange(next);
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
          className={styles.numberInput}
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          step={1}
          type="number"
          value={draft}
          onBlur={commit}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
              return;
            }
            handleFieldKeyDown(event);
          }}
        />
        <span aria-hidden>{suffix}</span>
      </span>
    </FormField>
  );
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
